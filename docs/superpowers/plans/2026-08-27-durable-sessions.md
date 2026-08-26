# Durable Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player or host who disconnects mid-game can reconnect and reclaim their exact place, instead of losing their seat permanently or destroying the room.

**Architecture:** Identity moves from `socket.id` (which changes on every reconnect) to a client-generated token kept in `localStorage`. `room.players` is re-keyed by that token and `player.id` holds it, so any game state indexed by player id survives a reconnect untouched. To keep the eleven existing `io.to(playerId)` / `io.to(room.hostSocketId)` emit sites working without edits, every socket joins a socket.io room named after its own token — `io.to(x)` treats a room name and a socket id identically. Disconnects no longer delete players while a game is in progress; they flip a `connected` flag. A periodic sweeper reclaims rooms that everyone has abandoned.

**Tech Stack:** Node.js (CommonJS), Express 4, Socket.io 4, `node:test` for unit tests, `socket.io-client` for end-to-end scripts. Browser side is plain `<script>` files with no build step.

**Spec:** `docs/superpowers/specs/2026-08-27-blood-on-the-clocktower-design.md` §2

## Global Constraints

- Working directory for every command: `party-platform-full/party-game-platform/server/`
- No new runtime dependencies. The deployment runs offline on an Android phone under Termux; anything requiring a network fetch at runtime is forbidden.
- No disk persistence. If the Node process dies the game is lost — that is an accepted limitation, recorded in the spec's §10.
- The four existing games (`findTheImposter`, `wordWolf`, `slipUp`, `avalon`) must keep passing every test. Baseline before starting: **146 unit tests pass**, and all six `test/e2e-*.js` scripts pass.
- Do not delete, skip, or comment out an existing test to make a change pass.
- Source files have mixed CRLF/LF line endings. Match the surrounding file; do not reformat whole files.
- Player-facing token format: `^[A-Za-z0-9_-]{8,64}$` (accommodates `crypto.randomUUID()`).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `sessionToken.js` (create) | Validating the shape of a client-supplied token. Pure, no I/O. |
| `roomService.js` (modify) | Players keyed by token; connection state; rejoin/reclaim; abandoned-room sweeping. |
| `index.js` (modify) | Socket wiring: read the token off each event, `socket.join(token)`, host auth by token, disconnect handling, sweeper interval. |
| `public/shared/session.js` (create) | Browser: get-or-create the persistent token, expose it as `window.sessionToken`. |
| `public/player/index.html`, `public/host/index.html` (modify) | Load `session.js` before the page script. |
| `public/player/player.js`, `public/host/host.js` (modify) | Send the token when creating/joining; handle rejoin. |
| `games/*.js` (modify) | Add `onPlayerRejoined` so a returning player gets their private state back. |
| `test/sessionToken.test.js`, `test/roomService.test.js` (create) | Unit coverage for the two new/changed server modules. |
| `test/e2e-reconnect.js` (create) | End-to-end proof that a seat survives a disconnect. |

---

### Task 1: Token validation module

**Files:**
- Create: `sessionToken.js`
- Test: `test/sessionToken.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `isValidToken(value) → boolean`

- [ ] **Step 1: Write the failing test**

Create `test/sessionToken.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidToken } = require("../sessionToken");

test("accepts a crypto.randomUUID-shaped token", () => {
  assert.equal(isValidToken("3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"), true);
});

test("accepts a plain hex token", () => {
  assert.equal(isValidToken("a1b2c3d4e5f60718"), true);
});

test("rejects anything too short to be unguessable", () => {
  assert.equal(isValidToken("abc123"), false);
});

test("rejects an over-long token", () => {
  assert.equal(isValidToken("a".repeat(65)), false);
});

test("rejects characters outside the allowed set", () => {
  assert.equal(isValidToken("has spaces here!!"), false);
  assert.equal(isValidToken("semi;colon;token123"), false);
});

test("rejects non-strings", () => {
  assert.equal(isValidToken(null), false);
  assert.equal(isValidToken(undefined), false);
  assert.equal(isValidToken(12345678), false);
  assert.equal(isValidToken({}), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/sessionToken.test.js`
Expected: FAIL — `Cannot find module '../sessionToken'`

- [ ] **Step 3: Write the implementation**

Create `sessionToken.js`:

```js
// sessionToken.js
// A player's identity is a token they generate and keep in localStorage, not
// their socket id — socket ids change on every reconnect, and game state is
// indexed by player id. The server never issues these; it only checks that a
// supplied one has a sane shape before using it as a map key and a socket.io
// room name.

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

function isValidToken(value) {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

module.exports = { isValidToken };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/sessionToken.test.js`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
git add sessionToken.js test/sessionToken.test.js
git commit -m "feat: add session token validation"
```

---

### Task 2: Re-key players by token, with connection state

**Files:**
- Modify: `roomService.js:19-33` (`createRoom`), `:39-54` (`joinRoom`), `:56-64` (`removePlayer`), `:86-97` (`publicRoomView`), `:99-108` (exports)
- Test: `test/roomService.test.js` (create)

**Interfaces:**
- Consumes: nothing from Task 1 (validation happens at the socket layer)
- Produces:
  - `createRoom(hostId) → room` where `room.hostId` replaces `room.hostSocketId`, plus `room.hostConnected: boolean` and `room.hostDisconnectedAt: number | null`
  - `joinRoom(code, playerToken, nickname) → { room, rejoined } | { error }`
  - `markPlayerDisconnected(playerToken) → { room, removed } | null`
  - player shape: `{ id, nickname, ready, connected, disconnectedAt }` where `id` is the token
  - `publicRoomView(room).players[]` gains `connected`

- [ ] **Step 1: Write the failing test**

Create `test/roomService.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const roomService = require("../roomService");

const TOKEN_A = "token-aaaaaaaaaaaa";
const TOKEN_B = "token-bbbbbbbbbbbb";
const HOST = "token-hosthosthost";

test("a room is created with the host id and host marked connected", () => {
  const room = roomService.createRoom(HOST);
  assert.equal(room.hostId, HOST);
  assert.equal(room.hostConnected, true);
  assert.equal(room.hostDisconnectedAt, null);
});

test("joining stores the player under their token and reports a fresh join", () => {
  const room = roomService.createRoom(HOST);
  const result = roomService.joinRoom(room.code, TOKEN_A, "Alice");
  assert.equal(result.error, undefined);
  assert.equal(result.rejoined, false);
  const player = result.room.players.get(TOKEN_A);
  assert.equal(player.id, TOKEN_A);
  assert.equal(player.nickname, "Alice");
  assert.equal(player.connected, true);
});

test("the same token joining again reclaims the seat rather than duplicating", () => {
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  const again = roomService.joinRoom(room.code, TOKEN_A, "Alice");
  assert.equal(again.rejoined, true);
  assert.equal(again.room.players.size, 1);
});

test("a disconnect in the lobby removes the player outright", () => {
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  const result = roomService.markPlayerDisconnected(TOKEN_A);
  assert.equal(result.removed, true);
  assert.equal(result.room.players.has(TOKEN_A), false);
});

test("a disconnect mid-game keeps the seat and flags it disconnected", () => {
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  room.state = "in-progress";
  const result = roomService.markPlayerDisconnected(TOKEN_A);
  assert.equal(result.removed, false);
  const player = result.room.players.get(TOKEN_A);
  assert.equal(player.connected, false);
  assert.ok(typeof player.disconnectedAt === "number");
});

test("a disconnected player rejoins mid-game and is connected again", () => {
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  room.state = "in-progress";
  roomService.markPlayerDisconnected(TOKEN_A);
  const back = roomService.joinRoom(room.code, TOKEN_A, "Alice");
  assert.equal(back.rejoined, true);
  const player = back.room.players.get(TOKEN_A);
  assert.equal(player.connected, true);
  assert.equal(player.disconnectedAt, null);
});

test("an unknown token still cannot join a game in progress", () => {
  const room = roomService.createRoom(HOST);
  room.state = "in-progress";
  const result = roomService.joinRoom(room.code, TOKEN_B, "Bob");
  assert.equal(result.error, "Game already in progress");
});

test("nickname collisions are still rejected for new players", () => {
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  const result = roomService.joinRoom(room.code, TOKEN_B, "alice");
  assert.equal(result.error, "Nickname already taken in this room");
});

test("publicRoomView exposes connection state", () => {
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  const view = roomService.publicRoomView(room);
  assert.equal(view.players[0].id, TOKEN_A);
  assert.equal(view.players[0].connected, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/roomService.test.js`
Expected: FAIL — the first test fails on `room.hostId` being `undefined`

- [ ] **Step 3: Rewrite `createRoom`**

Replace `roomService.js:19-33` with:

```js
function createRoom(hostId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId,                 // the host's session token, stable across reconnects
    hostConnected: true,
    hostDisconnectedAt: null,
    state: "lobby", // lobby -> in-progress -> results
    players: new Map(), // playerToken -> { id, nickname, ready, connected, disconnectedAt }
    gameId: null,       // which game is selected, e.g. "find-the-imposter"
    gameState: null,    // opaque state owned by the game module
    punishmentWheel: { items: wheelLogic.makeDefaultItems() },
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}
```

- [ ] **Step 4: Rewrite `joinRoom` to reclaim before validating**

Replace `roomService.js:39-54` with:

```js
function joinRoom(code, playerToken, nickname) {
  const room = getRoom(code);
  if (!room) return { error: "Room not found" };

  // A known token is a returning player: reclaim the seat whatever the room
  // state, because refusing here is what used to lose someone their game.
  const existing = room.players.get(playerToken);
  if (existing) {
    existing.connected = true;
    existing.disconnectedAt = null;
    return { room, rejoined: true };
  }

  if (room.state !== "lobby") return { error: "Game already in progress" };

  const trimmed = (nickname || "").trim().slice(0, 20);
  if (!trimmed) return { error: "Nickname required" };

  const nameTaken = Array.from(room.players.values()).some(
    (p) => p.nickname.toLowerCase() === trimmed.toLowerCase()
  );
  if (nameTaken) return { error: "Nickname already taken in this room" };

  room.players.set(playerToken, {
    id: playerToken,
    nickname: trimmed,
    ready: false,
    connected: true,
    disconnectedAt: null,
  });
  return { room, rejoined: false };
}
```

- [ ] **Step 5: Replace `removePlayer` with `markPlayerDisconnected`**

Replace `roomService.js:56-64` with:

```js
// In the lobby a departure is just a departure. Once a game is running the
// seat is load-bearing — game state is indexed by player id — so the player
// is kept and merely flagged, ready to be reclaimed by the same token.
function markPlayerDisconnected(playerToken) {
  for (const room of rooms.values()) {
    const player = room.players.get(playerToken);
    if (!player) continue;

    if (room.state === "lobby") {
      room.players.delete(playerToken);
      return { room, removed: true };
    }

    player.connected = false;
    player.disconnectedAt = Date.now();
    return { room, removed: false };
  }
  return null;
}
```

- [ ] **Step 6: Expose connection state in `publicRoomView`**

Replace the `players` mapping inside `publicRoomView` (`roomService.js:91-95`) with:

```js
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      ready: p.ready,
      connected: p.connected,
    })),
```

- [ ] **Step 7: Update `findRoomByHost` and the exports**

Replace `roomService.js:79-84`:

```js
function findRoomByHost(hostId) {
  for (const room of rooms.values()) {
    if (room.hostId === hostId) return room;
  }
  return null;
}
```

In `module.exports`, replace `removePlayer` with `markPlayerDisconnected`.

- [ ] **Step 8: Run the test to verify it passes**

Run: `node --test test/roomService.test.js`
Expected: PASS, 9 tests

- [ ] **Step 9: Commit**

```bash
git add roomService.js test/roomService.test.js
git commit -m "feat: key players by session token and keep seats through disconnects"
```

---

### Task 3: Host reconnection

**Files:**
- Modify: `roomService.js` (add two functions before `module.exports`)
- Test: `test/roomService.test.js` (append)

**Interfaces:**
- Consumes: `room.hostId`, `room.hostConnected`, `room.hostDisconnectedAt` from Task 2
- Produces:
  - `markHostDisconnected(hostId) → room | null`
  - `reclaimHost(code, hostId) → room | null`

- [ ] **Step 1: Write the failing test**

Append to `test/roomService.test.js`:

```js
test("a host disconnect flags the host but keeps the room alive", () => {
  const room = roomService.createRoom(HOST);
  const found = roomService.markHostDisconnected(HOST);
  assert.equal(found.code, room.code);
  assert.equal(found.hostConnected, false);
  assert.ok(typeof found.hostDisconnectedAt === "number");
  assert.ok(roomService.getRoom(room.code), "room must still exist");
});

test("the same host token reclaims the room", () => {
  const room = roomService.createRoom(HOST);
  roomService.markHostDisconnected(HOST);
  const back = roomService.reclaimHost(room.code, HOST);
  assert.equal(back.code, room.code);
  assert.equal(back.hostConnected, true);
  assert.equal(back.hostDisconnectedAt, null);
});

test("a different token cannot reclaim someone else's room", () => {
  const room = roomService.createRoom(HOST);
  roomService.markHostDisconnected(HOST);
  assert.equal(roomService.reclaimHost(room.code, TOKEN_B), null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/roomService.test.js`
Expected: FAIL — `roomService.markHostDisconnected is not a function`

- [ ] **Step 3: Write the implementation**

Insert into `roomService.js` immediately before `module.exports`:

```js
// The host disconnecting used to delete the room outright, which on the
// Android deployment meant backgrounding the browser tab destroyed the game.
function markHostDisconnected(hostId) {
  const room = findRoomByHost(hostId);
  if (!room) return null;
  room.hostConnected = false;
  room.hostDisconnectedAt = Date.now();
  return room;
}

function reclaimHost(code, hostId) {
  const room = getRoom(code);
  if (!room || room.hostId !== hostId) return null;
  room.hostConnected = true;
  room.hostDisconnectedAt = null;
  return room;
}
```

Add both to `module.exports`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/roomService.test.js`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add roomService.js test/roomService.test.js
git commit -m "feat: let a host reconnect instead of destroying the room"
```

---

### Task 4: Abandoned-room sweeper

**Files:**
- Modify: `roomService.js` (add `sweepAbandonedRooms`, remove `removeRoomIfEmpty`)
- Test: `test/roomService.test.js` (append)

**Interfaces:**
- Consumes: connection flags from Tasks 2 and 3
- Produces: `sweepAbandonedRooms(now, graceMs) → string[]` (codes deleted)

Rooms no longer empty themselves on disconnect, so without this they leak for the lifetime of the process.

- [ ] **Step 1: Write the failing test**

Append to `test/roomService.test.js`:

```js
const MINUTE = 60 * 1000;

test("a room with anyone still connected is never swept", () => {
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  roomService.markHostDisconnected(HOST);
  const deleted = roomService.sweepAbandonedRooms(Date.now() + 60 * MINUTE, 10 * MINUTE);
  assert.equal(deleted.includes(room.code), false);
});

test("a fully abandoned room survives until the grace period elapses", () => {
  const room = roomService.createRoom(HOST);
  room.state = "in-progress";
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  roomService.markPlayerDisconnected(TOKEN_A);
  roomService.markHostDisconnected(HOST);

  const early = roomService.sweepAbandonedRooms(Date.now() + 1 * MINUTE, 10 * MINUTE);
  assert.equal(early.includes(room.code), false);

  const late = roomService.sweepAbandonedRooms(Date.now() + 11 * MINUTE, 10 * MINUTE);
  assert.equal(late.includes(room.code), true);
  assert.equal(roomService.getRoom(room.code), undefined);
});

test("an empty room whose host left is swept after the grace period", () => {
  const room = roomService.createRoom(HOST);
  roomService.markHostDisconnected(HOST);
  const deleted = roomService.sweepAbandonedRooms(Date.now() + 11 * MINUTE, 10 * MINUTE);
  assert.equal(deleted.includes(room.code), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/roomService.test.js`
Expected: FAIL — `roomService.sweepAbandonedRooms is not a function`

- [ ] **Step 3: Write the implementation**

Replace `removeRoomIfEmpty` (`roomService.js:66-73`) with:

```js
// Nobody is removed on disconnect any more, so rooms have to be reclaimed on a
// timer instead of when the last player leaves.
function sweepAbandonedRooms(now = Date.now(), graceMs = 10 * 60 * 1000) {
  const deleted = [];
  for (const room of rooms.values()) {
    const players = Array.from(room.players.values());
    const anyoneConnected = room.hostConnected || players.some((p) => p.connected);
    if (anyoneConnected) continue;

    const timestamps = [room.createdAt, room.hostDisconnectedAt || 0];
    players.forEach((p) => timestamps.push(p.disconnectedAt || 0));
    const lastSeen = Math.max(...timestamps);

    if (now - lastSeen >= graceMs) {
      rooms.delete(room.code);
      deleted.push(room.code);
    }
  }
  return deleted;
}
```

Replace `removeRoomIfEmpty` with `sweepAbandonedRooms` in `module.exports`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/roomService.test.js`
Expected: PASS, 15 tests

- [ ] **Step 5: Commit**

```bash
git add roomService.js test/roomService.test.js
git commit -m "feat: sweep rooms everyone has abandoned"
```

---

### Task 5: Socket wiring — identity, auth, disconnect

**Files:**
- Modify: `index.js:98` (`withHostGame` auth), `:105-135` (connection, create-room, join-room), `:139`, `:290`, `:313`, `:332` (host auth checks), `:339-360` (disconnect handler), and the module top for the new require
- Test: covered end-to-end by Task 7; the six existing e2e scripts guard against regressions here

**Interfaces:**
- Consumes: `isValidToken` (Task 1); `joinRoom`, `markPlayerDisconnected`, `publicRoomView` (Task 2); `markHostDisconnected`, `reclaimHost` (Task 3); `sweepAbandonedRooms` (Task 4)
- Produces:
  - `socket.data.token` — the caller's identity for the lifetime of the socket
  - client events `host:create-room` and `player:join-room` now carry `{ token, ... }`
  - new client event `host:reclaim-room` → `{ code, token }`
  - new server events `player:rejoined`, `room:host-reconnected`

**Why every socket joins a room named after its token:** `io.to(x)` resolves `x` as a socket.io room, and each socket is automatically in a room named by its own id — which is why `io.to(playerId)` worked when `playerId` was a socket id. Having each socket also join a room named by its token keeps all eleven existing emit sites in `games/*.js` working with no edit at all.

- [ ] **Step 1: Require the validator**

Add after the other requires near `index.js:18`:

```js
const { isValidToken } = require("./sessionToken");
```

- [ ] **Step 2: Bind identity at the top of the connection handler**

Replace `index.js:105` (`io.on("connection", (socket) => {`) with:

```js
io.on("connection", (socket) => {
  // Identity is the client's persistent token, not socket.id. Joining a room
  // named after it means every existing io.to(playerId) emit keeps working
  // across reconnects without the game modules changing.
  function bindIdentity(token) {
    if (!isValidToken(token)) return false;
    socket.data.token = token;
    socket.join(token);
    return true;
  }
```

- [ ] **Step 3: Take the token on room creation**

Replace `index.js:107-115` (the `host:create-room` handler) with:

```js
  // ---- HOST: create room ----
  socket.on("host:create-room", ({ token } = {}) => {
    if (!bindIdentity(token)) {
      socket.emit("host:error", { error: "Missing or malformed session token" });
      return;
    }
    const room = roomService.createRoom(token);
    socket.join(room.code);
    socket.emit("host:room-created", {
      room: roomService.publicRoomView(room),
      games: gameRegistry.listGames(),
    });
    socket.emit("wheel:list-updated", { items: room.punishmentWheel.items });
  });

  // ---- HOST: reclaim a room after reconnecting ----
  socket.on("host:reclaim-room", ({ code, token } = {}) => {
    if (!bindIdentity(token)) return;
    const room = roomService.reclaimHost(code, token);
    if (!room) {
      socket.emit("host:reclaim-failed", { code });
      return;
    }
    socket.join(room.code);
    socket.emit("host:room-reclaimed", {
      room: roomService.publicRoomView(room),
      games: gameRegistry.listGames(),
      gameId: room.gameId,
    });
    io.in(room.code).emit("room:host-reconnected", {});
  });
```

- [ ] **Step 4: Take the token on join, and announce a rejoin**

Replace `index.js:118-135` (the `player:join-room` handler) with:

```js
  // ---- PLAYER: join room ----
  socket.on("player:join-room", ({ code, nickname, token } = {}) => {
    if (!bindIdentity(token)) {
      socket.emit("player:join-error", { error: "Missing or malformed session token" });
      return;
    }
    const result = roomService.joinRoom(code, token, nickname);
    if (result.error) {
      socket.emit("player:join-error", { error: result.error });
      return;
    }
    const room = result.room;
    socket.join(room.code);
    socket.emit(result.rejoined ? "player:rejoined" : "player:joined", {
      room: roomService.publicRoomView(room),
    });
    socket.emit("wheel:list-updated", { items: room.punishmentWheel.items });

    // A returning player has lost every private message the game sent them,
    // so let the game module re-send whatever that player is entitled to see.
    if (result.rejoined && room.gameId && room.gameState) {
      const game = gameRegistry.getGame(room.gameId);
      if (game && game.onPlayerRejoined) game.onPlayerRejoined(room, io, token);
    }

    io.to(room.hostId).emit("host:room-updated", {
      room: roomService.publicRoomView(room),
    });
    io.in(room.code).emit("room:player-list", {
      players: roomService.publicRoomView(room).players,
    });
  });
```

- [ ] **Step 5: Switch host authorisation to the token**

At each of `index.js:98`, `:139`, `:290`, `:332`, replace

```js
    if (!room || room.hostSocketId !== socket.id) return;
```

with

```js
    if (!room || room.hostId !== socket.data.token) return;
```

At `index.js:313`, replace

```js
    if (socket.id === room.hostSocketId) {
```

with

```js
    if (socket.data.token === room.hostId) {
```

- [ ] **Step 6: Rewrite the disconnect handler**

Replace `index.js:340-360` (the whole `socket.on("disconnect", ...)` body) with:

```js
  // ---- Disconnect handling ----
  socket.on("disconnect", () => {
    const token = socket.data.token;
    if (!token) return;

    const result = roomService.markPlayerDisconnected(token);
    if (result) {
      const { room, removed } = result;
      // Only tell the game someone left if the seat is actually gone. A
      // mid-game drop keeps the seat, and telling the game otherwise is what
      // used to destroy the position.
      if (removed && room.gameId && room.gameState) {
        const game = gameRegistry.getGame(room.gameId);
        if (game && game.onPlayerLeft) game.onPlayerLeft(room, io, token);
      }
      io.to(room.hostId).emit("host:room-updated", {
        room: roomService.publicRoomView(room),
      });
      io.in(room.code).emit("room:player-list", {
        players: roomService.publicRoomView(room).players,
      });
    }

    const hostedRoom = roomService.markHostDisconnected(token);
    if (hostedRoom) {
      io.in(hostedRoom.code).emit("room:host-disconnected", {});
    }
  });
});
```

- [ ] **Step 7: Rename the remaining `hostSocketId` emit targets in `index.js`**

Run: `grep -n "hostSocketId" index.js`
Replace every remaining occurrence with `hostId`. Expected remaining sites: the two `io.to(room.hostSocketId).emit("host:room-updated", ...)` calls, both already rewritten in Steps 4 and 6 — confirm the grep returns nothing.

- [ ] **Step 8: Start the sweeper**

Add immediately before `server.listen(...)` at the bottom of `index.js`:

```js
// Rooms are no longer emptied by disconnects, so reclaim abandoned ones on a
// timer. Unref so the interval never keeps the process alive on its own.
const ROOM_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => roomService.sweepAbandonedRooms(), ROOM_SWEEP_INTERVAL_MS).unref();
```

- [ ] **Step 9: Verify the server still boots**

Run: `node --check index.js && node --test "test/*.test.js"`
Expected: syntax OK; unit tests pass. The e2e scripts will fail until Task 6 updates the game modules' host field — that is expected and is fixed next.

- [ ] **Step 10: Commit**

```bash
git add index.js
git commit -m "feat: identify sockets by session token and survive disconnects"
```

---

### Task 6: Rename `hostSocketId` to `hostId` across the games

**Files:**
- Modify: `games/findTheImposter.js:94,137,143,231,295,326`, `games/wordWolf.js:70,132,198`, `games/slipUp.js:46`
- Test: the six existing `test/e2e-*.js` scripts

A field named `hostSocketId` that holds a token is a trap for whoever reads it next. The rename is mechanical and the e2e suites cover every one of these emit sites.

- [ ] **Step 1: Confirm the current failure**

Run: `node test/e2e-rounds.js`
Expected: FAIL — host-directed events never arrive, because `room.hostSocketId` is now `undefined`

- [ ] **Step 2: Find every occurrence**

Run: `grep -rn "hostSocketId" games/`
Expected: 10 lines across `findTheImposter.js`, `wordWolf.js`, `slipUp.js`

- [ ] **Step 3: Replace them**

In each of the three files, replace every `room.hostSocketId` with `room.hostId`. Change nothing else — these are emit targets only, and `io.to()` resolves the token as a socket.io room exactly as it resolved a socket id.

- [ ] **Step 4: Confirm none remain**

Run: `grep -rn "hostSocketId" . --exclude-dir=node_modules`
Expected: no output

- [ ] **Step 5: Run every end-to-end suite**

Run:

```bash
node test/e2e-rounds.js && node test/e2e-audio-sources.js && node test/e2e-word-wolf.js \
  && node test/e2e-slip-up.js && node test/e2e-wheel.js && node test/e2e-avalon.js
```

Expected: all six report their pass banner. Note these scripts create rooms through the socket API, so they must be updated to send a token — if they fail with "Missing or malformed session token", add a token to their `host:create-room` and `player:join-room` payloads (any string matching `^[A-Za-z0-9_-]{8,64}$`, unique per simulated client).

- [ ] **Step 6: Commit**

```bash
git add games/ test/
git commit -m "refactor: rename room.hostSocketId to room.hostId"
```

---

### Task 7: End-to-end proof that a seat survives

**Files:**
- Create: `test/e2e-reconnect.js`
- Test: itself

**Interfaces:**
- Consumes: everything from Tasks 1–6
- Produces: nothing other tasks depend on

- [ ] **Step 1: Write the failing test**

Create `test/e2e-reconnect.js`, modelled on the structure of `test/e2e-rounds.js` (read it first for the boot/connect helpers this repo already uses):

```js
// e2e-reconnect.js
// Proves the durable-session guarantee: a player who drops mid-game and comes
// back with the same token gets the same seat, and a host who drops does not
// destroy the room.

const { spawn } = require("child_process");
const { io: connect } = require("socket.io-client");

const PORT = 3210;
const URL = `http://127.0.0.1:${PORT}`;
const HOST_TOKEN = "e2e-host-token-0001";
const P1 = "e2e-player-token-001";
const P2 = "e2e-player-token-002";
const P3 = "e2e-player-token-003";

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function main() {
  const server = spawn(process.execPath, ["index.js"], {
    env: { ...process.env, PORT: String(PORT) },
  });
  await new Promise((resolve) => {
    server.stdout.on("data", (d) => {
      if (d.toString().includes("Server running on port")) resolve();
    });
  });

  const host = connect(URL);
  await once(host, "connect");
  host.emit("host:create-room", { token: HOST_TOKEN });
  const { room } = await once(host, "host:room-created");
  const code = room.code;

  const players = [];
  for (const token of [P1, P2, P3]) {
    const s = connect(URL);
    await once(s, "connect");
    s.emit("player:join-room", { code, nickname: `P-${token.slice(-1)}`, token });
    await once(s, "player:joined");
    players.push({ socket: s, token });
  }

  // Put the room into a running game so seats become load-bearing.
  host.emit("host:select-game", { code, gameId: "word-wolf" });
  await once(host, "host:game-selected");
  host.emit("host:word-wolf-start", { code });
  await once(host, "game:started");

  // --- a player drops and returns ---
  players[0].socket.disconnect();
  await new Promise((r) => setTimeout(r, 200));

  const returning = connect(URL);
  await once(returning, "connect");
  returning.emit("player:join-room", { code, nickname: "ignored-on-rejoin", token: P1 });
  const rejoin = await once(returning, "player:rejoined");

  const seat = rejoin.room.players.find((p) => p.id === P1);
  if (!seat) throw new Error("FAIL: the reclaimed seat is missing from the room");
  if (seat.nickname !== "P-1") throw new Error("FAIL: rejoin overwrote the nickname");
  if (rejoin.room.players.length !== 3) {
    throw new Error(`FAIL: expected 3 seats, saw ${rejoin.room.players.length}`);
  }
  console.log("  PASS — a mid-game disconnect keeps the seat and the same token reclaims it");

  // --- a stranger still cannot walk in ---
  const stranger = connect(URL);
  await once(stranger, "connect");
  stranger.emit("player:join-room", { code, nickname: "Gatecrasher", token: "e2e-stranger-0001" });
  const refused = await once(stranger, "player:join-error");
  if (refused.error !== "Game already in progress") {
    throw new Error(`FAIL: expected the in-progress gate, saw "${refused.error}"`);
  }
  console.log("  PASS — an unknown token is still refused mid-game");

  // --- the host drops and reclaims ---
  host.disconnect();
  await new Promise((r) => setTimeout(r, 200));

  const host2 = connect(URL);
  await once(host2, "connect");
  host2.emit("host:reclaim-room", { code, token: HOST_TOKEN });
  const reclaimed = await once(host2, "host:room-reclaimed");
  if (reclaimed.room.code !== code) throw new Error("FAIL: host could not reclaim the room");
  if (reclaimed.room.players.length !== 3) {
    throw new Error("FAIL: reclaiming the room lost players");
  }
  console.log("  PASS — a host disconnect does not destroy the room");

  [returning, stranger, host2, players[1].socket, players[2].socket].forEach((s) => s.disconnect());
  server.kill();
  console.log("\nALL RECONNECT E2E SCENARIOS PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `node test/e2e-reconnect.js`
Expected: three PASS lines then `ALL RECONNECT E2E SCENARIOS PASSED`.

If the game-start event names in the script do not match reality, read the actual names out of `index.js` (`grep -n "host:word-wolf" index.js`) and correct the script — do not weaken an assertion to make it pass.

- [ ] **Step 3: Add it to package.json**

In `package.json`, add to `scripts`:

```json
    "test:e2e-reconnect": "node test/e2e-reconnect.js",
```

- [ ] **Step 4: Commit**

```bash
git add test/e2e-reconnect.js package.json
git commit -m "test: end-to-end proof that seats and rooms survive disconnects"
```

---

### Task 8: Browser session token

**Files:**
- Create: `public/shared/session.js`
- Modify: `public/host/index.html`, `public/player/index.html` (add the script tag), `public/host/host.js:40-42`, `public/player/player.js` (the join emit)
- Test: manual, per the checklist in Step 6

**Interfaces:**
- Consumes: nothing
- Produces: `window.sessionToken` — a string matching `^[A-Za-z0-9_-]{8,64}$`, stable across reloads

- [ ] **Step 1: Write the token helper**

Create `public/shared/session.js`:

```js
// session.js
// The player's identity, persisted so a reload or a dropped connection can
// reclaim the same seat. Loaded before the page script; exposes one global.
(function () {
  const STORAGE_KEY = "party-session-token";

  function makeToken() {
    if (window.crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  let token = null;
  try {
    token = localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    token = null; // private browsing: fall through to a per-page token
  }

  if (!token) {
    token = makeToken();
    try {
      localStorage.setItem(STORAGE_KEY, token);
    } catch (err) {
      // Not persisted — reconnection will not work, but nothing breaks.
    }
  }

  window.sessionToken = token;
})();
```

- [ ] **Step 2: Load it before the page scripts**

In `public/host/index.html` and `public/player/index.html`, add immediately before the existing page `<script>` tag:

```html
    <script src="/shared/session.js"></script>
```

`public/` is already served statically (`index.js:28`), so `/shared/session.js` resolves with no server change.

- [ ] **Step 3: Send the token when creating a room**

In `public/host/host.js`, replace the create-room emit (`host.js:39-41`):

```js
document.getElementById("btn-create-room").addEventListener("click", () => {
  socket.emit("host:create-room", { token: window.sessionToken });
});
```

- [ ] **Step 4: Send the token when joining**

In `public/player/player.js`, find the `player:join-room` emit (`grep -n "player:join-room" public/player/player.js`) and add `token: window.sessionToken` to its payload object, leaving `code` and `nickname` as they are.

- [ ] **Step 5: Handle the rejoin acknowledgement**

In `public/player/player.js`, immediately after the existing `socket.on("player:joined", ...)` handler, add:

```js
// A rejoin lands here instead of player:joined. The room view is the same
// shape, so reuse the same screen transition; the game module re-sends this
// player's private state separately.
socket.on("player:rejoined", ({ room }) => {
  roomCode = room.code;
  showScreen("lobby");
});
```

Check the surrounding handler for the exact variable and function names in use (`grep -n "player:joined" -A 6 public/player/player.js`) and match them.

- [ ] **Step 6: Verify by hand**

Start the server (`npm start`), then:

1. Open `/host/`, create a room. In DevTools console run `localStorage.getItem("party-session-token")` — expect a token string.
2. Open `/player/` in a second browser (or a private window with its own storage), join the room, note the nickname appears on the host screen.
3. Reload the player tab. Expect the player to return to the lobby without re-entering a nickname, and the host player list to show the same single player — **not** two.
4. Reload the host tab. Expect the room to still exist server-side; the host page will need `host:reclaim-room` wiring, which is Task 9.

- [ ] **Step 7: Commit**

```bash
git add public/shared/session.js public/host/index.html public/player/index.html public/host/host.js public/player/player.js
git commit -m "feat: persist a session token in the browser and send it on join"
```

---

### Task 9: Host page reclaims its room after a reload

**Files:**
- Modify: `public/host/host.js` (store the code, reclaim on connect)
- Test: manual, per Step 4

**Interfaces:**
- Consumes: `host:reclaim-room` / `host:room-reclaimed` / `host:reclaim-failed` (Task 5), `window.sessionToken` (Task 8)
- Produces: nothing other tasks depend on

Without this, the room survives a host reload but the host page cannot find its way back — which is the exact failure the whole plan exists to prevent, since the host tab is on the phone Android will background.

- [ ] **Step 1: Remember the room code**

In `public/host/host.js`, inside the existing `socket.on("host:room-created", ...)` handler (`host.js:43`), add as the first line of the body:

```js
  try { localStorage.setItem("party-host-room", room.code); } catch (err) {}
```

- [ ] **Step 2: Attempt a reclaim on every connect**

Add near the top of `public/host/host.js`, after `const socket = io();`:

```js
// The host tab lives on the phone that is also running the server, so Android
// backgrounding it is routine. On every (re)connect, try to walk back into the
// room this tab was last hosting.
socket.on("connect", () => {
  let lastCode = null;
  try { lastCode = localStorage.getItem("party-host-room"); } catch (err) {}
  if (lastCode) {
    socket.emit("host:reclaim-room", { code: lastCode, token: window.sessionToken });
  }
});
```

- [ ] **Step 3: Handle both outcomes**

Add alongside the other socket handlers in `public/host/host.js`:

```js
socket.on("host:room-reclaimed", ({ room, games }) => {
  roomCode = room.code;
  document.getElementById("room-code").textContent = room.code;
  renderJoinInfo();
  gamesById = Object.fromEntries(games.map((g) => [g.id, g]));
  renderGameList(games);
  renderPlayers(room.players);
  showScreen("lobby");
});

socket.on("host:reclaim-failed", () => {
  // The room is gone (swept, or the server restarted). Forget it so the next
  // connect does not keep asking.
  try { localStorage.removeItem("party-host-room"); } catch (err) {}
});
```

Reclaiming returns the host to the lobby rather than to the mid-game screen they left. That is a deliberate limitation of this plan: the room, the players and the game state all survive, and the host re-enters the game through the normal screen flow. Restoring the exact mid-game host screen is game-specific and belongs with each game.

- [ ] **Step 4: Verify by hand**

1. `npm start`, open `/host/`, create a room, join from a second browser.
2. Reload the host tab. Expect it to land back in the lobby showing the same room code and the same player still listed.
3. Stop the server, reload the host tab. Expect it to fall back to the start screen with no console errors (the reclaim fails and clears the stored code).

- [ ] **Step 5: Commit**

```bash
git add public/host/host.js
git commit -m "feat: host page reclaims its room after a reload"
```

---

### Task 10: Give returning players their private state back

**Files:**
- Modify: `games/avalon.js`, `games/wordWolf.js`, `games/slipUp.js`, `games/findTheImposter.js` (add `onPlayerRejoined` and export it)
- Test: `test/e2e-reconnect.js` (extend)

**Interfaces:**
- Consumes: the `game.onPlayerRejoined(room, io, playerId)` call added in Task 5, Step 4
- Produces: nothing other tasks depend on

A reclaimed seat is only half the fix: every private message the game sent that player — their role, their word, their audio track — was delivered to a socket that no longer exists.

- [ ] **Step 1: Write the failing assertion**

In `test/e2e-reconnect.js`, after the existing rejoin assertions, add:

```js
  // The returning player must get their secret word back, not a blank screen.
  const wordAgain = await once(returning, "game:your-word");
  if (!wordAgain || !wordAgain.word) {
    throw new Error("FAIL: a rejoining player was not re-sent their word");
  }
  console.log("  PASS — a rejoining player is re-sent their private state");
```

Place it before the "stranger" section, and register the listener with `once(returning, "game:your-word")` **before** emitting the rejoin so the event is not missed. Confirm the real event name first: `grep -n "your-word\|game:your" games/wordWolf.js`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node test/e2e-reconnect.js`
Expected: FAIL — the assertion times out or throws, because no game implements `onPlayerRejoined`

- [ ] **Step 3: Implement it for Word Wolf**

In `games/wordWolf.js`, add before `module.exports` — reusing whatever the module already does to send one player their word (read the start-game path first and call the same code):

```js
// A reconnecting player lost the private word we sent to their old socket.
function onPlayerRejoined(room, io, playerId) {
  const state = room.gameState;
  if (!state || !state.words) return;
  const word = state.words[playerId];
  if (!word) return;
  io.to(playerId).emit("game:your-word", { word });
}
```

Adjust the state property names to match the module's real shape, then add `onPlayerRejoined` to its exports.

- [ ] **Step 4: Run it to verify it passes**

Run: `node test/e2e-reconnect.js`
Expected: all PASS lines including the new one

- [ ] **Step 5: Implement it for the other three**

Following the same shape, each re-sending only what that player is entitled to see:

- `games/avalon.js` — re-emit `game:avalon-role` for this player (the same payload built at `avalon.js:147`) followed by the current `game:avalon-state`.
- `games/slipUp.js` — re-emit `game:your-view` with this player's `others` list (as at `slipUp.js:35`).
- `games/findTheImposter.js` — re-emit `game:load-audio` with this player's current track (as at `findTheImposter.js:91`). Do not attempt to resynchronise playback position; the player rejoins ready for the next `game:play-at`.

Export `onPlayerRejoined` from each.

- [ ] **Step 6: Full regression**

Run:

```bash
node --test "test/*.test.js" \
  && node test/e2e-rounds.js && node test/e2e-audio-sources.js && node test/e2e-word-wolf.js \
  && node test/e2e-slip-up.js && node test/e2e-wheel.js && node test/e2e-avalon.js \
  && node test/e2e-reconnect.js
```

Expected: unit count is at least 146 + 15 new = 161 passing, 0 failing; all seven e2e scripts report their pass banner.

- [ ] **Step 7: Commit**

```bash
git add games/ test/e2e-reconnect.js
git commit -m "feat: re-send a rejoining player their private game state"
```

---

### Task 11: Document the guarantee and its limits

**Files:**
- Modify: `docs/hosting-on-android.md`

The runbook currently presents `termux-wake-lock` as a recommendation. With no disk persistence it is the only thing standing between a backgrounded process and a lost game, so it has to read that way.

- [ ] **Step 1: Promote the wake lock**

In `docs/hosting-on-android.md`, under "One-time setup", change the wake-lock item from "Optional but recommended" to required, with this reasoning appended:

```markdown
   This is **required**, not optional. Game state lives only in the server
   process's memory — there is no save file. Players and the host can now drop
   their connections and reclaim their seats, but if Android kills the Node
   process itself, the game is gone.
```

- [ ] **Step 2: Add a reconnection row to the troubleshooting table**

```markdown
| A player's phone slept and they came back to a blank page | Expected — reloading `/player/` rejoins them to their seat automatically, as long as they use the same browser (the session token lives in that browser's storage). A different browser or a cleared cache is a new player. |
| The host tab reloaded and the game vanished | The room survives a host reload; the host lands back in the lobby, not the mid-game screen. Re-enter the game from there. If the server process itself restarted, the game is lost. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/hosting-on-android.md
git commit -m "docs: describe the reconnection guarantee and its limits"
```

---

## Known limitations of this plan

Stated so nobody discovers them mid-party:

- **No disk persistence.** A killed Node process loses the game. Accepted; recorded in the spec's §10.
- **The session token is per-browser.** A player who switches browsers, clears site data, or uses a private window is a new player and cannot reclaim their seat.
- **Host reclaim returns to the lobby**, not to the mid-game host screen. Room, players and game state survive; the host re-enters through the normal flow.
- **Find the Imposter does not resynchronise playback position** on rejoin; the returning player is ready for the next cue.

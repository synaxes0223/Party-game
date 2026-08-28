# Punishment Wheel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a room-level "punishment wheel" — a host-spinnable random picker over a shared, editable punishment list — that works independently of whatever game (if any) is active in the room.

**Architecture:** A new pure-logic module (`wheelLogic.js`, mirrors `slipUpLogic.js`) owns the item list's add/remove/default-seed rules. `room.punishmentWheel.items` is a new top-level field on the room object (seeded at `createRoom`, untouched by `host:reset-room`). Two new flat socket events (`wheel:add-punishment`, `wheel:remove-punishment`) are registered directly in `index.js` next to the other room-level events (not behind the `withHostGame` game-gate), broadcasting `wheel:list-updated`. Spinning itself is pure client-side random selection + canvas animation on the host's screen — no server round trip.

**Tech Stack:** Node.js + Express + Socket.io (existing), Node's built-in `node:test` + `node:assert/strict` for unit tests, `socket.io-client` for e2e, vanilla HTML/CSS/JS on the client (no new npm dependency — confirmed no canvas/animation library already present or needed).

## Global Constraints

- No length cap and no duplicate-detection on submitted punishment text (explicit product decision) — only reject empty/whitespace-only text.
- `room.punishmentWheel.items` persists across `host:reset-room` (that handler only clears `gameId`/`gameState`); it dies naturally when the room itself is torn down.
- Punishment removal is host-only; submission (add) is allowed from the host or any player.
- No new npm dependency — canvas spin animation uses the vanilla `<canvas>` 2D Context API.
- Default seed list: 10 generic PG punishments (exact text given in Task 1).
- The wheel is **not** registered in `games/registry.js` and must work with `room.gameId === null`.
- Spin/respin is client-side only on the host; there is no server `spin` event and no broadcast of spin results to players (host-only result visibility, per approved design).
- Players see a submit-only UI — they do not see the current item list.

---

### Task 1: `wheelLogic.js` — pure logic module

**Files:**
- Create: `server/games/wheelLogic.js`
- Test: `server/test/wheelLogic.test.js`

**Interfaces:**
- Produces: `DEFAULT_PUNISHMENTS: string[]`; `makeDefaultItems(): {id: string, text: string, addedBy: "default"}[]`; `addItem(items: Item[], {text: string, addedBy?: string, nickname?: string}): {items: Item[]} | {error: string}`; `removeItem(items: Item[], id: string): {items: Item[]}`. `Item` shape: `{id: string, text: string, addedBy: "default"|"host"|"player", nickname?: string}`.

- [ ] **Step 1: Write the failing test file**

Create `server/test/wheelLogic.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_PUNISHMENTS, makeDefaultItems, addItem, removeItem } = require("../games/wheelLogic");

test("DEFAULT_PUNISHMENTS has at least 10 non-empty string entries", () => {
  assert.ok(DEFAULT_PUNISHMENTS.length >= 10);
  DEFAULT_PUNISHMENTS.forEach((text) => {
    assert.equal(typeof text, "string");
    assert.ok(text.trim().length > 0);
  });
});

test("makeDefaultItems returns one item per DEFAULT_PUNISHMENTS entry, addedBy 'default'", () => {
  const items = makeDefaultItems();
  assert.equal(items.length, DEFAULT_PUNISHMENTS.length);
  items.forEach((item) => {
    assert.equal(typeof item.id, "string");
    assert.ok(item.id.length > 0);
    assert.equal(item.addedBy, "default");
    assert.equal(typeof item.text, "string");
  });
});

test("makeDefaultItems returns fresh distinct ids on every call", () => {
  const a = makeDefaultItems();
  const b = makeDefaultItems();
  const aIds = new Set(a.map((i) => i.id));
  const bIds = new Set(b.map((i) => i.id));
  assert.equal(aIds.size, a.length);
  a.forEach((item) => assert.ok(!bIds.has(item.id)));
});

test("addItem trims text and appends a new item with a generated id", () => {
  const result = addItem([], { text: "  Do 10 pushups  ", addedBy: "host" });
  assert.equal(result.error, undefined);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].text, "Do 10 pushups");
  assert.equal(result.items[0].addedBy, "host");
  assert.equal(typeof result.items[0].id, "string");
});

test("addItem rejects empty text", () => {
  const result = addItem([], { text: "", addedBy: "player" });
  assert.match(result.error, /required/i);
});

test("addItem rejects whitespace-only text", () => {
  const result = addItem([], { text: "   ", addedBy: "player" });
  assert.match(result.error, /required/i);
});

test("addItem rejects non-string text without throwing", () => {
  const result = addItem([], { text: 42, addedBy: "player" });
  assert.match(result.error, /required/i);
});

test("addItem does not mutate the input array", () => {
  const original = [{ id: "x", text: "existing", addedBy: "default" }];
  const result = addItem(original, { text: "new one", addedBy: "host" });
  assert.equal(original.length, 1);
  assert.equal(result.items.length, 2);
});

test("addItem includes nickname when provided and omits it when not", () => {
  const withNick = addItem([], { text: "a", addedBy: "player", nickname: "Alice" });
  assert.equal(withNick.items[0].nickname, "Alice");
  const withoutNick = addItem([], { text: "b", addedBy: "host" });
  assert.equal(withoutNick.items[0].nickname, undefined);
});

test("removeItem filters out the matching id and does not mutate the input array", () => {
  const original = [
    { id: "a", text: "one", addedBy: "default" },
    { id: "b", text: "two", addedBy: "default" },
  ];
  const result = removeItem(original, "a");
  assert.equal(original.length, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "b");
});

test("removeItem no-ops when the id is not found", () => {
  const original = [{ id: "a", text: "one", addedBy: "default" }];
  const result = removeItem(original, "does-not-exist");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "a");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd server && node --test test/wheelLogic.test.js`
Expected: FAIL — `Cannot find module '../games/wheelLogic'` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `server/games/wheelLogic.js`:

```js
// wheelLogic.js
// Pure logic for the punishment wheel's item list — no socket.io, no room
// state. Mirrors slipUpLogic.js's pure-function, non-throwing convention:
// every function returns a plain object, either { error } or { items }.

const crypto = require("crypto");

const DEFAULT_PUNISHMENTS = [
  "Sing a song of the group's choice",
  "Do 15 pushups",
  "Talk in a funny accent for the next 5 minutes",
  "Let the group draw something on your face with a washable marker",
  "Do your best impression of another player",
  "Speak only in questions for the next 3 minutes",
  "Do a dance for 30 seconds",
  "Tell an embarrassing story",
  "Let the group pick your profile picture for a day",
  "Act like a chicken for 1 minute",
];

function makeDefaultItems() {
  return DEFAULT_PUNISHMENTS.map((text) => ({
    id: crypto.randomUUID(),
    text,
    addedBy: "default",
  }));
}

function addItem(items, { text, addedBy, nickname }) {
  const trimmed = (typeof text === "string" ? text : "").trim();
  if (!trimmed) return { error: "Punishment text is required." };

  const newItem = {
    id: crypto.randomUUID(),
    text: trimmed,
    addedBy: addedBy || "player",
  };
  if (nickname) newItem.nickname = nickname;

  return { items: [...items, newItem] };
}

function removeItem(items, id) {
  return { items: items.filter((item) => item.id !== id) };
}

module.exports = { DEFAULT_PUNISHMENTS, makeDefaultItems, addItem, removeItem };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd server && node --test test/wheelLogic.test.js`
Expected: PASS — all 11 tests green, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add server/games/wheelLogic.js server/test/wheelLogic.test.js
git commit -m "feat: add punishment wheel pure-logic module"
```

---

### Task 2: Server wiring — room state, socket events, and e2e verification

**Files:**
- Modify: `server/roomService.js:1-30` (require + `createRoom`)
- Modify: `server/index.js:1-31` (require), `server/index.js:94-102` (`host:create-room`), `server/index.js:104-120` (`player:join-room`), and a new block inserted after `server/index.js:242` (`host:reset-room`'s closing brace) and before `server/index.js:244` (the `disconnect` handler)
- Create: `server/test/e2e-wheel.js`
- Modify: `server/package.json` (add `test:e2e-wheel` script)

**Interfaces:**
- Consumes: `wheelLogic.makeDefaultItems`, `wheelLogic.addItem`, `wheelLogic.removeItem` from Task 1.
- Produces: `room.punishmentWheel.items` field on every room object. Socket events — in: `wheel:add-punishment {code, text}`, `wheel:remove-punishment {code, id}`; out: `wheel:list-updated {items}` (targeted to a newly-created/joined socket, and broadcast to the room on every add/remove), `wheel:add-error {error}` (targeted to the sender only, on validation failure).

- [ ] **Step 1: Wire `room.punishmentWheel` into `roomService.js`**

Edit `server/roomService.js` — add the require after the existing header comment (line 3), and add the field inside `createRoom`'s returned object (currently `server/roomService.js:19-27`):

```js
// roomService.js
// Core platform service: room creation, joining, and player tracking.
// This is game-agnostic — any game module plugs into a room's `game` slot.

const wheelLogic = require("./games/wheelLogic");

const rooms = new Map(); // roomCode -> room object
```

```js
function createRoom(hostSocketId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostSocketId,
    state: "lobby", // lobby -> in-progress -> results
    players: new Map(), // socketId -> { id, nickname, ready }
    gameId: null,       // which game is selected, e.g. "find-the-imposter"
    gameState: null,    // opaque state owned by the game module
    punishmentWheel: { items: wheelLogic.makeDefaultItems() },
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}
```

- [ ] **Step 2: Wire the wheel socket events into `index.js`**

Edit `server/index.js` — add the require after the existing requires (`server/index.js:29-31`):

```js
const roomService = require("./roomService");
const gameRegistry = require("./games/registry");
const uploadStore = require("./games/uploadStore");
const wheelLogic = require("./games/wheelLogic");
```

Edit the `host:create-room` handler (`server/index.js:94-102`) to also send the initial wheel state to the creating host:

```js
  socket.on("host:create-room", () => {
    const room = roomService.createRoom(socket.id);
    socket.join(room.code);
    socket.emit("host:room-created", {
      room: roomService.publicRoomView(room),
      games: gameRegistry.listGames(),
    });
    socket.emit("wheel:list-updated", { items: room.punishmentWheel.items });
  });
```

Edit the `player:join-room` handler (`server/index.js:104-120`) to also send current wheel state to the newly-joined player:

```js
  // ---- PLAYER: join room ----
  socket.on("player:join-room", ({ code, nickname }) => {
    const result = roomService.joinRoom(code, socket.id, nickname);
    if (result.error) {
      socket.emit("player:join-error", { error: result.error });
      return;
    }
    const room = result.room;
    socket.join(room.code);
    socket.emit("player:joined", { room: roomService.publicRoomView(room) });
    socket.emit("wheel:list-updated", { items: room.punishmentWheel.items });
    io.to(room.hostSocketId).emit("host:room-updated", {
      room: roomService.publicRoomView(room),
    });
    io.in(room.code).emit("room:player-list", {
      players: roomService.publicRoomView(room).players,
    });
  });
```

Insert two new handlers directly after `host:reset-room`'s closing `});` (`server/index.js:242`) and before the `// ---- Disconnect handling ----` comment (`server/index.js:244`):

```js

  // ---- WHEEL: add a punishment (host or any player; room-level, works
  // regardless of which game, if any, is currently selected) ----
  socket.on("wheel:add-punishment", ({ code, text }) => {
    const room = roomService.getRoom(code);
    if (!room) return;

    let addedBy = "player";
    let nickname;
    if (socket.id === room.hostSocketId) {
      addedBy = "host";
    } else {
      const player = room.players.get(socket.id);
      if (player) nickname = player.nickname;
    }

    const result = wheelLogic.addItem(room.punishmentWheel.items, { text, addedBy, nickname });
    if (result.error) {
      socket.emit("wheel:add-error", { error: result.error });
      return;
    }
    room.punishmentWheel.items = result.items;
    io.in(room.code).emit("wheel:list-updated", { items: room.punishmentWheel.items });
  });

  // ---- WHEEL: remove a punishment (host only) ----
  socket.on("wheel:remove-punishment", ({ code, id }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;

    const result = wheelLogic.removeItem(room.punishmentWheel.items, id);
    room.punishmentWheel.items = result.items;
    io.in(room.code).emit("wheel:list-updated", { items: room.punishmentWheel.items });
  });
```

- [ ] **Step 3: Write the e2e scenario**

Create `server/test/e2e-wheel.js`:

```js
// e2e-wheel.js
// Full-stack punishment-wheel scenario over real sockets: room creation
// seeds the default list, a player join gets the same list, a player add
// broadcasts to everyone, a non-host remove is silently rejected, a host
// remove works, and the list survives host:reset-room. Run with:
//   node test/e2e-wheel.js

const path = require("path");
const { io: ioClient } = require("socket.io-client");

const PORT = 3100;
const URL = `http://localhost:${PORT}`;

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function connect() {
  const socket = ioClient(URL, { transports: ["websocket"] });
  return new Promise((resolve) => socket.once("connect", () => resolve(socket)));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function createRoom() {
  const host = await connect();
  const initialWheelPromise = once(host, "wheel:list-updated");
  host.emit("host:create-room");
  const { room } = await once(host, "host:room-created");
  const initialWheel = await initialWheelPromise;
  return { host, roomCode: room.code, initialWheel };
}

async function joinPlayer(roomCode, name) {
  const socket = await connect();
  const wheelPromise = once(socket, "wheel:list-updated");
  socket.emit("player:join-room", { code: roomCode, nickname: name });
  await Promise.race([
    once(socket, "player:joined"),
    once(socket, "player:join-error").then((e) => Promise.reject(new Error(e.error))),
  ]);
  const initialWheel = await wheelPromise;
  return { name, socket, initialWheel };
}

async function scenarioWheel() {
  const { host, roomCode, initialWheel } = await createRoom();

  assertTrue(initialWheel.items.length === 10, "host should see 10 default items on room creation");
  assertTrue(
    initialWheel.items.every((i) => i.addedBy === "default"),
    "all initial items should be addedBy 'default'"
  );

  const alice = await joinPlayer(roomCode, "Alice");
  const bob = await joinPlayer(roomCode, "Bob");

  assertTrue(alice.initialWheel.items.length === 10, "Alice should see the same 10 default items on join");
  assertTrue(
    JSON.stringify(alice.initialWheel.items.map((i) => i.id).sort()) ===
      JSON.stringify(initialWheel.items.map((i) => i.id).sort()),
    "Alice's initial item ids should match the host's"
  );

  // Alice (a player) submits a new punishment; host and Bob (the other
  // player) should both see the broadcast.
  const hostAfterAliceAdd = once(host, "wheel:list-updated");
  const bobAfterAliceAdd = once(bob.socket, "wheel:list-updated");
  alice.socket.emit("wheel:add-punishment", { code: roomCode, text: "  Do a cartwheel  " });
  const [afterAliceAddHost, afterAliceAddBob] = await Promise.all([hostAfterAliceAdd, bobAfterAliceAdd]);

  assertTrue(afterAliceAddHost.items.length === 11, "host should see 11 items after Alice's add");
  assertTrue(afterAliceAddBob.items.length === 11, "Bob should see 11 items after Alice's add");
  const aliceItem = afterAliceAddHost.items.find((i) => i.text === "Do a cartwheel");
  assertTrue(aliceItem, "Alice's item text should be trimmed and present");
  assertTrue(aliceItem.addedBy === "player" && aliceItem.nickname === "Alice", "Alice's item should be attributed to her");

  // Host submits empty text: should get wheel:add-error, no broadcast.
  const addErrorPromise = once(host, "wheel:add-error");
  host.emit("wheel:add-punishment", { code: roomCode, text: "   " });
  const addError = await addErrorPromise;
  assertTrue(/required/i.test(addError.error), "empty text should produce a 'required' error");

  // Bob (non-host) tries to remove Alice's item: must be silently rejected.
  // Verify by having the host add a distinguishable item afterward and
  // confirming the count only grew by 1 (Bob's removal did nothing) and
  // Alice's item is still present.
  const hostAfterHostAdd = once(host, "wheel:list-updated");
  bob.socket.emit("wheel:remove-punishment", { code: roomCode, id: aliceItem.id });
  host.emit("wheel:add-punishment", { code: roomCode, text: "Host-added marker" });
  const afterHostAdd = await hostAfterHostAdd;
  assertTrue(afterHostAdd.items.length === 12, "count should be 12 (Bob's remove was a no-op, host's add landed)");
  assertTrue(
    afterHostAdd.items.some((i) => i.id === aliceItem.id),
    "Alice's item should still be present after Bob's rejected removal"
  );

  // Host removes Alice's item: should succeed.
  const hostAfterRemove = once(host, "wheel:list-updated");
  host.emit("wheel:remove-punishment", { code: roomCode, id: aliceItem.id });
  const afterRemove = await hostAfterRemove;
  assertTrue(afterRemove.items.length === 11, "count should drop to 11 after host's valid removal");
  assertTrue(
    !afterRemove.items.some((i) => i.id === aliceItem.id),
    "Alice's item should be gone after host's removal"
  );

  // host:reset-room must NOT touch the wheel: a fresh join afterward should
  // still see the post-removal 11 items, not reset back to the 10 defaults.
  host.emit("host:reset-room", { code: roomCode });
  const carol = await joinPlayer(roomCode, "Carol");
  assertTrue(carol.initialWheel.items.length === 11, "wheel items should survive host:reset-room");

  host.close();
  [alice, bob, carol].forEach((p) => p.socket.close());
  console.log("scenarioWheel passed");
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    await scenarioWheel();
    console.log("All Wheel E2E scenarios passed.");
    process.exit(0);
  } catch (err) {
    console.error("Wheel E2E FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 4: Add the npm script**

Edit `server/package.json`'s `"scripts"` section (`server/package.json:7-14`) to add a new line after `"test:e2e-slipup"`:

```json
  "scripts": {
    "start": "node index.js",
    "test": "node --test \"test/*.test.js\"",
    "test:e2e": "node test/e2e-rounds.js",
    "test:e2e-audio": "node test/e2e-audio-sources.js",
    "test:e2e-word-wolf": "node test/e2e-word-wolf.js",
    "test:e2e-slipup": "node test/e2e-slip-up.js",
    "test:e2e-wheel": "node test/e2e-wheel.js"
  },
```

- [ ] **Step 5: Run the e2e scenario and verify it passes**

Run: `cd server && npm run test:e2e-wheel`
Expected: prints `scenarioWheel passed` then `All Wheel E2E scenarios passed.`, exits 0.

- [ ] **Step 6: Run the full unit suite to confirm nothing else broke**

Run: `cd server && npm test`
Expected: all existing test files plus `wheelLogic.test.js` pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add server/roomService.js server/index.js server/test/e2e-wheel.js server/package.json
git commit -m "feat: wire punishment wheel room state and socket events"
```

---

### Task 3: Host UI — floating wheel button, canvas spin, add/remove list

**Files:**
- Modify: `server/public/host/index.html:175` (insert new markup between `#app`'s closing `</div>` and the `<script>` tags)
- Modify: `server/public/host/style.css` (append new rules)
- Modify: `server/public/host/host.js` (append new script block at end of file)

**Interfaces:**
- Consumes: `wheel:list-updated {items}` and `wheel:add-error {error}` events, and emits `wheel:add-punishment {code, text}` / `wheel:remove-punishment {code, id}` (contract from Task 2). Reads the existing module-scope `socket` and `roomCode` variables already declared at the top of `host.js`.
- Produces: DOM ids `btn-wheel-toggle`, `wheel-panel`, `btn-wheel-close`, `wheel-canvas`, `btn-wheel-spin`, `wheel-result`, `wheel-add-input`, `btn-wheel-add`, `wheel-item-list` — not referenced by any other task.

- [ ] **Step 1: Add the floating button and panel markup**

Edit `server/public/host/index.html` — replace the closing of `#app` through the script tags (`server/public/host/index.html:175-180`):

```html
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/host/host.js"></script>
</body>
</html>
```

with:

```html
  </div>

  <button id="btn-wheel-toggle" class="wheel-floating-btn">🎡 Wheel</button>
  <div id="wheel-panel" class="wheel-panel hidden">
    <div class="wheel-panel-header">
      <h2>Punishment Wheel</h2>
      <button id="btn-wheel-close" class="wheel-close-btn">×</button>
    </div>
    <div class="wheel-pointer"></div>
    <canvas id="wheel-canvas" width="280" height="280"></canvas>
    <button id="btn-wheel-spin" class="btn-primary">Spin</button>
    <div id="wheel-result"></div>
    <div class="wheel-add-row">
      <input id="wheel-add-input" type="text" placeholder="Add a punishment..." />
      <button id="btn-wheel-add" class="btn-primary">Add</button>
    </div>
    <ul id="wheel-item-list"></ul>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/host/host.js"></script>
</body>
</html>
```

- [ ] **Step 2: Add the CSS**

Append to `server/public/host/style.css`:

```css
.wheel-floating-btn {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 100;
  padding: 14px 20px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  color: white;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}

.wheel-panel {
  position: fixed;
  bottom: 90px;
  right: 20px;
  z-index: 101;
  width: 320px;
  max-height: 70vh;
  overflow-y: auto;
  background: var(--panel);
  border-radius: var(--radius);
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.wheel-panel.hidden { display: none; }

.wheel-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.wheel-close-btn {
  background: none;
  border: none;
  color: var(--text);
  font-size: 1.5rem;
  cursor: pointer;
  line-height: 1;
}

.wheel-pointer {
  width: 0;
  height: 0;
  margin: 0 auto;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-top: 16px solid var(--text);
}

#wheel-canvas { display: block; margin: 0 auto 12px; }

#wheel-result {
  text-align: center;
  font-weight: 600;
  min-height: 1.5em;
  margin-bottom: 12px;
}

.wheel-add-row { display: flex; gap: 8px; margin: 12px 0; }
.wheel-add-row input {
  flex: 1;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid var(--accent2);
  background: transparent;
  color: var(--text);
}
.wheel-add-row button { width: auto; padding: 10px 14px; }

#wheel-item-list { list-style: none; padding: 0; margin: 0; }
#wheel-item-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.9rem;
}
#wheel-item-list li button {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 1.1rem;
}
```

- [ ] **Step 3: Add the client-side JS**

Append to `server/public/host/host.js`:

```js
// ---- Punishment Wheel (room-level, independent of any game) ----
let wheelItems = [];
let wheelSpinning = false;

const wheelPanel = document.getElementById("wheel-panel");
const wheelCanvas = document.getElementById("wheel-canvas");
const wheelCtx = wheelCanvas.getContext("2d");
const wheelColors = ["#ff5fa2", "#7c5cff", "#4ade80", "#facc15", "#38bdf8", "#f97316"];

document.getElementById("btn-wheel-toggle").addEventListener("click", () => {
  wheelPanel.classList.toggle("hidden");
});
document.getElementById("btn-wheel-close").addEventListener("click", () => {
  wheelPanel.classList.add("hidden");
});

document.getElementById("btn-wheel-add").addEventListener("click", () => {
  const input = document.getElementById("wheel-add-input");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("wheel:add-punishment", { code: roomCode, text });
  input.value = "";
});

document.getElementById("wheel-item-list").addEventListener("click", (e) => {
  if (!e.target.matches("[data-remove-id]")) return;
  socket.emit("wheel:remove-punishment", { code: roomCode, id: e.target.dataset.removeId });
});

document.getElementById("btn-wheel-spin").addEventListener("click", () => {
  if (wheelSpinning || wheelItems.length === 0) return;
  spinWheel();
});

socket.on("wheel:list-updated", ({ items }) => {
  wheelItems = items;
  renderWheelList();
  if (!wheelSpinning) drawWheel(0);
});

socket.on("wheel:add-error", ({ error }) => {
  alert(error);
});

function renderWheelList() {
  const list = document.getElementById("wheel-item-list");
  list.innerHTML = "";
  wheelItems.forEach((item) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = item.nickname ? `${item.text} (${item.nickname})` : item.text;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.dataset.removeId = item.id;
    li.appendChild(label);
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

function drawWheel(rotation) {
  const size = wheelCanvas.width;
  const center = size / 2;
  const radius = center - 4;
  wheelCtx.clearRect(0, 0, size, size);
  if (wheelItems.length === 0) return;

  const sliceAngle = (2 * Math.PI) / wheelItems.length;
  wheelCtx.save();
  wheelCtx.translate(center, center);
  wheelCtx.rotate(rotation);
  wheelItems.forEach((item, i) => {
    const start = i * sliceAngle;
    const end = start + sliceAngle;
    wheelCtx.beginPath();
    wheelCtx.moveTo(0, 0);
    wheelCtx.arc(0, 0, radius, start, end);
    wheelCtx.closePath();
    wheelCtx.fillStyle = wheelColors[i % wheelColors.length];
    wheelCtx.fill();

    wheelCtx.save();
    wheelCtx.rotate(start + sliceAngle / 2);
    wheelCtx.textAlign = "right";
    wheelCtx.fillStyle = "#16121f";
    wheelCtx.font = "11px sans-serif";
    const label = item.text.length > 18 ? item.text.slice(0, 17) + "…" : item.text;
    wheelCtx.fillText(label, radius - 6, 4);
    wheelCtx.restore();
  });
  wheelCtx.restore();
}

function spinWheel() {
  wheelSpinning = true;
  document.getElementById("btn-wheel-spin").disabled = true;
  document.getElementById("wheel-result").textContent = "";

  const winnerIndex = Math.floor(Math.random() * wheelItems.length);
  const sliceAngle = (2 * Math.PI) / wheelItems.length;
  // Canvas angle 0 is at 3 o'clock, increasing clockwise. The pointer is
  // fixed visually at the top (12 o'clock == angle -PI/2). Land the winning
  // slice's center under the pointer, plus a few full spins for effect.
  const targetSliceCenter = winnerIndex * sliceAngle + sliceAngle / 2;
  const extraSpins = 4 * 2 * Math.PI;
  const finalRotation = extraSpins + (-Math.PI / 2 - targetSliceCenter);

  const durationMs = 3000;
  const startTime = performance.now();

  function animate(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / durationMs, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    drawWheel(finalRotation * eased);
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      wheelSpinning = false;
      document.getElementById("btn-wheel-spin").disabled = false;
      document.getElementById("wheel-result").textContent = wheelItems[winnerIndex].text;
    }
  }
  requestAnimationFrame(animate);
}
```

- [ ] **Step 4: Manual verification**

Run: `cd server && npm start`

1. Open `http://localhost:3000/host/` in a browser tab and create a room.
2. Confirm a "🎡 Wheel" button is visible in the bottom-right corner on the start/lobby screen.
3. Click it — a panel opens showing a 10-slice colored wheel, a pointer above it, a Spin button, an empty-looking result line, an add-punishment input, and a list of the 10 default punishments each with an "×".
4. Navigate to a different host screen (e.g. select a game) — confirm the "🎡 Wheel" button and panel (if left open) remain visible, unaffected by the screen change.
5. Click Spin — confirm the wheel animates and settles, the Spin button is disabled during the animation and re-enabled after, and the landed punishment's text appears below the wheel.
6. Click Spin again (respin) — confirm it can land on a different (or the same) result each time.
7. Type a new punishment into the input and click Add — confirm it appears at the bottom of the list immediately.
8. Click "×" next to an item — confirm it's removed from the list immediately.
9. Click "×" on every remaining item until the list is empty — confirm the wheel canvas goes blank and clicking Spin does nothing (no animation, no error), per the zero-items edge case.

- [ ] **Step 5: Commit**

```bash
git add server/public/host/index.html server/public/host/style.css server/public/host/host.js
git commit -m "feat: add host punishment wheel UI (spin, add, remove)"
```

---

### Task 4: Player UI — floating submit button

**Files:**
- Modify: `server/public/player/index.html:80` (insert new markup between `#app`'s closing `</div>` and the `<audio>` element)
- Modify: `server/public/player/style.css` (append new rules, same block as Task 3's host CSS)
- Modify: `server/public/player/player.js` (append new script block at end of file)

**Interfaces:**
- Consumes: `wheel:add-error {error}` event, and emits `wheel:add-punishment {code, text}` (contract from Task 2). Reads the existing module-scope `socket` and `roomCode` variables already declared at the top of `player.js`.
- Produces: DOM ids `btn-wheel-submit-toggle`, `wheel-submit-panel`, `btn-wheel-submit-close`, `wheel-submit-input`, `btn-wheel-submit`, `wheel-submit-status` — not referenced by any other task.

- [ ] **Step 1: Add the floating button and panel markup**

Edit `server/public/player/index.html` — replace `#app`'s closing through the audio elements (`server/public/player/index.html:80-86`):

```html
  </div>

  <audio id="audio-player" preload="auto"></audio>
  <div id="youtube-player-container" style="position:absolute; left:-9999px; width:1px; height:1px;"></div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/player/player.js"></script>
</body>
</html>
```

with:

```html
  </div>

  <button id="btn-wheel-submit-toggle" class="wheel-floating-btn">🎯 Punishment idea</button>
  <div id="wheel-submit-panel" class="wheel-panel hidden">
    <div class="wheel-panel-header">
      <h2>Suggest a Punishment</h2>
      <button id="btn-wheel-submit-close" class="wheel-close-btn">×</button>
    </div>
    <div class="wheel-add-row">
      <input id="wheel-submit-input" type="text" placeholder="Your punishment idea..." />
      <button id="btn-wheel-submit" class="btn-primary">Submit</button>
    </div>
    <div id="wheel-submit-status"></div>
  </div>

  <audio id="audio-player" preload="auto"></audio>
  <div id="youtube-player-container" style="position:absolute; left:-9999px; width:1px; height:1px;"></div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/player/player.js"></script>
</body>
</html>
```

- [ ] **Step 2: Add the CSS**

Append to `server/public/player/style.css` the identical block added to `server/public/host/style.css` in Task 3 Step 2 (`.wheel-floating-btn`, `.wheel-panel`, `.wheel-panel.hidden`, `.wheel-panel-header`, `.wheel-close-btn`, `.wheel-pointer`, `.wheel-add-row`, `.wheel-add-row input`, `.wheel-add-row button`) — omit the `#wheel-canvas`, `#wheel-result`, and `#wheel-item-list` rules since the player panel has no canvas or list.

- [ ] **Step 3: Add the client-side JS**

Append to `server/public/player/player.js`:

```js
// ---- Punishment Wheel submission (room-level, independent of any game) ----
const wheelSubmitPanel = document.getElementById("wheel-submit-panel");

document.getElementById("btn-wheel-submit-toggle").addEventListener("click", () => {
  wheelSubmitPanel.classList.toggle("hidden");
});
document.getElementById("btn-wheel-submit-close").addEventListener("click", () => {
  wheelSubmitPanel.classList.add("hidden");
});

document.getElementById("btn-wheel-submit").addEventListener("click", submitPunishment);
document.getElementById("wheel-submit-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitPunishment();
});

function submitPunishment() {
  const input = document.getElementById("wheel-submit-input");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("wheel:add-punishment", { code: roomCode, text });
  input.value = "";
  const status = document.getElementById("wheel-submit-status");
  status.textContent = "Added!";
  setTimeout(() => { status.textContent = ""; }, 2000);
}

socket.on("wheel:add-error", ({ error }) => {
  document.getElementById("wheel-submit-status").textContent = error;
});
```

- [ ] **Step 4: Manual verification**

Run: `cd server && npm start` (skip if still running from Task 3)

1. Open `http://localhost:3000/host/` in one tab, create a room, note the room code.
2. Open `http://localhost:3000/player/` in a second tab, join with the room code and a nickname.
3. Confirm a "🎯 Punishment idea" button is visible in the bottom-right corner on the player's join/waiting screen.
4. Click it, type a punishment, click Submit — confirm the input clears and a brief "Added!" message appears, then fades after ~2 seconds.
5. On the host tab, open the wheel panel — confirm the just-submitted punishment appears in the list, labeled with the player's nickname.
6. On the player tab, submit an empty string (click Submit with nothing typed) — confirm nothing happens (no error, no network call, matching the client-side guard).

- [ ] **Step 5: Commit**

```bash
git add server/public/player/index.html server/public/player/style.css server/public/player/player.js
git commit -m "feat: add player punishment-suggestion UI"
```

---

### Task 5: Full regression pass

**Files:** none (verification only).

**Interfaces:** none — this task only runs existing and newly-added test suites.

- [ ] **Step 1: Run the full unit test suite**

Run: `cd server && npm test`
Expected: every `test/*.test.js` file passes, including `wheelLogic.test.js`, 0 fail.

- [ ] **Step 2: Run every e2e scenario**

Run:
```bash
cd server
npm run test:e2e
npm run test:e2e-audio
npm run test:e2e-word-wolf
npm run test:e2e-slipup
npm run test:e2e-wheel
```
Expected: every script prints its own "passed"/"All ... passed." lines and exits 0 — confirms the new wheel wiring didn't regress any existing game's socket flow (all room-level events like `player:join-room` and `host:reset-room` were touched in Task 2).

- [ ] **Step 3: Confirm no leftover uncommitted changes**

Run: `git status`
Expected: clean working tree (everything from Tasks 1-4 already committed).

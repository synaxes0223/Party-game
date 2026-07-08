# Find the Imposter — Round Elimination & Host Playback Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-round "Find the Imposter" prototype into a multi-round elimination game with host-selectable track pairs and host-driven Play/Pause/Resume/Restart audio controls.

**Architecture:** Pure round-resolution rules (majority vote, win conditions, elapsed-time math) live in a new `imposterLogic.js` with no `io`/`room` dependencies, so they're unit-testable in isolation. `findTheImposter.js` owns the round/elimination state machine and calls into `imposterLogic.js`; it's the only game module, and stays the only file that knows about rooms/sockets on the "game" side. `index.js` gets a handful of new hardcoded socket events, following the existing per-event pattern (no generic dispatcher). Host/player web pages get new screens for track selection, playback controls, and per-round reveals.

**Tech Stack:** Node.js (v24.13.1 confirmed installed), Express, Socket.io v4, vanilla JS/HTML/CSS on the client, Node's built-in test runner (`node:test`) for unit tests, `socket.io-client` (new devDependency) for live E2E checks.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-imposter-round-elimination-design.md` — every requirement in this plan traces back to it.
- All server-side changes are confined to `party-platform-full/party-game-platform/server/` — no changes to `party-host-app/` (Android scaffold) in this plan.
- No new runtime dependencies for the server itself — only `socket.io-client` as a **devDependency** for testing.
- `meta.minPlayers` stays `3` (unchanged) — guarantees at least one elimination round is possible before the 2-active-player end state.
- Self-voting is rejected server-side, not just hidden in the UI.
- No timers anywhere in the round/voting flow — every phase transition is host- or player-triggered.
- Existing platform limitation (no reconnect/session-recovery support) is NOT being fixed by this plan — disconnect handling only needs to avoid blocking round resolution for the players who remain.

All file paths below are relative to `C:\Users\Asus\Desktop\source\party_game\party-platform-full\party-game-platform\server\`.

---

### Task 1: Pure round-resolution logic (`imposterLogic.js`)

**Files:**
- Create: `games/imposterLogic.js`
- Test: `test/imposterLogic.test.js`

**Interfaces:**
- Produces: `SYNC_BUFFER_MS` (number, ms), `resolveRound(activePlayerIds: string[], votes: Map<string,string>): {eliminatedId: string|null, tally: Record<string,number>}`, `checkGameEnd(remainingActiveIds: string[], eliminatedId: string|null, imposterId: string): {gameOver: boolean, winner: "crew"|"imposter"|null}`, `computeElapsedMs(segmentStartedAtMs: number, atMs: number): number`. These four names/signatures are consumed by Task 2.

- [ ] **Step 1: Write the failing test file**

Create `test/imposterLogic.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveRound, checkGameEnd, computeElapsedMs } = require("../games/imposterLogic");

test("resolveRound eliminates a player with strict majority", () => {
  const votes = new Map([
    ["p1", "p2"],
    ["p2", "p2"],
    ["p3", "p1"],
  ]);
  const result = resolveRound(["p1", "p2", "p3"], votes);
  assert.equal(result.eliminatedId, "p2");
  assert.deepEqual(result.tally, { p2: 2, p1: 1 });
});

test("resolveRound returns no elimination when skip wins", () => {
  const votes = new Map([
    ["p1", "skip"],
    ["p2", "skip"],
    ["p3", "p1"],
  ]);
  const result = resolveRound(["p1", "p2", "p3"], votes);
  assert.equal(result.eliminatedId, null);
});

test("resolveRound returns no elimination when no majority is reached", () => {
  const votes = new Map([
    ["p1", "p2"],
    ["p2", "p3"],
    ["p3", "p1"],
    ["p4", "p2"],
  ]);
  // threshold = floor(4/2)+1 = 3; p2 has only 2 votes, nobody reaches 3
  const result = resolveRound(["p1", "p2", "p3", "p4"], votes);
  assert.equal(result.eliminatedId, null);
});

test("checkGameEnd declares crew win when the eliminated player was the imposter", () => {
  const result = checkGameEnd(["p1", "p3"], "p2", "p2");
  assert.deepEqual(result, { gameOver: true, winner: "crew" });
});

test("checkGameEnd declares imposter win once only 2 active players remain", () => {
  const result = checkGameEnd(["p1", "p2"], "p3", "p2");
  assert.deepEqual(result, { gameOver: true, winner: "imposter" });
});

test("checkGameEnd continues the game when neither end condition is met", () => {
  const result = checkGameEnd(["p1", "p2", "p3"], "p4", "p2");
  assert.deepEqual(result, { gameOver: false, winner: null });
});

test("computeElapsedMs floors at zero", () => {
  assert.equal(computeElapsedMs(1000, 1500), 500);
  assert.equal(computeElapsedMs(1000, 500), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/imposterLogic.test.js`
Expected: FAIL — `Cannot find module '../games/imposterLogic'`

- [ ] **Step 3: Write the implementation**

Create `games/imposterLogic.js`:

```js
// imposterLogic.js
// Pure game-rule functions for Find the Imposter's round/elimination mechanics.
// No socket.io or room state here — plain data in, plain data out — so these
// rules are unit-testable without spinning up a server.

const SYNC_BUFFER_MS = 1500;

function resolveRound(activePlayerIds, votes) {
  const tally = {};
  for (const targetId of votes.values()) {
    tally[targetId] = (tally[targetId] || 0) + 1;
  }

  const threshold = Math.floor(activePlayerIds.length / 2) + 1;
  let eliminatedId = null;
  for (const [targetId, count] of Object.entries(tally)) {
    if (targetId !== "skip" && count >= threshold) {
      eliminatedId = targetId;
      break;
    }
  }

  return { eliminatedId, tally };
}

function checkGameEnd(remainingActiveIds, eliminatedId, imposterId) {
  if (eliminatedId !== null && eliminatedId === imposterId) {
    return { gameOver: true, winner: "crew" };
  }
  if (remainingActiveIds.length <= 2) {
    return { gameOver: true, winner: "imposter" };
  }
  return { gameOver: false, winner: null };
}

function computeElapsedMs(segmentStartedAtMs, atMs) {
  return Math.max(0, atMs - segmentStartedAtMs);
}

module.exports = { SYNC_BUFFER_MS, resolveRound, checkGameEnd, computeElapsedMs };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/imposterLogic.test.js`
Expected: PASS — 7 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add games/imposterLogic.js test/imposterLogic.test.js
git commit -m "Add pure round-resolution logic for Find the Imposter elimination rounds"
```

---

### Task 2: Rewrite `findTheImposter.js` as a multi-round elimination state machine

**Files:**
- Modify: `games/findTheImposter.js` (full rewrite)
- Modify: `games/registry.js:1-3` (stale header comment)
- Test: `test/findTheImposter.test.js`

**Interfaces:**
- Consumes: `SYNC_BUFFER_MS`, `resolveRound`, `checkGameEnd`, `computeElapsedMs` from `./imposterLogic` (Task 1).
- Produces (all `(room, io, ...)` signature, called by Task 3's `index.js`): `meta`, `getTrackPairs(): {id,label}[]`, `onSelectTrackPair(room, io, pairId): {}|{error}`, `onPlayerReady(room, io, socketId): {}`, `onHostPlay(room, io): {}|{error}`, `onHostPause(room, io): {}|{error}`, `onHostResume(room, io): {}|{error}`, `onHostRestart(room, io): {}|{error}`, `onVote(room, io, socketId, votedForId): {}`, `onNextRound(room, io): {}|{error}`, `onPlayerLeft(room, io, socketId): {}`. The old `onStart` export is removed — it no longer exists on this module.
- `room.gameState` shape produced here (consumed only internally, but Task 3's wiring must not assume any other shape): `{ phase, round, imposterId, eliminated: Set, songPair, readyToPlay: Set, votes: Map, playback: {segmentStartedAt, segmentStartPosition, isPaused}, lastRoundResult, winner }`.

- [ ] **Step 1: Write the failing test file**

Create `test/findTheImposter.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../games/findTheImposter");

function makeStubIo() {
  const emitted = [];
  const target = (kind) => (id) => ({
    emit: (event, payload) => emitted.push({ kind, id, event, payload }),
  });
  return { io: { to: target("to"), in: target("in") }, emitted };
}

function makeRoom(nicknames) {
  const players = new Map();
  nicknames.forEach((name, i) => players.set(`p${i + 1}`, { id: `p${i + 1}`, nickname: name, ready: false }));
  return {
    code: "TEST",
    hostSocketId: "host1",
    state: "lobby",
    players,
    gameId: "find-the-imposter",
    gameState: null,
  };
}

function readyAllActive(room, io) {
  const activeIds = Array.from(room.players.keys()).filter((id) => !room.gameState.eliminated.has(id));
  for (const id of activeIds) game.onPlayerReady(room, io, id);
}

test("getTrackPairs exposes id/label only, no audio URLs", () => {
  const pairs = game.getTrackPairs();
  assert.ok(pairs.length >= 1);
  assert.ok("id" in pairs[0] && "label" in pairs[0]);
  assert.equal("normalUrl" in pairs[0], false);
});

test("onSelectTrackPair rejects an unknown pair id", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io } = makeStubIo();
  const result = game.onSelectTrackPair(room, io, "not-a-real-pair");
  assert.equal(result.error, "Unknown track pair.");
});

test("onSelectTrackPair rejects starting with too few players", () => {
  const room = makeRoom(["A", "B"]);
  const { io } = makeStubIo();
  const result = game.onSelectTrackPair(room, io, "pair1");
  assert.match(result.error, /at least 3 players/);
});

test("onSelectTrackPair round 1 assigns an imposter and loads audio for every player", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  const result = game.onSelectTrackPair(room, io, "pair1");
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "loading");
  assert.equal(room.gameState.round, 1);
  assert.ok(["p1", "p2", "p3"].includes(room.gameState.imposterId));

  const loadEvents = emitted.filter((e) => e.event === "game:load-audio");
  assert.equal(loadEvents.length, 3);
  const imposterEvent = loadEvents.find((e) => e.id === room.gameState.imposterId);
  const crewEvent = loadEvents.find((e) => e.id !== room.gameState.imposterId);
  assert.equal(imposterEvent.payload.audioUrl, "/audio/imposter-song1.mp3");
  assert.equal(crewEvent.payload.audioUrl, "/audio/normal-song1.mp3");
});

test("onPlayerReady notifies the host only once every active player is ready", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");

  game.onPlayerReady(room, io, "p1");
  assert.equal(emitted.some((e) => e.event === "game:all-ready"), false);

  game.onPlayerReady(room, io, "p2");
  game.onPlayerReady(room, io, "p3");
  assert.equal(emitted.some((e) => e.event === "game:all-ready"), true);
});

test("onHostPlay refuses to start until every active player is ready", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");
  game.onPlayerReady(room, io, "p1");

  const result = game.onHostPlay(room, io);
  assert.equal(result.error, "Not all players are ready yet.");
});

test("onHostPlay starts playback once everyone is ready, broadcasting position 0", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");
  readyAllActive(room, io);

  const result = game.onHostPlay(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "playing");

  const playEvents = emitted.filter((e) => e.event === "game:play-at");
  assert.equal(playEvents.length, 3);
  playEvents.forEach((e) => {
    assert.equal(e.payload.position, 0);
    assert.ok(e.payload.startAt > Date.now());
  });
});

test("onVote rejects self-votes and votes for unknown/inactive players", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");
  readyAllActive(room, io);
  game.onHostPlay(room, io);

  game.onVote(room, io, "p1", "p1");
  assert.equal(room.gameState.votes.size, 0);

  game.onVote(room, io, "p1", "not-a-real-player");
  assert.equal(room.gameState.votes.size, 0);
});

test("majority vote eliminating the imposter ends the game with crew winning", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");
  readyAllActive(room, io);
  game.onHostPlay(room, io);

  const imposterId = room.gameState.imposterId;
  const others = ["p1", "p2", "p3"].filter((id) => id !== imposterId);

  game.onVote(room, io, others[0], imposterId);
  game.onVote(room, io, others[1], imposterId);
  game.onVote(room, io, imposterId, others[0]);

  assert.equal(room.gameState.phase, "game-over");
  const resultsEvent = emitted.find((e) => e.event === "game:results");
  assert.equal(resultsEvent.payload.winner, "crew");
  assert.equal(resultsEvent.payload.imposter.id, imposterId);
});

test("skip winning the majority eliminates no one and continues the game", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");
  readyAllActive(room, io);
  game.onHostPlay(room, io);

  game.onVote(room, io, "p1", "skip");
  game.onVote(room, io, "p2", "skip");
  game.onVote(room, io, "p3", "p1");

  assert.equal(room.gameState.phase, "round-results");
  const roundEvent = emitted.find((e) => e.event === "game:round-results");
  assert.equal(roundEvent.payload.eliminated, null);
  assert.equal(room.gameState.eliminated.size, 0);
});

test("eliminating a non-imposter down to 2 active players ends the game with imposter winning", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");
  readyAllActive(room, io);
  game.onHostPlay(room, io);

  const imposterId = room.gameState.imposterId;
  const nonImposters = ["p1", "p2", "p3"].filter((id) => id !== imposterId);
  const [victim, voterA] = nonImposters;

  game.onVote(room, io, voterA, victim);
  game.onVote(room, io, imposterId, victim);
  game.onVote(room, io, victim, voterA);

  assert.equal(room.gameState.phase, "game-over");
  const resultsEvent = emitted.find((e) => e.event === "game:results");
  assert.equal(resultsEvent.payload.winner, "imposter");
});

test("onNextRound only works from round-results and re-sends track pairs", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");

  const tooEarly = game.onNextRound(room, io);
  assert.ok(tooEarly.error);

  readyAllActive(room, io);
  game.onHostPlay(room, io);
  game.onVote(room, io, "p1", "skip");
  game.onVote(room, io, "p2", "skip");
  game.onVote(room, io, "p3", "skip");
  game.onVote(room, io, "p4", "skip");
  assert.equal(room.gameState.phase, "round-results");

  const { io: io2, emitted: emitted2 } = makeStubIo();
  const result = game.onNextRound(room, io2);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "track-select");
  assert.ok(emitted2.some((e) => e.event === "game:track-pairs"));
});

test("onPlayerLeft removes a pending vote and lets the round resolve with one fewer voter", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");
  readyAllActive(room, io);
  game.onHostPlay(room, io);

  game.onVote(room, io, "p1", "skip");
  game.onVote(room, io, "p2", "skip");
  room.players.delete("p4"); // simulate roomService having already removed them
  game.onPlayerLeft(room, io, "p4");

  assert.equal(room.gameState.phase, "voting");
  game.onVote(room, io, "p3", "skip");
  assert.equal(room.gameState.phase, "round-results");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/findTheImposter.test.js`
Expected: FAIL — existing `findTheImposter.js` doesn't export `getTrackPairs`, `onSelectTrackPair`, etc. (only exports `meta`, `onStart`, `onPlayerReady`, `onVote`)

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `games/findTheImposter.js`:

```js
// findTheImposter.js
// Game module: one player secretly gets a slightly different audio track.
// Runs as repeated elimination rounds (Mafia/Werewolf-style) until either the
// imposter is voted out (crew wins) or only 2 active players remain (imposter wins).

const { resolveRound, checkGameEnd, computeElapsedMs, SYNC_BUFFER_MS } = require("./imposterLogic");

const SONG_PAIRS = [
  {
    id: "pair1",
    label: "Track 1",
    normalUrl: "/audio/normal-song1.mp3",
    imposterUrl: "/audio/imposter-song1.mp3",
  },
];

const meta = {
  id: "find-the-imposter",
  name: "Find the Imposter",
  description:
    "Everyone hears the same song through their own earphones — except one player. Vote them out over multiple rounds before only two of you remain.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
};

function getTrackPairs() {
  return SONG_PAIRS.map((p) => ({ id: p.id, label: p.label }));
}

function getActivePlayerIds(room) {
  const eliminated = room.gameState ? room.gameState.eliminated : new Set();
  return Array.from(room.players.keys()).filter((id) => !eliminated.has(id));
}

function freshRoundState(gameState) {
  gameState.songPair = null;
  gameState.readyToPlay = new Set();
  gameState.votes = new Map();
  gameState.playback = { segmentStartedAt: null, segmentStartPosition: 0, isPaused: false };
}

// Called when the host picks a track pair — this both selects the audio AND
// starts the round (round 1 also assigns the imposter, once, for the game).
function onSelectTrackPair(room, io, pairId) {
  const pair = SONG_PAIRS.find((p) => p.id === pairId);
  if (!pair) return { error: "Unknown track pair." };

  if (!room.gameState) {
    const playerIds = Array.from(room.players.keys());
    if (playerIds.length < meta.minPlayers) {
      return { error: `Need at least ${meta.minPlayers} players to start.` };
    }
    const imposterId = playerIds[Math.floor(Math.random() * playerIds.length)];
    room.gameState = {
      phase: "loading",
      round: 1,
      imposterId,
      eliminated: new Set(),
      lastRoundResult: null,
      winner: null,
    };
    freshRoundState(room.gameState);
  } else {
    room.gameState.round += 1;
    room.gameState.phase = "loading";
    freshRoundState(room.gameState);
  }

  const gs = room.gameState;
  gs.songPair = pair;
  room.state = "in-progress";

  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    const isImposter = pid === gs.imposterId;
    io.to(pid).emit("game:load-audio", {
      gameId: meta.id,
      audioUrl: isImposter ? pair.imposterUrl : pair.normalUrl,
    });
  }

  io.to(room.hostSocketId).emit("game:started", {
    round: gs.round,
    playerCount: activeIds.length,
  });

  return {};
}

// Called when a player's client confirms audio is preloaded and ready.
function onPlayerReady(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "loading") return {};
  gs.readyToPlay.add(socketId);

  const activeIds = getActivePlayerIds(room);
  io.to(room.hostSocketId).emit("game:ready-progress", {
    ready: gs.readyToPlay.size,
    total: activeIds.length,
  });

  if (gs.readyToPlay.size >= activeIds.length) {
    io.to(room.hostSocketId).emit("game:all-ready");
  }
  return {};
}

function broadcastPlayAt(room, io, startAt, position) {
  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    io.to(pid).emit("game:play-at", { startAt, position });
  }
}

// Host clicks Play — only valid once every active player has confirmed ready,
// and only before the round has moved into voting.
function onHostPlay(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "loading") return { error: "Not ready to play." };
  const activeIds = getActivePlayerIds(room);
  if (gs.readyToPlay.size < activeIds.length) return { error: "Not all players are ready yet." };

  const startAt = Date.now() + SYNC_BUFFER_MS;
  gs.phase = "playing";
  gs.playback = { segmentStartedAt: startAt, segmentStartPosition: 0, isPaused: false };
  broadcastPlayAt(room, io, startAt, 0);
  return {};
}

function onHostPause(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "playing" || gs.playback.isPaused) {
    return { error: "Nothing is playing right now." };
  }
  const pauseAt = Date.now() + SYNC_BUFFER_MS;
  const position = gs.playback.segmentStartPosition + computeElapsedMs(gs.playback.segmentStartedAt, pauseAt);
  gs.playback.isPaused = true;
  gs.playback.pausedPosition = position;

  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    io.to(pid).emit("game:pause-at", { pauseAt });
  }
  return {};
}

function onHostResume(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "playing" || !gs.playback.isPaused) {
    return { error: "Nothing is paused right now." };
  }
  const startAt = Date.now() + SYNC_BUFFER_MS;
  const resumePosition = gs.playback.pausedPosition;
  gs.playback = { segmentStartedAt: startAt, segmentStartPosition: resumePosition, isPaused: false };
  broadcastPlayAt(room, io, startAt, resumePosition);
  return {};
}

function onHostRestart(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "playing") return { error: "Round isn't playing." };
  const startAt = Date.now() + SYNC_BUFFER_MS;
  gs.playback = { segmentStartedAt: startAt, segmentStartPosition: 0, isPaused: false };
  broadcastPlayAt(room, io, startAt, 0);
  return {};
}

// Called when a player submits their vote (or "skip") for this round.
function onVote(room, io, socketId, votedForId) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "playing" && gs.phase !== "voting")) return {};

  const activeIds = getActivePlayerIds(room);
  if (!activeIds.includes(socketId)) return {};
  if (votedForId !== "skip" && (votedForId === socketId || !activeIds.includes(votedForId))) {
    return {};
  }

  gs.phase = "voting";
  gs.votes.set(socketId, votedForId);

  io.to(room.hostSocketId).emit("game:vote-progress", {
    voted: gs.votes.size,
    total: activeIds.length,
  });

  if (gs.votes.size >= activeIds.length) {
    resolveRoundAndAdvance(room, io);
  }
  return {};
}

function resolveRoundAndAdvance(room, io) {
  const gs = room.gameState;
  const activeIds = getActivePlayerIds(room);
  const { eliminatedId, tally } = resolveRound(activeIds, gs.votes);

  if (eliminatedId) gs.eliminated.add(eliminatedId);
  const remainingActive = getActivePlayerIds(room);
  const { gameOver, winner } = checkGameEnd(remainingActive, eliminatedId, gs.imposterId);

  const eliminatedPlayer = eliminatedId ? room.players.get(eliminatedId) : null;
  const wasImposter = eliminatedId !== null && eliminatedId === gs.imposterId;

  gs.lastRoundResult = { round: gs.round, eliminatedId, wasImposter, tally, remainingActive: remainingActive.length };
  gs.phase = gameOver ? "game-over" : "round-results";

  io.in(room.code).emit("game:round-results", {
    round: gs.round,
    eliminated: eliminatedPlayer ? { id: eliminatedPlayer.id, nickname: eliminatedPlayer.nickname } : null,
    wasImposter,
    voteTally: tally,
    remainingActive: remainingActive.length,
  });

  if (gameOver) {
    gs.winner = winner;
    revealFinalResults(room, io, winner);
  }
}

function revealFinalResults(room, io, winner) {
  const gs = room.gameState;
  room.state = "results";
  const imposterPlayer = room.players.get(gs.imposterId);

  const results = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    wasImposter: p.id === gs.imposterId,
    eliminated: gs.eliminated.has(p.id),
  }));

  io.in(room.code).emit("game:results", {
    imposter: imposterPlayer ? { id: imposterPlayer.id, nickname: imposterPlayer.nickname } : null,
    winner,
    results,
  });
}

// Host advances from round-results back to track-select for the next round.
function onNextRound(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "round-results") return { error: "No round result to advance from." };
  gs.phase = "track-select";
  io.to(room.hostSocketId).emit("game:track-pairs", { pairs: getTrackPairs() });
  return {};
}

// Called from index.js's disconnect handler, AFTER roomService has already
// removed the player from room.players. Only re-checks whether the round can
// now resolve with one fewer active player. Does not specially detect the
// imposter themselves disconnecting — matches the existing platform
// limitation of no reconnect/session-recovery support, not fixed here.
function onPlayerLeft(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase === "game-over") return {};

  gs.votes.delete(socketId);
  gs.readyToPlay.delete(socketId);
  const activeIds = getActivePlayerIds(room);
  if (activeIds.length === 0) return {};

  if (gs.phase === "loading" && gs.readyToPlay.size >= activeIds.length) {
    io.to(room.hostSocketId).emit("game:all-ready");
  } else if (gs.phase === "voting" && gs.votes.size >= activeIds.length) {
    resolveRoundAndAdvance(room, io);
  }
  return {};
}

module.exports = {
  meta,
  getTrackPairs,
  onSelectTrackPair,
  onPlayerReady,
  onHostPlay,
  onHostPause,
  onHostResume,
  onHostRestart,
  onVote,
  onNextRound,
  onPlayerLeft,
};
```

Update `games/registry.js:1-3` (the file header comment is now stale — it describes an `onStart`/`onPlayerAction` contract this game no longer implements):

```js
// registry.js
// Central list of games available on the platform.
// Each game module owns its own event contract (see server/index.js for the
// specific socket events wired to each game) — there is no shared onStart/
// onPlayerAction interface across games.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/findTheImposter.test.js`
Expected: PASS — 13 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add games/findTheImposter.js games/registry.js test/findTheImposter.test.js
git commit -m "Rewrite Find the Imposter as a multi-round elimination state machine"
```

---

### Task 3: Wire the new socket events in `index.js`

**Files:**
- Modify: `index.js` (full rewrite — every handler stays, several are added, one is removed)

**Interfaces:**
- Consumes: all exports from Task 2's `games/findTheImposter.js` (`getTrackPairs`, `onSelectTrackPair`, `onHostPlay`, `onHostPause`, `onHostResume`, `onHostRestart`, `onVote`, `onNextRound`, `onPlayerLeft`), plus `roomService.js` and `games/registry.js` (both unchanged).
- Produces: the socket event surface consumed by Tasks 5 and 6 (host/player UI).

- [ ] **Step 1: Replace the entire contents of `index.js`**

```js
// index.js
// Party Game Platform - server entry point.
// Serves host/player web pages and coordinates rooms via Socket.io.

const path = require("path");
const os = require("os");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const roomService = require("./roomService");
const gameRegistry = require("./games/registry");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "audio")));

app.get("/api/games", (req, res) => {
  res.json(gameRegistry.listGames());
});

function printLanUrl() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) addrs.push(net.address);
    }
  }
  console.log(`\nServer running on port ${PORT}`);
  console.log(`Local:  http://localhost:${PORT}`);
  addrs.forEach((a) => console.log(`Network: http://${a}:${PORT}  <-- use this on phones (same WiFi)`));
  console.log("");
}

// Shared guard for every host-only, in-game action below: confirms the room
// exists, the caller is its host, and a game module is selected, then hands
// off to `handler`. Cuts six near-identical blocks down to one.
function withHostGame(socket, code, handler) {
  const room = roomService.getRoom(code);
  if (!room || room.hostSocketId !== socket.id) return;
  const game = gameRegistry.getGame(room.gameId);
  if (!game) return;
  const result = handler(room, game);
  if (result && result.error) socket.emit("host:error", { error: result.error });
}

io.on("connection", (socket) => {
  // ---- HOST: create room ----
  socket.on("host:create-room", () => {
    const room = roomService.createRoom(socket.id);
    socket.join(room.code);
    socket.emit("host:room-created", {
      room: roomService.publicRoomView(room),
      games: gameRegistry.listGames(),
    });
  });

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
    io.to(room.hostSocketId).emit("host:room-updated", {
      room: roomService.publicRoomView(room),
    });
    io.in(room.code).emit("room:player-list", {
      players: roomService.publicRoomView(room).players,
    });
  });

  // ---- HOST: select a game ----
  socket.on("host:select-game", ({ code, gameId }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;
    const game = gameRegistry.getGame(gameId);
    if (!game) return;

    room.gameId = gameId;
    io.in(room.code).emit("room:game-selected", {
      gameId,
      meta: game.meta,
    });
    if (game.getTrackPairs) {
      socket.emit("game:track-pairs", { pairs: game.getTrackPairs() });
    }
  });

  // ---- HOST: pick a track pair (this also starts the round) ----
  socket.on("host:select-track-pair", ({ code, pairId }) => {
    withHostGame(socket, code, (room, game) => game.onSelectTrackPair(room, io, pairId));
  });

  // ---- HOST: playback control ----
  socket.on("host:play-audio", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onHostPlay(room, io));
  });

  socket.on("host:pause-audio", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onHostPause(room, io));
  });

  socket.on("host:resume-audio", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onHostResume(room, io));
  });

  socket.on("host:restart-audio", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onHostRestart(room, io));
  });

  // ---- HOST: advance to the next round ----
  socket.on("host:next-round", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onNextRound(room, io));
  });

  // ---- PLAYER: confirms audio preloaded ----
  socket.on("player:audio-ready", ({ code }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameId) return;
    const game = gameRegistry.getGame(room.gameId);
    if (game.onPlayerReady) game.onPlayerReady(room, io, socket.id);
  });

  // ---- PLAYER: casts vote ----
  socket.on("player:vote", ({ code, votedForId }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameId) return;
    const game = gameRegistry.getGame(room.gameId);
    if (game.onVote) game.onVote(room, io, socket.id, votedForId);
  });

  // ---- HOST: return to lobby / play again ----
  socket.on("host:reset-room", ({ code }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;
    room.state = "lobby";
    room.gameId = null;
    room.gameState = null;
    for (const p of room.players.values()) p.ready = false;
    io.in(room.code).emit("room:reset", {
      room: roomService.publicRoomView(room),
    });
  });

  // ---- Disconnect handling ----
  socket.on("disconnect", () => {
    const room = roomService.removePlayer(socket.id);
    if (room) {
      if (room.gameId && room.gameState) {
        const game = gameRegistry.getGame(room.gameId);
        if (game.onPlayerLeft) game.onPlayerLeft(room, io, socket.id);
      }
      io.to(room.hostSocketId).emit("host:room-updated", {
        room: roomService.publicRoomView(room),
      });
      io.in(room.code).emit("room:player-list", {
        players: roomService.publicRoomView(room).players,
      });
      roomService.removeRoomIfEmpty(room.code);
    }

    const hostedRoom = roomService.findRoomByHost(socket.id);
    if (hostedRoom) {
      io.in(hostedRoom.code).emit("room:host-disconnected");
    }
  });
});

server.listen(PORT, "0.0.0.0", printLanUrl);
```

Note what changed vs. the old file: `host:start-game` is **removed** (this game no longer has an `onStart` to call — track-pair selection now starts the round); `host:select-game` gained the `game:track-pairs` emit; six new handlers were added via the `withHostGame` helper; `disconnect` gained the `onPlayerLeft` hook.

- [ ] **Step 2: Smoke-test that the server still boots**

Run: `node index.js` (from the `server/` directory; stop with Ctrl+C after checking)
Expected output includes: `Server running on port 3000` — no stack trace, no immediate exit.

While it's running, in a second terminal:
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/games`
Expected: `200`

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "Wire round-selection, playback-control, and next-round socket events"
```

---

### Task 4: Live end-to-end verification script

**Files:**
- Modify: `package.json` (add `socket.io-client` devDependency and a `test` script)
- Create: `test/e2e-rounds.js`

**Interfaces:**
- Consumes: the full socket event surface from Task 3 (`host:create-room`, `player:join-room`, `host:select-game`, `game:track-pairs`, `host:select-track-pair`, `game:load-audio`, `player:audio-ready`, `game:all-ready`, `host:play-audio`, `host:pause-audio`, `host:resume-audio`, `host:restart-audio`, `game:play-at`, `game:pause-at`, `player:vote`, `game:vote-progress`, `game:round-results`, `host:next-round`, `game:results`).
- Produces: a runnable script (`node test/e2e-rounds.js`) that exits 0 on success, 1 on failure — this is the "does it actually work end to end" gate referenced by the spec's testing plan (Section 7, all 7 bullets).

- [ ] **Step 1: Add the devDependency and test script**

Edit `package.json` — replace:

```json
{
  "name": "party-game-server",
  "version": "0.1.0",
  "description": "Party game platform - room/lobby shell + Find the Imposter audio game",
  "main": "index.js",
  "type": "commonjs",
  "scripts": {
    "start": "node index.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  }
}
```

with:

```json
{
  "name": "party-game-server",
  "version": "0.1.0",
  "description": "Party game platform - room/lobby shell + Find the Imposter audio game",
  "main": "index.js",
  "type": "commonjs",
  "scripts": {
    "start": "node index.js",
    "test": "node --test \"test/*.test.js\"",
    "test:e2e": "node test/e2e-rounds.js"
  },
  "dependencies": {
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  },
  "devDependencies": {
    "socket.io-client": "^4.7.5"
  }
}
```

Run: `npm install`
Expected: `socket.io-client` added under `node_modules`, no errors.

- [ ] **Step 2: Write `test/e2e-rounds.js`**

```js
// test/e2e-rounds.js
// Live integration check: runs the real server in-process and drives full
// games through socket.io-client (no mocks), covering every scenario in the
// spec's testing plan. Run with: node test/e2e-rounds.js

const path = require("node:path");
const { io } = require("socket.io-client");

const PORT = 3099;
const URL = `http://localhost:${PORT}`;

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function connect() {
  return new Promise((resolve) => {
    const s = io(URL);
    s.on("connect", () => resolve(s));
  });
}

async function createRoom() {
  const host = await connect();
  const created = await new Promise((resolve) => {
    host.once("host:room-created", resolve);
    host.emit("host:create-room");
  });
  return { host, roomCode: created.room.code };
}

async function joinPlayers(roomCode, names) {
  const players = [];
  for (const name of names) {
    const socket = await connect();
    await new Promise((resolve, reject) => {
      socket.once("player:joined", () => resolve());
      socket.once("player:join-error", (d) => reject(new Error(d.error)));
      socket.emit("player:join-room", { code: roomCode, nickname: name });
    });
    players.push({ name, socket });
  }
  return players;
}

async function selectGame(host, roomCode) {
  const pairsPromise = once(host, "game:track-pairs");
  host.emit("host:select-game", { code: roomCode, gameId: "find-the-imposter" });
  await pairsPromise;
}

// Selects the pair for this round, waits for every active player to load
// audio and confirm ready, and waits for the host's "all ready" signal.
async function startRoundAndGetReady(host, roomCode, activePlayers) {
  const loadPromises = activePlayers.map((p) => once(p.socket, "game:load-audio"));
  const allReadyPromise = once(host, "game:all-ready");

  host.emit("host:select-track-pair", { code: roomCode, pairId: "pair1" });

  const loadResults = await Promise.all(loadPromises);
  const audioByName = {};
  activePlayers.forEach((p, i) => {
    audioByName[p.name] = loadResults[i].audioUrl;
    p.socket.emit("player:audio-ready", { code: roomCode });
  });

  await allReadyPromise;
  return audioByName;
}

async function playSyncedAudio(host, roomCode, activePlayers) {
  const playAtPromises = activePlayers.map((p) => once(p.socket, "game:play-at"));
  host.emit("host:play-audio", { code: roomCode });
  await Promise.all(playAtPromises);
}

async function nextRound(host, roomCode) {
  const pairsPromise = once(host, "game:track-pairs");
  host.emit("host:next-round", { code: roomCode });
  await pairsPromise;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function scenario1(host, roomCode, players) {
  console.log("\n[Scenario 1] 4 players, round 1 split vote -> no majority, game continues");
  await startRoundAndGetReady(host, roomCode, players);
  await playSyncedAudio(host, roomCode, players);

  const roundResultsPromise = once(host, "game:round-results");
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: players[1].socket.id });
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: players[2].socket.id });
  players[2].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[3].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  const roundResult = await roundResultsPromise;

  assertTrue(roundResult.eliminated === null, "expected no elimination on a split vote");
  assertTrue(roundResult.remainingActive === 4, "expected all 4 players still active");
  console.log("  PASS");
}

// Returns { ended, winner, remaining } — ended is true if this round's
// majority vote happened to catch the imposter and finish the game.
async function scenario2_eliminateOneRound(host, roomCode, players) {
  console.log("\n[Scenario 2] round 2 votes out a non-imposter (3/4 majority)");
  await nextRound(host, roomCode);
  await startRoundAndGetReady(host, roomCode, players);
  await playSyncedAudio(host, roomCode, players);

  const target = players[0];
  const roundResultsPromise = once(host, "game:round-results");
  const resultsPromise = once(host, "game:results").catch(() => null);
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: target.socket.id });
  players[2].socket.emit("player:vote", { code: roomCode, votedForId: target.socket.id });
  players[3].socket.emit("player:vote", { code: roomCode, votedForId: target.socket.id });
  target.socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  const roundResult = await roundResultsPromise;

  assertTrue(roundResult.eliminated !== null, "expected an elimination on a 3/4 majority");
  assertTrue(roundResult.eliminated.id === target.socket.id, "expected the targeted player to be eliminated");
  assertTrue(roundResult.remainingActive === 3, "expected 3 active players remaining");
  console.log(`  PASS — ${target.name} eliminated, 3 players remain`);

  if (roundResult.wasImposter) {
    const finalResults = await resultsPromise;
    console.log("  (targeted player happened to be the imposter — game ended here)");
    return { ended: true, winner: finalResults.winner, eliminatedPlayer: target };
  }
  return { ended: false, remaining: players.filter((p) => p.socket.id !== target.socket.id), eliminatedPlayer: target };
}

async function scenario3_reachTwoPlayers(host, roomCode, remaining, eliminatedPlayer) {
  console.log("\n[Scenario 3] round 3 down to 3 active players, next elimination reaches 2 -> auto-end");

  // Confirm the round-2-eliminated player gets no audio and can't vote here.
  let eliminatedGotAudio = false;
  eliminatedPlayer.socket.once("game:load-audio", () => {
    eliminatedGotAudio = true;
  });

  await nextRound(host, roomCode);
  await startRoundAndGetReady(host, roomCode, remaining);
  assertTrue(!eliminatedGotAudio, "eliminated player should not receive audio in a later round");

  await playSyncedAudio(host, roomCode, remaining);

  const resultsPromise = once(host, "game:results");
  remaining[1].socket.emit("player:vote", { code: roomCode, votedForId: remaining[0].socket.id });
  remaining[2].socket.emit("player:vote", { code: roomCode, votedForId: remaining[0].socket.id });
  remaining[0].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  eliminatedPlayer.socket.emit("player:vote", { code: roomCode, votedForId: remaining[0].socket.id }); // ignored
  const finalResults = await resultsPromise;

  assertTrue(finalResults.winner === "imposter", "expected the imposter to win once down to 2 active players");
  console.log("  PASS — game auto-ended at 2 active players, imposter won");
}

async function scenario4_imposterCaughtImmediately() {
  console.log("\n[Scenario 4] imposter voted out directly in round 1 -> immediate crew win");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Eve", "Frank", "Grace"]);
  await selectGame(host, roomCode);

  const audioByName = await startRoundAndGetReady(host, roomCode, players);
  const imposterPlayer = players.find((p) => audioByName[p.name] === "/audio/imposter-song1.mp3");
  await playSyncedAudio(host, roomCode, players);

  const resultsPromise = once(host, "game:results");
  const others = players.filter((p) => p !== imposterPlayer);
  others[0].socket.emit("player:vote", { code: roomCode, votedForId: imposterPlayer.socket.id });
  others[1].socket.emit("player:vote", { code: roomCode, votedForId: imposterPlayer.socket.id });
  imposterPlayer.socket.emit("player:vote", { code: roomCode, votedForId: others[0].socket.id });
  const finalResults = await resultsPromise;

  assertTrue(finalResults.winner === "crew", "expected crew to win when the imposter is caught round 1");
  assertTrue(finalResults.imposter.id === imposterPlayer.socket.id, "expected the revealed imposter to match");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario5_playbackControls() {
  console.log("\n[Scenario 5] host Play -> Pause -> Resume -> Restart controls");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Ivy", "Jack", "Kim"]);
  await selectGame(host, roomCode);
  await startRoundAndGetReady(host, roomCode, players);

  const firstPlayAt = await new Promise((resolve) => {
    players[0].socket.once("game:play-at", resolve);
    host.emit("host:play-audio", { code: roomCode });
  });
  assertTrue(firstPlayAt.position === 0, "expected Play to start from position 0");

  const pauseEvent = await new Promise((resolve) => {
    players[0].socket.once("game:pause-at", resolve);
    host.emit("host:pause-audio", { code: roomCode });
  });
  assertTrue(typeof pauseEvent.pauseAt === "number", "expected a numeric pause timestamp");

  const resumePlayAt = await new Promise((resolve) => {
    players[0].socket.once("game:play-at", resolve);
    host.emit("host:resume-audio", { code: roomCode });
  });
  assertTrue(resumePlayAt.position > 0, "expected Resume to continue from a non-zero position");

  const restartPlayAt = await new Promise((resolve) => {
    players[0].socket.once("game:play-at", resolve);
    host.emit("host:restart-audio", { code: roomCode });
  });
  assertTrue(restartPlayAt.position === 0, "expected Restart to go back to position 0");

  console.log("  PASS");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario6_selfVoteRejected() {
  console.log("\n[Scenario 6] self-votes are rejected server-side");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Liam", "Mona", "Noah"]);
  await selectGame(host, roomCode);
  await startRoundAndGetReady(host, roomCode, players);
  await playSyncedAudio(host, roomCode, players);

  const progressPromise = once(host, "game:vote-progress");
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: players[0].socket.id });
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: players[2].socket.id });
  const progress = await progressPromise;

  assertTrue(progress.voted === 1, "expected the self-vote to be ignored, leaving only 1 valid vote");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario7_disconnectDuringVoting() {
  console.log("\n[Scenario 7] a player disconnecting mid-vote doesn't block round resolution");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Omar", "Priya", "Quinn", "Rosa"]);
  await selectGame(host, roomCode);
  await startRoundAndGetReady(host, roomCode, players);
  await playSyncedAudio(host, roomCode, players);

  const roomUpdatedPromise = once(host, "host:room-updated");
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[3].socket.close(); // Rosa drops before voting
  await roomUpdatedPromise; // wait for the server to finish processing the disconnect

  const roundResultsPromise = once(host, "game:round-results");
  players[2].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  const roundResult = await roundResultsPromise;

  assertTrue(roundResult.remainingActive === 3, "expected 3 active players after the disconnect");
  console.log("  PASS — round resolved among the 3 remaining active players");

  host.close();
  players.slice(0, 3).forEach((p) => p.socket.close());
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((r) => setTimeout(r, 300));
  console.log(`Test server up on port ${PORT}`);

  try {
    const { host, roomCode } = await createRoom();
    const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol", "Dave"]);
    await selectGame(host, roomCode);

    await scenario1(host, roomCode, players);
    const step2 = await scenario2_eliminateOneRound(host, roomCode, players);
    if (!step2.ended) {
      await scenario3_reachTwoPlayers(host, roomCode, step2.remaining, step2.eliminatedPlayer);
    }
    host.close();
    players.forEach((p) => p.socket.close());

    await scenario4_imposterCaughtImmediately();
    await scenario5_playbackControls();
    await scenario6_selfVoteRejected();
    await scenario7_disconnectDuringVoting();

    console.log("\nALL E2E SCENARIOS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 3: Run it**

Run: `node test/e2e-rounds.js` (from the `server/` directory)
Expected: every `[Scenario N]` block prints `PASS`, ending with `ALL E2E SCENARIOS PASSED`, exit code 0.

If a scenario times out or asserts false, the error message names exactly which expectation failed — fix the corresponding handler in `findTheImposter.js` (Task 2) or wiring in `index.js` (Task 3), then re-run.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json test/e2e-rounds.js
git commit -m "Add live multi-round E2E verification script"
```

---

### Task 5: Host UI — track selection, playback controls, round results

**Files:**
- Modify: `public/host/index.html`
- Modify: `public/host/host.js`
- Modify: `public/host/style.css`

**Interfaces:**
- Consumes: `game:track-pairs`, `game:started`, `game:ready-progress`, `game:all-ready`, `game:vote-progress`, `game:round-results`, `game:results`, `host:error` (all from Task 3's `index.js`, ultimately from Task 2's `findTheImposter.js`).
- Emits: `host:select-track-pair`, `host:play-audio`, `host:pause-audio`, `host:resume-audio`, `host:restart-audio`, `host:next-round`.

- [ ] **Step 1: Replace `public/host/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Party Game Platform — Host</title>
<link rel="stylesheet" href="/host/style.css" />
</head>
<body>
  <div id="app">

    <section id="screen-start" class="screen active">
      <h1>🎉 Party Game Platform</h1>
      <p class="subtitle">Host a room for your party</p>
      <button id="btn-create-room" class="btn-primary">Create Room</button>
    </section>

    <section id="screen-lobby" class="screen">
      <div class="room-code-box">
        <span class="label">Room Code</span>
        <span id="room-code" class="room-code">----</span>
        <span id="join-url" class="join-url"></span>
      </div>

      <div class="players-panel">
        <h2>Players (<span id="player-count">0</span>)</h2>
        <ul id="player-list" class="player-list"></ul>
        <p id="player-empty-hint" class="hint">Waiting for players to join…</p>
      </div>

      <div class="game-select-panel">
        <h2>Choose a game</h2>
        <div id="game-list" class="game-list"></div>
      </div>

      <button id="btn-start-game" class="btn-primary" disabled>Continue to Round 1</button>
      <p id="lobby-error" class="error"></p>
    </section>

    <section id="screen-track-select" class="screen">
      <h2 id="round-title">Round 1</h2>
      <p class="subtitle"><span id="active-count">0</span> players still in</p>
      <div id="pair-list" class="pair-list"></div>
      <p id="track-select-error" class="error"></p>
    </section>

    <section id="screen-game" class="screen">
      <h2 id="game-title-active"></h2>
      <div id="game-progress" class="progress-box">
        <p id="progress-text">Loading audio on all devices…</p>
        <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
      </div>
      <div id="playback-controls" class="playback-controls">
        <button id="btn-play" class="btn-primary">▶ Play</button>
        <button id="btn-pause" class="btn-secondary">⏸ Pause</button>
        <button id="btn-resume" class="btn-primary">▶ Resume</button>
        <button id="btn-restart" class="btn-secondary">⟲ Restart</button>
      </div>
    </section>

    <section id="screen-round-results" class="screen">
      <h2 id="round-results-title">Round Results</h2>
      <p id="round-elimination-text" class="imposter-reveal"></p>
      <button id="btn-next-round" class="btn-primary">Next Round</button>
    </section>

    <section id="screen-results" class="screen">
      <h2>Game Over</h2>
      <p id="imposter-reveal" class="imposter-reveal"></p>
      <ul id="results-list" class="results-list"></ul>
      <button id="btn-play-again" class="btn-primary">Back to Lobby</button>
    </section>

  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/host/host.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `public/host/host.js`**

```js
const socket = io();

let roomCode = null;
let selectedGameId = null;

const screens = {
  start: document.getElementById("screen-start"),
  lobby: document.getElementById("screen-lobby"),
  trackSelect: document.getElementById("screen-track-select"),
  game: document.getElementById("screen-game"),
  roundResults: document.getElementById("screen-round-results"),
  results: document.getElementById("screen-results"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

document.getElementById("btn-create-room").addEventListener("click", () => {
  socket.emit("host:create-room");
});

socket.on("host:room-created", ({ room, games }) => {
  roomCode = room.code;
  document.getElementById("room-code").textContent = room.code;
  document.getElementById("join-url").textContent =
    `${window.location.protocol}//${window.location.host}/player`;
  renderGameList(games);
  showScreen("lobby");
});

socket.on("host:room-updated", ({ room }) => {
  renderPlayers(room.players);
});

function renderPlayers(players) {
  const list = document.getElementById("player-list");
  const countEl = document.getElementById("player-count");
  const emptyHint = document.getElementById("player-empty-hint");

  countEl.textContent = players.length;
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.nickname;
    list.appendChild(li);
  });
  emptyHint.style.display = players.length === 0 ? "block" : "none";
  updateStartButton();
}

function renderGameList(games) {
  const container = document.getElementById("game-list");
  container.innerHTML = "";
  games.forEach((g) => {
    const card = document.createElement("div");
    card.className = "game-card";
    card.dataset.gameId = g.id;
    card.innerHTML = `
      <div class="name">${g.name}</div>
      <div class="desc">${g.description}</div>
      <div class="players-req">${g.minPlayers}-${g.maxPlayers} players</div>
    `;
    card.addEventListener("click", () => {
      selectedGameId = g.id;
      document.querySelectorAll(".game-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      socket.emit("host:select-game", { code: roomCode, gameId: g.id });
      updateStartButton();
    });
    container.appendChild(card);
  });
}

function updateStartButton() {
  const btn = document.getElementById("btn-start-game");
  const playerCount = document.querySelectorAll("#player-list li").length;
  btn.disabled = !(selectedGameId && playerCount >= 3);
}

document.getElementById("btn-start-game").addEventListener("click", () => {
  document.getElementById("lobby-error").textContent = "";
  showScreen("trackSelect");
});

socket.on("host:error", ({ error }) => {
  document.getElementById("lobby-error").textContent = error;
  document.getElementById("track-select-error").textContent = error;
});

// ---- Track selection ----
socket.on("game:track-pairs", ({ pairs }) => {
  renderPairList(pairs);
  showScreen("trackSelect");
});

function renderPairList(pairs) {
  const container = document.getElementById("pair-list");
  container.innerHTML = "";
  pairs.forEach((pair) => {
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `<div class="name">${pair.label}</div>`;
    card.addEventListener("click", () => {
      document.getElementById("track-select-error").textContent = "";
      socket.emit("host:select-track-pair", { code: roomCode, pairId: pair.id });
    });
    container.appendChild(card);
  });
}

// ---- Round start / playback ----
socket.on("game:started", ({ round, playerCount }) => {
  document.getElementById("round-title").textContent = `Round ${round}`;
  document.getElementById("game-title-active").textContent = `Round ${round} — Find the Imposter`;
  document.getElementById("progress-text").textContent = `Loading audio on ${playerCount} devices…`;
  document.getElementById("progress-fill").style.width = "0%";
  setPlaybackButtons("loading");
  showScreen("game");
});

socket.on("game:ready-progress", ({ ready, total }) => {
  document.getElementById("progress-text").textContent = `${ready} / ${total} devices ready`;
  document.getElementById("progress-fill").style.width = `${(ready / total) * 100}%`;
});

socket.on("game:all-ready", () => {
  document.getElementById("progress-text").textContent = "Everyone's ready — hit Play when you are.";
  setPlaybackButtons("ready");
});

document.getElementById("btn-play").addEventListener("click", () => {
  socket.emit("host:play-audio", { code: roomCode });
  setPlaybackButtons("playing");
});
document.getElementById("btn-pause").addEventListener("click", () => {
  socket.emit("host:pause-audio", { code: roomCode });
  setPlaybackButtons("paused");
});
document.getElementById("btn-resume").addEventListener("click", () => {
  socket.emit("host:resume-audio", { code: roomCode });
  setPlaybackButtons("playing");
});
document.getElementById("btn-restart").addEventListener("click", () => {
  socket.emit("host:restart-audio", { code: roomCode });
  setPlaybackButtons("playing");
});

function setPlaybackButtons(state) {
  const buttons = {
    play: document.getElementById("btn-play"),
    pause: document.getElementById("btn-pause"),
    resume: document.getElementById("btn-resume"),
    restart: document.getElementById("btn-restart"),
  };
  Object.values(buttons).forEach((b) => (b.style.display = "none"));
  if (state === "ready") {
    buttons.play.style.display = "block";
  } else if (state === "playing") {
    buttons.pause.style.display = "block";
    buttons.restart.style.display = "block";
  } else if (state === "paused") {
    buttons.resume.style.display = "block";
    buttons.restart.style.display = "block";
  }
}

socket.on("game:vote-progress", ({ voted, total }) => {
  document.getElementById("progress-text").textContent = `${voted} / ${total} players voted`;
  document.getElementById("progress-fill").style.width = `${(voted / total) * 100}%`;
});

// ---- Round results ----
socket.on("game:round-results", ({ round, eliminated, wasImposter, remainingActive }) => {
  document.getElementById("round-results-title").textContent = `Round ${round} Results`;
  const text = eliminated
    ? `${eliminated.nickname} was voted out — they were ${wasImposter ? "" : "NOT "}the imposter. ${remainingActive} players remain.`
    : `No one was eliminated this round. ${remainingActive} players remain.`;
  document.getElementById("round-elimination-text").textContent = text;
  showScreen("roundResults");
});

document.getElementById("btn-next-round").addEventListener("click", () => {
  socket.emit("host:next-round", { code: roomCode });
});

// ---- Final results ----
socket.on("game:results", ({ imposter, winner, results }) => {
  const winnerText = winner === "crew"
    ? "🕵️ The crew caught the imposter!"
    : "🎭 The imposter got away with it!";
  document.getElementById("imposter-reveal").textContent = imposter
    ? `${winnerText} It was ${imposter.nickname}.`
    : winnerText;

  const list = document.getElementById("results-list");
  list.innerHTML = "";
  results.forEach((r) => {
    const li = document.createElement("li");
    if (r.wasImposter) li.classList.add("was-imposter");
    const status = r.eliminated ? "eliminated" : "survived";
    li.innerHTML = `<span>${r.nickname}${r.wasImposter ? " 🎭" : ""}</span><span>${status}</span>`;
    list.appendChild(li);
  });

  showScreen("results");
});

document.getElementById("btn-play-again").addEventListener("click", () => {
  selectedGameId = null;
  socket.emit("host:reset-room", { code: roomCode });
});

socket.on("room:reset", ({ room }) => {
  renderPlayers(room.players);
  document.querySelectorAll(".game-card").forEach((c) => c.classList.remove("selected"));
  showScreen("lobby");
});
```

- [ ] **Step 3: Append new styles to `public/host/style.css`**

Add to the end of the file:

```css
.pair-list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }

.playback-controls { display: flex; gap: 12px; margin-top: 16px; }
.playback-controls button { flex: 1; }

.btn-secondary {
  display: block;
  width: 100%;
  padding: 16px;
  font-size: 1.1rem;
  font-weight: 600;
  border: 2px solid var(--accent2);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  cursor: pointer;
  transition: transform 0.15s ease, background 0.15s ease;
}
.btn-secondary:hover { background: rgba(124,92,255,0.15); transform: translateY(-2px); }
```

- [ ] **Step 4: Manual check**

Run: `npm start`, open `http://localhost:3000/host/` in a browser, create a room, select "Find the Imposter." Confirm the "Continue to Round 1" button is disabled with 0 players (open `http://localhost:3000/player/` in another tab/device to join 3 players, confirm it enables), then confirm clicking it shows the track-select screen with one pair card. Stop the server after checking (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add public/host/index.html public/host/host.js public/host/style.css
git commit -m "Add host UI for track selection, playback controls, and round results"
```

---

### Task 6: Player UI — vote confirm/skip, round results, spectator mode

**Files:**
- Modify: `public/player/index.html`
- Modify: `public/player/player.js`
- Modify: `public/player/style.css`

**Interfaces:**
- Consumes: `game:load-audio`, `game:play-at` (now carries `position`), `game:pause-at` (new), `game:round-results`, `game:results` (all from Task 3's `index.js`).
- Emits: `player:audio-ready`, `player:vote` (unchanged signature, `votedForId` may now be `"skip"`).

- [ ] **Step 1: Replace `public/player/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Join Party Game</title>
<link rel="stylesheet" href="/player/style.css" />
</head>
<body>
  <div id="app">

    <section id="screen-join" class="screen active">
      <h1>🎉 Join the Party</h1>
      <input id="input-code" class="input-field" placeholder="ROOM CODE" maxlength="4" autocapitalize="characters" />
      <input id="input-nickname" class="input-field" placeholder="Your name" maxlength="20" />
      <button id="btn-join" class="btn-primary">Join Room</button>
      <p id="join-error" class="error"></p>
    </section>

    <section id="screen-waiting" class="screen">
      <h1>You're in! 🙌</h1>
      <p class="subtitle">Waiting for host to start the game…</p>
      <div class="players-panel">
        <h2>Players in room</h2>
        <ul id="player-list" class="player-list"></ul>
      </div>
    </section>

    <section id="screen-audio-ready" class="screen">
      <h1>🎧 Put your earphones in</h1>
      <p class="subtitle">Tap below when ready — the host will start playback for everyone at the same moment.</p>
      <button id="btn-ready" class="btn-primary">I'm Ready</button>
      <p id="ready-status" class="hint"></p>
    </section>

    <section id="screen-playing" class="screen">
      <h1>🔊 Listen carefully…</h1>
      <p class="subtitle">Discuss with the group, then vote below whenever you're ready.</p>
      <div id="vote-list" class="vote-list"></div>
      <button id="btn-confirm-vote" class="btn-primary" disabled>Confirm Vote</button>
      <p id="vote-status" class="hint"></p>
    </section>

    <section id="screen-round-results" class="screen">
      <h2>Round Results</h2>
      <p id="round-elimination-text" class="imposter-reveal"></p>
      <p class="hint">Waiting for host to start the next round…</p>
    </section>

    <section id="screen-spectator" class="screen">
      <h1>👀 You're out</h1>
      <p class="subtitle">You've been eliminated — you can keep watching the results each round.</p>
      <p id="spectator-round-text" class="hint"></p>
    </section>

    <section id="screen-results" class="screen">
      <h2>Game Over</h2>
      <p id="imposter-reveal" class="imposter-reveal"></p>
      <ul id="results-list" class="results-list"></ul>
      <p class="hint">Waiting for host to return to the lobby…</p>
    </section>

  </div>

  <audio id="audio-player" preload="auto"></audio>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/player/player.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `public/player/player.js`**

```js
const socket = io();

let roomCode = null;
let myId = null;
let currentPlayers = [];
let selectedVoteTarget = null;
let iAmEliminated = false;

const screens = {
  join: document.getElementById("screen-join"),
  waiting: document.getElementById("screen-waiting"),
  audioReady: document.getElementById("screen-audio-ready"),
  playing: document.getElementById("screen-playing"),
  roundResults: document.getElementById("screen-round-results"),
  spectator: document.getElementById("screen-spectator"),
  results: document.getElementById("screen-results"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

socket.on("connect", () => {
  myId = socket.id;
});

// ---- Join flow ----
document.getElementById("btn-join").addEventListener("click", attemptJoin);
document.getElementById("input-nickname").addEventListener("keydown", (e) => {
  if (e.key === "Enter") attemptJoin();
});

function attemptJoin() {
  const code = document.getElementById("input-code").value.trim().toUpperCase();
  const nickname = document.getElementById("input-nickname").value.trim();
  document.getElementById("join-error").textContent = "";

  if (!code || !nickname) {
    document.getElementById("join-error").textContent = "Enter both room code and your name.";
    return;
  }
  socket.emit("player:join-room", { code, nickname });
}

socket.on("player:join-error", ({ error }) => {
  document.getElementById("join-error").textContent = error;
});

socket.on("player:joined", ({ room }) => {
  roomCode = room.code;
  renderPlayerList(room.players);
  showScreen("waiting");
});

socket.on("room:player-list", ({ players }) => {
  currentPlayers = players;
  renderPlayerList(players);
});

function renderPlayerList(players) {
  const list = document.getElementById("player-list");
  if (!list) return;
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.nickname + (p.id === myId ? " (you)" : "");
    list.appendChild(li);
  });
}

// ---- Game: audio loading ----
const audioEl = document.getElementById("audio-player");

socket.on("game:load-audio", ({ audioUrl }) => {
  audioEl.src = audioUrl;
  audioEl.load();
  document.getElementById("ready-status").textContent = "";
  document.getElementById("btn-ready").disabled = false;
  showScreen("audioReady");
});

document.getElementById("btn-ready").addEventListener("click", () => {
  // iOS/Android require a user gesture before audio can be played later —
  // this tap counts as that gesture. We prime playback here (play+immediately
  // pause) so the later synced play() call succeeds without another prompt.
  const markReady = () => {
    socket.emit("player:audio-ready", { code: roomCode });
    document.getElementById("ready-status").textContent = "Waiting for the host to start playback…";
    document.getElementById("btn-ready").disabled = true;
  };
  audioEl.play().then(() => {
    audioEl.pause();
    audioEl.currentTime = 0;
    markReady();
  }).catch(() => {
    // Some browsers block silent priming; still tell server we're ready —
    // playback will be attempted directly at sync time.
    markReady();
  });
});

// ---- Game: host-controlled synced playback ----
socket.on("game:play-at", ({ startAt, position }) => {
  const delay = Math.max(0, startAt - Date.now());
  setTimeout(() => {
    audioEl.currentTime = (position || 0) / 1000;
    audioEl.play().catch((err) => console.warn("Playback failed:", err));
  }, delay);

  selectedVoteTarget = null;
  renderVoteOptions(currentPlayers);
  showScreen("playing");
  document.getElementById("vote-status").textContent = "";
});

socket.on("game:pause-at", ({ pauseAt }) => {
  const delay = Math.max(0, pauseAt - Date.now());
  setTimeout(() => audioEl.pause(), delay);
});

// ---- Voting: select a target, then a separate confirm step ----
function renderVoteOptions(players) {
  const container = document.getElementById("vote-list");
  container.innerHTML = "";
  const confirmBtn = document.getElementById("btn-confirm-vote");
  confirmBtn.disabled = true;

  const candidates = players.filter((p) => p.id !== myId);
  candidates.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "vote-btn";
    btn.textContent = p.nickname;
    btn.addEventListener("click", () => selectVoteTarget(p.id, btn));
    container.appendChild(btn);
  });

  const skipBtn = document.createElement("button");
  skipBtn.className = "vote-btn";
  skipBtn.textContent = "Skip — no vote this round";
  skipBtn.addEventListener("click", () => selectVoteTarget("skip", skipBtn));
  container.appendChild(skipBtn);
}

function selectVoteTarget(targetId, btnEl) {
  selectedVoteTarget = targetId;
  document.querySelectorAll(".vote-btn").forEach((b) => b.classList.remove("selected"));
  btnEl.classList.add("selected");
  document.getElementById("btn-confirm-vote").disabled = false;
}

document.getElementById("btn-confirm-vote").addEventListener("click", () => {
  if (!selectedVoteTarget) return;
  document.querySelectorAll(".vote-btn").forEach((b) => (b.disabled = true));
  document.getElementById("btn-confirm-vote").disabled = true;
  socket.emit("player:vote", { code: roomCode, votedForId: selectedVoteTarget });
  document.getElementById("vote-status").textContent = "Vote submitted — waiting for others…";
});

// ---- Round results ----
socket.on("game:round-results", ({ eliminated, wasImposter, remainingActive }) => {
  const text = eliminated
    ? `${eliminated.nickname}${eliminated.id === myId ? " (you)" : ""} was voted out — ${wasImposter ? "they were" : "they were NOT"} the imposter. ${remainingActive} players remain.`
    : `No one was eliminated this round. ${remainingActive} players remain.`;

  if (eliminated && eliminated.id === myId) {
    iAmEliminated = true;
  }

  if (iAmEliminated) {
    document.getElementById("spectator-round-text").textContent = text;
    showScreen("spectator");
  } else {
    document.getElementById("round-elimination-text").textContent = text;
    showScreen("roundResults");
  }
});

// ---- Final results ----
socket.on("game:results", ({ imposter, winner, results }) => {
  const winnerText = winner === "crew"
    ? "🕵️ The crew caught the imposter!"
    : "🎭 The imposter got away with it!";
  document.getElementById("imposter-reveal").textContent = imposter
    ? `${winnerText} It was ${imposter.nickname}.`
    : winnerText;

  const list = document.getElementById("results-list");
  list.innerHTML = "";
  results.forEach((r) => {
    const li = document.createElement("li");
    if (r.wasImposter) li.classList.add("was-imposter");
    const youTag = r.id === myId ? " (you)" : "";
    const status = r.eliminated ? "eliminated" : "survived";
    li.innerHTML = `<span>${r.nickname}${youTag}${r.wasImposter ? " 🎭" : ""}</span><span>${status}</span>`;
    list.appendChild(li);
  });

  showScreen("results");
});

socket.on("room:reset", ({ room }) => {
  iAmEliminated = false;
  renderPlayerList(room.players);
  document.getElementById("btn-ready").disabled = false;
  showScreen("waiting");
});

socket.on("room:host-disconnected", () => {
  alert("Host disconnected. The room has closed.");
});
```

- [ ] **Step 3: Append to `public/player/style.css`**

Add to the end of the file:

```css
.vote-btn.selected { border-color: var(--accent); background: rgba(255,95,162,0.12); }
```

- [ ] **Step 4: Manual check**

Run: `npm start`, open the host page and 3 player pages (or 3 browser profiles), play through: join → select game → track-select → ready → Play → vote with the Confirm button gating submission → round results → Next Round. Confirm votes require a Confirm click (clicking a name alone shouldn't submit), and confirm "Skip" appears as an option. Stop the server after checking.

- [ ] **Step 5: Commit**

```bash
git add public/player/index.html public/player/player.js public/player/style.css
git commit -m "Add player UI for vote confirm/skip, round results, and spectator mode"
```

---

### Task 7: Full regression pass

**Files:** none (verification only)

**Interfaces:** none — this task re-runs everything built in Tasks 1–6 together.

- [ ] **Step 1: Run the unit test suite**

Run: `node --test "test/*.test.js"` (the bare-directory form `node --test test/` fails with `MODULE_NOT_FOUND` on this Node v24.13.1/Windows setup — confirmed during Task 2 — always use the glob form)
Expected: all tests from `imposterLogic.test.js` and `findTheImposter.test.js` pass (20 tests total), 0 failures.

- [ ] **Step 2: Run the live E2E script**

Run: `node test/e2e-rounds.js`
Expected: `ALL E2E SCENARIOS PASSED`, exit code 0.

- [ ] **Step 3: Manual browser walkthrough**

Run: `npm start`. With the host page and at least 3 player pages/devices open on the same network, play one full game end-to-end through the browser (not sockets) covering: track selection, Play/Pause/Resume/Restart at least once each, a round that results in no elimination (get the group — or yourself across tabs — to split votes or all Skip), a round with an elimination, and the final 2-player auto-end. This is the one step in this plan that can't be automated (no browser-driving tooling in this environator) — do not report the feature as fully verified until this manual pass has actually been done.

- [ ] **Step 4: Final commit**

If Step 3 turned up no changes needed, there's nothing new to commit — this task is a pure verification gate. If it did turn up a bug, fix it, re-run Steps 1–3, then:

```bash
git add -A
git commit -m "Fix issues found during full regression pass"
```

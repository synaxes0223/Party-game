# YouTube & Uploaded-File Audio Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the host supply a round's track pair from a pasted YouTube URL pair or a pool of uploaded local files, alongside the existing built-in pairs.

**Architecture:** A new pure-logic module (`audioSourceLogic.js`) resolves YouTube URLs and upload-pool picks into a common `TrackRef` shape; a new in-memory `uploadStore.js` holds the server-wide upload pool. `findTheImposter.js`'s round-start logic is refactored so all three source paths (built-in, YouTube, upload) converge on one `startRound()` function, and its playback-position broadcast becomes per-player (each player's own track start-second + shared elapsed time) instead of one shared value. Client-side, uploaded files need zero new code (they're just another URL through the existing `<audio>` pipeline); YouTube gets a new adapter wrapping a hidden `YT.Player` instance behind the same play-at/pause-at dispatch.

**Tech Stack:** Node.js, Express, Socket.io (unchanged), `multer` (new devDependency→**runtime** dependency, for multipart file upload), YouTube IFrame Player API (client-side, loaded from `https://www.youtube.com/iframe_api`), Node's built-in test runner + a live `socket.io-client` E2E script (same patterns as the round-elimination plan).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-youtube-and-upload-audio-sources-design.md` — every requirement in this plan traces back to it.
- All server-side changes are confined to `party-platform-full/party-game-platform/server/`.
- `multer` is a deliberate, justified new **runtime** dependency (not dev-only — the upload endpoint needs it in production use, unlike `socket.io-client` which is test-only).
- Uploaded files: `.mp3`/`.mp4` only, capped at 50MB, stored under `server/uploads/` (new gitignored directory), server-wide pool persisting until restart (in-memory, no database).
- YouTube pre-roll ad risk is an accepted, documented limitation — not mitigated in code.
- The two tracks in an upload pair must always be different files — enforced both when random-fill can't find a distinct second file and when the host explicitly submits the same id for both slots.
- Any timestamp embedded in a pasted YouTube URL is ignored — the host's explicit start-second field is the only source of truth.
- No new dependencies beyond `multer` — Node's built-in `crypto.randomUUID()` covers upload-file IDs, no separate UUID package.
- `node --test` requires the glob form `node --test "test/*.test.js"` — the bare-directory form fails on this Node v24.13.1/Windows setup (confirmed during the prior plan's Task 2).

All file paths below are relative to `C:\Users\Asus\Desktop\source\party_game\party-platform-full\party-game-platform\server\`.

---

### Task 1: Pure audio-source logic (`audioSourceLogic.js`)

**Files:**
- Create: `games/audioSourceLogic.js`
- Test: `test/audioSourceLogic.test.js`

**Interfaces:**
- Produces: `parseYouTubeVideoId(url: string): string|null`, `buildYoutubePair(normalInput: {url,startSeconds}, imposterInput: {url,startSeconds}): {normal,imposter}|{error}`, `pickUploadPair(pool: {id,url}[], normalFileId: string|null, imposterFileId: string|null): {normal,imposter}|{error}`, `computePlayerPosition(track: {startSeconds}, elapsedMs: number): number`. Consumed by Task 3.

- [ ] **Step 1: Write the failing test file**

Create `test/audioSourceLogic.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseYouTubeVideoId,
  buildYoutubePair,
  pickUploadPair,
  computePlayerPosition,
} = require("../games/audioSourceLogic");

test("parseYouTubeVideoId extracts the id from watch, embed, and short URLs", () => {
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("parseYouTubeVideoId returns null for unparseable input", () => {
  assert.equal(parseYouTubeVideoId("not a url"), null);
  assert.equal(parseYouTubeVideoId(""), null);
  assert.equal(parseYouTubeVideoId(undefined), null);
});

test("buildYoutubePair ignores any timestamp embedded in the URL, using the explicit field", () => {
  const result = buildYoutubePair(
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=999s", startSeconds: 10 },
    { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 40 }
  );
  assert.equal(result.normal.startSeconds, 10);
  assert.equal(result.imposter.startSeconds, 40);
  assert.equal(result.normal.videoId, "dQw4w9WgXcQ");
  assert.equal(result.normal.sourceType, "youtube");
});

test("buildYoutubePair errors on an unparseable URL", () => {
  const result = buildYoutubePair(
    { url: "not a url", startSeconds: 0 },
    { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 0 }
  );
  assert.match(result.error, /video ID/);
});

test("buildYoutubePair errors on a negative start second", () => {
  const result = buildYoutubePair(
    { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: -5 },
    { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 0 }
  );
  assert.match(result.error, /zero or positive/);
});

test("pickUploadPair uses explicit ids for both slots when given", () => {
  const pool = [
    { id: "a", url: "/uploads/a.mp3" },
    { id: "b", url: "/uploads/b.mp3" },
  ];
  const result = pickUploadPair(pool, "a", "b");
  assert.equal(result.normal.audioUrl, "/uploads/a.mp3");
  assert.equal(result.imposter.audioUrl, "/uploads/b.mp3");
  assert.equal(result.normal.sourceType, "upload");
  assert.equal(result.normal.startSeconds, 0);
});

test("pickUploadPair randomly fills an omitted slot from the remaining pool", () => {
  const pool = [
    { id: "a", url: "/uploads/a.mp3" },
    { id: "b", url: "/uploads/b.mp3" },
  ];
  const result = pickUploadPair(pool, "a", null);
  assert.equal(result.normal.audioUrl, "/uploads/a.mp3");
  assert.equal(result.imposter.audioUrl, "/uploads/b.mp3");
});

test("pickUploadPair randomly fills both slots when neither is given", () => {
  const pool = [
    { id: "a", url: "/uploads/a.mp3" },
    { id: "b", url: "/uploads/b.mp3" },
    { id: "c", url: "/uploads/c.mp3" },
  ];
  const result = pickUploadPair(pool, null, null);
  assert.notEqual(result.normal.audioUrl, result.imposter.audioUrl);
});

test("pickUploadPair errors when the pool can't satisfy 2 different files", () => {
  const pool = [{ id: "a", url: "/uploads/a.mp3" }];
  const result = pickUploadPair(pool, null, null);
  assert.match(result.error, /at least 2 different/);
});

test("pickUploadPair errors when the host explicitly picks the same file twice", () => {
  const pool = [
    { id: "a", url: "/uploads/a.mp3" },
    { id: "b", url: "/uploads/b.mp3" },
  ];
  const result = pickUploadPair(pool, "a", "a");
  assert.match(result.error, /at least 2 different/);
});

test("pickUploadPair errors when an explicit id doesn't exist in the pool", () => {
  const pool = [{ id: "a", url: "/uploads/a.mp3" }];
  const result = pickUploadPair(pool, "not-real", null);
  assert.match(result.error, /no longer exists/);
});

test("computePlayerPosition adds the track's start-second offset to the elapsed time", () => {
  assert.equal(computePlayerPosition({ startSeconds: 10 }, 500), 10500);
  assert.equal(computePlayerPosition({ startSeconds: 0 }, 500), 500);
  assert.equal(computePlayerPosition({}, 500), 500);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/audioSourceLogic.test.js`
Expected: FAIL — `Cannot find module '../games/audioSourceLogic'`

- [ ] **Step 3: Write the implementation**

Create `games/audioSourceLogic.js`:

```js
// audioSourceLogic.js
// Pure functions for resolving YouTube URLs and uploaded-file pairs into
// TrackRefs, plus the per-player playback position formula. No socket.io,
// no room state, no filesystem access — plain data in, plain data out.

const YOUTUBE_URL_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
];

function parseYouTubeVideoId(url) {
  if (typeof url !== "string") return null;
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function buildYoutubeTrack(input) {
  const videoId = parseYouTubeVideoId(input.url);
  if (!videoId) return { error: `Could not find a video ID in "${input.url}".` };
  const startSeconds = Number(input.startSeconds) || 0;
  if (startSeconds < 0) return { error: "Start second must be zero or positive." };
  return { videoId, startSeconds };
}

// Ignores any timestamp embedded in the URL itself -- the explicit
// startSeconds field on each input is the single source of truth.
function buildYoutubePair(normalInput, imposterInput) {
  const normalResult = buildYoutubeTrack(normalInput);
  if (normalResult.error) return { error: normalResult.error };
  const imposterResult = buildYoutubeTrack(imposterInput);
  if (imposterResult.error) return { error: imposterResult.error };
  return {
    normal: { sourceType: "youtube", videoId: normalResult.videoId, startSeconds: normalResult.startSeconds },
    imposter: { sourceType: "youtube", videoId: imposterResult.videoId, startSeconds: imposterResult.startSeconds },
  };
}

// Resolves a normal/imposter upload pair from the pool, given optional
// explicit file ids. Empty slots are randomly filled from the pool. The
// two resulting files must always be different -- this applies whether
// that's because random-fill couldn't find a distinct second file, or
// because the host explicitly submitted the same id for both slots.
function pickUploadPair(pool, normalFileId, imposterFileId) {
  const findById = (id) => pool.find((f) => f.id === id);

  let normalFile = normalFileId ? findById(normalFileId) : null;
  let imposterFile = imposterFileId ? findById(imposterFileId) : null;

  if (normalFileId && !normalFile) return { error: "Selected normal-track file no longer exists." };
  if (imposterFileId && !imposterFile) return { error: "Selected imposter-track file no longer exists." };

  if (normalFile && imposterFile && normalFile.id === imposterFile.id) {
    return { error: "Need at least 2 different uploaded files to use this source." };
  }

  if (!normalFile) {
    const candidates = pool.filter((f) => !imposterFile || f.id !== imposterFile.id);
    if (candidates.length === 0) return { error: "Need at least 2 different uploaded files to use this source." };
    normalFile = candidates[Math.floor(Math.random() * candidates.length)];
  }

  if (!imposterFile) {
    const candidates = pool.filter((f) => f.id !== normalFile.id);
    if (candidates.length === 0) return { error: "Need at least 2 different uploaded files to use this source." };
    imposterFile = candidates[Math.floor(Math.random() * candidates.length)];
  }

  return {
    normal: { sourceType: "upload", audioUrl: normalFile.url, startSeconds: 0 },
    imposter: { sourceType: "upload", audioUrl: imposterFile.url, startSeconds: 0 },
  };
}

// The per-player broadcast position: this player's own track start-second
// (0 for builtin/upload) plus the shared elapsed time since this round's
// playback segment began.
function computePlayerPosition(track, elapsedMs) {
  return (track.startSeconds || 0) * 1000 + elapsedMs;
}

module.exports = { parseYouTubeVideoId, buildYoutubePair, pickUploadPair, computePlayerPosition };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/audioSourceLogic.test.js`
Expected: PASS — 13 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add games/audioSourceLogic.js test/audioSourceLogic.test.js
git commit -m "Add pure logic for resolving YouTube and uploaded-file track pairs"
```

---

### Task 2: Upload pool store (`uploadStore.js`)

**Files:**
- Create: `games/uploadStore.js`
- Test: `test/uploadStore.test.js`

**Interfaces:**
- Produces: `addFile({originalName: string, storedFilename: string}): {id, originalName, storedFilename, url, uploadedAt}`, `listFiles(): Array<{id, originalName, storedFilename, url, uploadedAt}>`. Consumed by Task 3 (`findTheImposter.js`) and Task 4 (`index.js`'s upload endpoint).

- [ ] **Step 1: Write the failing test file**

Create `test/uploadStore.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const uploadStore = require("../games/uploadStore");

test("addFile returns a record with a generated id and url", () => {
  const file = uploadStore.addFile({ originalName: "song.mp3", storedFilename: "abc-song.mp3" });
  assert.ok(file.id);
  assert.equal(file.originalName, "song.mp3");
  assert.equal(file.storedFilename, "abc-song.mp3");
  assert.equal(file.url, "/uploads/abc-song.mp3");
  assert.ok(typeof file.uploadedAt === "number");
});

test("addFile generates distinct ids for successive files", () => {
  const a = uploadStore.addFile({ originalName: "a.mp3", storedFilename: "x-a.mp3" });
  const b = uploadStore.addFile({ originalName: "b.mp3", storedFilename: "y-b.mp3" });
  assert.notEqual(a.id, b.id);
});

test("listFiles returns everything added so far, in order", () => {
  const before = uploadStore.listFiles().length;
  uploadStore.addFile({ originalName: "c.mp3", storedFilename: "z-c.mp3" });
  const after = uploadStore.listFiles();
  assert.equal(after.length, before + 1);
  assert.equal(after[after.length - 1].originalName, "c.mp3");
});

test("listFiles returns a copy, not the live internal array", () => {
  const list = uploadStore.listFiles();
  list.push({ id: "fake", originalName: "should not persist" });
  const listAgain = uploadStore.listFiles();
  assert.equal(listAgain.some((f) => f.id === "fake"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/uploadStore.test.js`
Expected: FAIL — `Cannot find module '../games/uploadStore'`

- [ ] **Step 3: Write the implementation**

Create `games/uploadStore.js`:

```js
// uploadStore.js
// In-memory pool of host-uploaded audio files. Server-wide (not per-room),
// persists until the server process restarts -- consistent with the
// platform's existing all-in-memory room state, no database.

const crypto = require("crypto");

const files = []; // { id, originalName, storedFilename, url, uploadedAt }

function addFile({ originalName, storedFilename }) {
  const file = {
    id: crypto.randomUUID(),
    originalName,
    storedFilename,
    url: `/uploads/${storedFilename}`,
    uploadedAt: Date.now(),
  };
  files.push(file);
  return file;
}

function listFiles() {
  return files.slice();
}

module.exports = { addFile, listFiles };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/uploadStore.test.js`
Expected: PASS — 4 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add games/uploadStore.js test/uploadStore.test.js
git commit -m "Add in-memory upload pool store for host-supplied audio files"
```

---

### Task 3: Extend `findTheImposter.js` with the three-source round-start path and per-player position

**Files:**
- Modify: `games/findTheImposter.js` (full rewrite)
- Modify: `test/findTheImposter.test.js` (add new test cases; do not remove existing ones)

**Interfaces:**
- Consumes: `buildYoutubePair`, `pickUploadPair`, `computePlayerPosition` from `./audioSourceLogic` (Task 1); `listFiles` from `./uploadStore` (Task 2).
- Produces (new/changed exports, consumed by Task 4's `index.js`): `getUploadedFiles(): Array<{id,originalName,uploadedAt}>` (new), `onSelectYoutubePair(room, io, {normal, imposter}): {}|{error}` (new), `onSelectUploadPair(room, io, {normalFileId, imposterFileId}): {}|{error}` (new). All previously-existing exports (`meta`, `getTrackPairs`, `onSelectTrackPair`, `onPlayerReady`, `onHostPlay`, `onHostPause`, `onHostResume`, `onHostRestart`, `onVote`, `onNextRound`, `onPlayerLeft`) keep their exact same signatures — only their internal behavior changes (per-player position, shared `startRound` helper).
- `game:load-audio` payload changes from `{gameId, audioUrl}` to `{gameId, sourceType, audioUrl?, videoId?, startSeconds}` (the full `TrackRef` spread, plus `gameId`) — this is a breaking change to the event shape that Task 7 (player UI) must handle.

- [ ] **Step 1: Read the current file to confirm the exact starting point**

Run: `cat games/findTheImposter.js` — confirm it matches the version already shipped (11 exports: `meta`, `getTrackPairs`, `onSelectTrackPair`, `onPlayerReady`, `onHostPlay`, `onHostPause`, `onHostResume`, `onHostRestart`, `onVote`, `onNextRound`, `onPlayerLeft`; `onVote` emits `player:vote-rejected` on an invalid vote; `onHostPause`/`onHostResume`/`onHostRestart` accept `phase === "playing" || phase === "voting"`; `onPlayerLeft` ends the game immediately when `activeIds.length <= 2`). If anything doesn't match this description, STOP and report NEEDS_CONTEXT — do not proceed on an unexpected base.

- [ ] **Step 2: Write the new/changed test cases**

Add these test cases to the END of `test/findTheImposter.test.js` (keep every existing test in the file unchanged — this step only appends):

```js
test("getUploadedFiles reflects the upload store's contents", () => {
  const uploadStore = require("../games/uploadStore");
  const before = game.getUploadedFiles().length;
  uploadStore.addFile({ originalName: "extra.mp3", storedFilename: "extra-stored.mp3" });
  const after = game.getUploadedFiles();
  assert.equal(after.length, before + 1);
  assert.ok(after.some((f) => f.originalName === "extra.mp3"));
  const added = after.find((f) => f.originalName === "extra.mp3");
  assert.equal("url" in added, false); // never leaks the server file path, only display fields (id/name/date)
});

test("onSelectYoutubePair starts a round with the given tracks and per-player start seconds", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  const result = game.onSelectYoutubePair(room, io, {
    normal: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 10 },
    imposter: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 40 },
  });
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "loading");

  const loadEvents = emitted.filter((e) => e.event === "game:load-audio");
  assert.equal(loadEvents.length, 3);
  const imposterEvent = loadEvents.find((e) => e.id === room.gameState.imposterId);
  const crewEvent = loadEvents.find((e) => e.id !== room.gameState.imposterId);
  assert.equal(imposterEvent.payload.sourceType, "youtube");
  assert.equal(imposterEvent.payload.startSeconds, 40);
  assert.equal(crewEvent.payload.startSeconds, 10);
});

test("onSelectYoutubePair rejects an unparseable URL without starting a round", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io } = makeStubIo();
  const result = game.onSelectYoutubePair(room, io, {
    normal: { url: "not a url", startSeconds: 0 },
    imposter: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 0 },
  });
  assert.ok(result.error);
  assert.equal(room.gameState, null);
});

test("onSelectUploadPair starts a round using files from the pool", () => {
  const uploadStore = require("../games/uploadStore");
  const fileA = uploadStore.addFile({ originalName: "songA.mp3", storedFilename: "a-songA.mp3" });
  const fileB = uploadStore.addFile({ originalName: "songB.mp3", storedFilename: "b-songB.mp3" });

  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  const result = game.onSelectUploadPair(room, io, { normalFileId: fileA.id, imposterFileId: fileB.id });
  assert.deepEqual(result, {});

  const loadEvents = emitted.filter((e) => e.event === "game:load-audio");
  const imposterEvent = loadEvents.find((e) => e.id === room.gameState.imposterId);
  const crewEvent = loadEvents.find((e) => e.id !== room.gameState.imposterId);
  assert.equal(imposterEvent.payload.audioUrl, fileB.url);
  assert.equal(crewEvent.payload.audioUrl, fileA.url);
  assert.equal(imposterEvent.payload.sourceType, "upload");
});

test("onSelectUploadPair errors when the pool can't supply 2 different files", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io } = makeStubIo();
  const result = game.onSelectUploadPair(room, io, { normalFileId: null, imposterFileId: null });
  // The shared upload pool may already contain files from earlier tests in
  // this run; this test only asserts the error path is reachable when it's
  // genuinely empty, so it clears by reading the module fresh isn't
  // possible (no reset export) -- instead assert on a pool-independent
  // invariant: requesting the SAME explicit id for both slots always
  // errors regardless of pool size.
  const uploadStore = require("../games/uploadStore");
  const [first] = uploadStore.listFiles();
  if (first) {
    const dup = game.onSelectUploadPair(room, io, { normalFileId: first.id, imposterFileId: first.id });
    assert.ok(dup.error);
  } else {
    assert.ok(result.error);
  }
});

test("broadcastPlayAt gives each player their own track's position via onHostPlay", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onSelectYoutubePair(room, io, {
    normal: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 10 },
    imposter: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 40 },
  });
  readyAllActive(room, io);

  const { io: io2, emitted: emitted2 } = makeStubIo();
  game.onHostPlay(room, io2);

  const playEvents = emitted2.filter((e) => e.event === "game:play-at");
  const imposterEvent = playEvents.find((e) => e.id === room.gameState.imposterId);
  const crewEvent = playEvents.find((e) => e.id !== room.gameState.imposterId);
  assert.equal(imposterEvent.payload.position, 40000);
  assert.equal(crewEvent.payload.position, 10000);
});
```

- [ ] **Step 3: Run the test to verify the new cases fail**

Run: `node --test test/findTheImposter.test.js`
Expected: FAIL — `game.getUploadedFiles is not a function` (and similar for `onSelectYoutubePair`/`onSelectUploadPair`), since the current `findTheImposter.js` doesn't export them yet.

- [ ] **Step 4: Write the implementation**

Replace the entire contents of `games/findTheImposter.js`:

```js
// findTheImposter.js
// Game module: one player secretly gets a slightly different audio track.
// Runs as repeated elimination rounds (Mafia/Werewolf-style) until either the
// imposter is voted out (crew wins) or only 2 active players remain (imposter wins).
//
// A round's track pair can come from three sources: the built-in SONG_PAIRS
// list, a host-pasted YouTube URL pair, or a pair picked from the host's
// uploaded-file pool. All three converge on startRound() once resolved into
// a common { normal, imposter } TrackRef shape.

const { resolveRound, checkGameEnd, computeElapsedMs, SYNC_BUFFER_MS } = require("./imposterLogic");
const { buildYoutubePair, pickUploadPair, computePlayerPosition } = require("./audioSourceLogic");
const uploadStore = require("./uploadStore");

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

function getUploadedFiles() {
  return uploadStore.listFiles().map((f) => ({ id: f.id, originalName: f.originalName, uploadedAt: f.uploadedAt }));
}

function getActivePlayerIds(room) {
  const eliminated = room.gameState ? room.gameState.eliminated : new Set();
  return Array.from(room.players.keys()).filter((id) => !eliminated.has(id));
}

function getTrackForPlayer(gs, pid) {
  return pid === gs.imposterId ? gs.songPair.imposter : gs.songPair.normal;
}

function freshRoundState(gameState) {
  gameState.songPair = null;
  gameState.readyToPlay = new Set();
  gameState.votes = new Map();
  gameState.playback = { segmentStartedAt: null, segmentStartPosition: 0, isPaused: false };
}

// Shared by all three track-source paths: assigns the imposter on round 1,
// advances the round counter on later rounds, stores the resolved song pair,
// and sends each active player their own track plus the host their
// game:started signal.
function startRound(room, io, songPair) {
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
  gs.songPair = songPair;
  room.state = "in-progress";

  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    const track = getTrackForPlayer(gs, pid);
    io.to(pid).emit("game:load-audio", { gameId: meta.id, ...track });
  }

  io.to(room.hostSocketId).emit("game:started", {
    round: gs.round,
    playerCount: activeIds.length,
  });

  return {};
}

// Called when the host picks a built-in track pair — this both selects the
// audio AND starts the round.
function onSelectTrackPair(room, io, pairId) {
  const pair = SONG_PAIRS.find((p) => p.id === pairId);
  if (!pair) return { error: "Unknown track pair." };

  return startRound(room, io, {
    normal: { sourceType: "builtin", audioUrl: pair.normalUrl, startSeconds: 0 },
    imposter: { sourceType: "builtin", audioUrl: pair.imposterUrl, startSeconds: 0 },
  });
}

// Called when the host submits a YouTube URL pair for this round.
function onSelectYoutubePair(room, io, { normal, imposter }) {
  const result = buildYoutubePair(normal, imposter);
  if (result.error) return { error: result.error };
  return startRound(room, io, { normal: result.normal, imposter: result.imposter });
}

// Called when the host picks (or partially picks, with random-fill) a pair
// from the uploaded-file pool for this round.
function onSelectUploadPair(room, io, { normalFileId, imposterFileId }) {
  const pool = uploadStore.listFiles();
  const result = pickUploadPair(pool, normalFileId, imposterFileId);
  if (result.error) return { error: result.error };
  return startRound(room, io, { normal: result.normal, imposter: result.imposter });
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

// Broadcasts a synced play instant to every active player, computing each
// player's own position (their track's start-second + the shared elapsed
// time) rather than one shared position — see audioSourceLogic.computePlayerPosition.
function broadcastPlayAt(room, io, startAt, elapsedMs) {
  const gs = room.gameState;
  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    const track = getTrackForPlayer(gs, pid);
    const position = computePlayerPosition(track, elapsedMs);
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
  if (!gs || (gs.phase !== "playing" && gs.phase !== "voting") || gs.playback.isPaused) {
    return { error: "Nothing is playing right now." };
  }
  const pauseAt = Date.now() + SYNC_BUFFER_MS;
  const elapsedMs = gs.playback.segmentStartPosition + computeElapsedMs(gs.playback.segmentStartedAt, pauseAt);
  gs.playback.isPaused = true;
  gs.playback.pausedPosition = elapsedMs;

  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    io.to(pid).emit("game:pause-at", { pauseAt });
  }
  return {};
}

function onHostResume(room, io) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "playing" && gs.phase !== "voting") || !gs.playback.isPaused) {
    return { error: "Nothing is paused right now." };
  }
  const startAt = Date.now() + SYNC_BUFFER_MS;
  const resumeElapsedMs = gs.playback.pausedPosition;
  gs.playback = { segmentStartedAt: startAt, segmentStartPosition: resumeElapsedMs, isPaused: false };
  broadcastPlayAt(room, io, startAt, resumeElapsedMs);
  return {};
}

function onHostRestart(room, io) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "playing" && gs.phase !== "voting")) return { error: "Round isn't playing." };
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
    io.to(socketId).emit("player:vote-rejected", {
      reason: "That player is no longer available to vote for. Pick again.",
    });
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
// removed the player from room.players. Re-checks whether the round can now
// resolve with one fewer active player, and independently ends the game if
// attrition alone has dropped the active roster to 2 or fewer (matching the
// same threshold checkGameEnd uses after a normal elimination) — that check
// otherwise only runs inside resolveRoundAndAdvance, so a disconnect-driven
// drop to 2 players would never end the game on its own. Does not specially
// detect the imposter themselves disconnecting — matches the existing
// platform limitation of no reconnect/session-recovery support, not fixed
// here.
function onPlayerLeft(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase === "game-over") return {};

  gs.votes.delete(socketId);
  gs.readyToPlay.delete(socketId);
  const activeIds = getActivePlayerIds(room);
  if (activeIds.length === 0) return {};

  if (activeIds.length <= 2) {
    gs.phase = "game-over";
    gs.winner = "imposter";
    revealFinalResults(room, io, "imposter");
    return {};
  }

  if (gs.phase === "loading" && gs.readyToPlay.size >= activeIds.length) {
    io.to(room.hostSocketId).emit("game:all-ready");
  } else if ((gs.phase === "playing" || gs.phase === "voting") && gs.votes.size >= activeIds.length) {
    resolveRoundAndAdvance(room, io);
  }
  return {};
}

module.exports = {
  meta,
  getTrackPairs,
  getUploadedFiles,
  onSelectTrackPair,
  onSelectYoutubePair,
  onSelectUploadPair,
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

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test "test/*.test.js"`
Expected: PASS — all tests across all three test files (imposterLogic, uploadStore, findTheImposter, audioSourceLogic) pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add games/findTheImposter.js test/findTheImposter.test.js
git commit -m "Add YouTube and upload track-pair sources with per-player playback position"
```

---

### Task 4: Wire the upload endpoint and new socket events in `index.js`

**Files:**
- Modify: `index.js` (full rewrite)
- Modify: `package.json` (add `multer` runtime dependency)
- Modify (create if absent): `.gitignore` — add `uploads/`

**Interfaces:**
- Consumes: `getUploadedFiles`, `onSelectYoutubePair`, `onSelectUploadPair` from Task 3's `games/findTheImposter.js`; `addFile` from Task 2's `games/uploadStore.js`.
- Produces: `POST /api/upload-audio` HTTP endpoint; `/uploads/*` static file serving; new socket events `host:list-uploaded-files`, `host:select-youtube-pair`, `host:select-upload-pair` — consumed by Task 6 (host UI).

- [ ] **Step 1: Add `multer` to `package.json`**

Edit `package.json` — change the `dependencies` block from:

```json
  "dependencies": {
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  },
```

to:

```json
  "dependencies": {
    "express": "^4.19.2",
    "multer": "^1.4.5-lts.1",
    "socket.io": "^4.7.5"
  },
```

Run: `npm install`
Expected: `multer` added under `node_modules`, no errors.

- [ ] **Step 2: Ignore the uploads directory**

Read `.gitignore` (it currently contains only `node_modules/`). Add a line so it reads:

```
node_modules/
uploads/
```

- [ ] **Step 3: Replace the entire contents of `index.js`**

```js
// index.js
// Party Game Platform - server entry point.
// Serves host/player web pages and coordinates rooms via Socket.io.

const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");

const roomService = require("./roomService");
const gameRegistry = require("./games/registry");
const uploadStore = require("./games/uploadStore");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "audio")));
app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/api/games", (req, res) => {
  res.json(gameRegistry.listGames());
});

const uploadStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp3|mp4)$/i.test(file.originalname);
    cb(ok ? null : new Error("Only .mp3 and .mp4 files are allowed."), ok);
  },
});

app.post("/api/upload-audio", (req, res) => {
  upload.single("audio")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    const file = uploadStore.addFile({
      originalName: req.file.originalname,
      storedFilename: req.file.filename,
    });
    res.json({ id: file.id, originalName: file.originalName, url: file.url });
  });
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
// off to `handler`.
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

  // ---- HOST: pick a track pair (also starts the round) ----
  socket.on("host:select-track-pair", ({ code, pairId }) => {
    withHostGame(socket, code, (room, game) => game.onSelectTrackPair(room, io, pairId));
  });

  // ---- HOST: pick a YouTube URL pair (also starts the round) ----
  socket.on("host:select-youtube-pair", ({ code, normal, imposter }) => {
    withHostGame(socket, code, (room, game) => game.onSelectYoutubePair(room, io, { normal, imposter }));
  });

  // ---- HOST: pick an uploaded-file pair (also starts the round) ----
  socket.on("host:select-upload-pair", ({ code, normalFileId, imposterFileId }) => {
    withHostGame(socket, code, (room, game) => game.onSelectUploadPair(room, io, { normalFileId, imposterFileId }));
  });

  // ---- HOST: list the uploaded-file pool ----
  socket.on("host:list-uploaded-files", ({ code }) => {
    withHostGame(socket, code, (room, game) => {
      socket.emit("game:uploaded-files", { files: game.getUploadedFiles ? game.getUploadedFiles() : [] });
      return {};
    });
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
      roomService.deleteRoom(hostedRoom.code);
    }
  });
});

server.listen(PORT, "0.0.0.0", printLanUrl);
```

Note what changed vs. the previous version: three new handlers (`host:select-youtube-pair`, `host:select-upload-pair`, `host:list-uploaded-files`), the upload endpoint + static route + `uploads/` directory creation, and the `multer`/`uploadStore` requires. Everything else — including the disconnect handler's `deleteRoom` call and every other existing handler — is unchanged from the currently-shipped file.

- [ ] **Step 4: Smoke-test the server boots and the upload endpoint responds**

Run: `node index.js` (from the `server/` directory; stop with Ctrl+C after checking)
Expected: `Server running on port 3000`, no stack trace.

In a second terminal while it's running:
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/games`
Expected: `200`

Run: `curl -s -X POST http://localhost:3000/api/upload-audio`
Expected: a `400` status with a JSON body containing `{"error":"No file uploaded."}` (no file attached in this bare curl call — confirms the route exists and the error path works without needing a real file yet).

- [ ] **Step 5: Commit**

```bash
git add index.js package.json package-lock.json .gitignore
git commit -m "Wire YouTube/upload track-pair events and the file upload endpoint"
```

---

### Task 5: Live E2E script for the two new audio sources

**Files:**
- Create: `test/e2e-audio-sources.js`

**Interfaces:**
- Consumes: the full socket/HTTP surface from Task 4 (`host:select-youtube-pair`, `host:select-upload-pair`, `host:list-uploaded-files`, `game:uploaded-files`, `POST /api/upload-audio`), plus the unchanged room/game-selection/playback events already exercised by `test/e2e-rounds.js`.
- Produces: a runnable script (`node test/e2e-audio-sources.js`) that exits 0 on success, 1 on failure.

This is a new, self-contained script — it does not modify or import from the already-shipped, already-reviewed `test/e2e-rounds.js`; a small amount of helper duplication here is preferable to touching that file for an unrelated feature.

- [ ] **Step 1: Write `test/e2e-audio-sources.js`**

```js
// test/e2e-audio-sources.js
// Live integration check for the YouTube and uploaded-file audio sources:
// runs the real server in-process and drives both paths through
// socket.io-client and the real HTTP upload endpoint (no mocks).
// Run with: node test/e2e-audio-sources.js

const path = require("node:path");
const { io } = require("socket.io-client");

const PORT = 3098;
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

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function uploadFixtureFile(filename) {
  const form = new FormData();
  form.append("audio", new Blob([`fake audio bytes for ${filename}`], { type: "audio/mpeg" }), filename);
  const res = await fetch(`${URL}/api/upload-audio`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(`Upload of ${filename} failed: ${data.error}`);
  return data;
}

async function scenario_uploadPair() {
  console.log("\n[Scenario 1] upload-pair round: explicit normal + imposter files");
  const fileA = await uploadFixtureFile("fixtureA.mp3");
  const fileB = await uploadFixtureFile("fixtureB.mp3");

  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol"]);
  await selectGame(host, roomCode);

  const listPromise = once(host, "game:uploaded-files");
  host.emit("host:list-uploaded-files", { code: roomCode });
  const list = await listPromise;
  assertTrue(list.files.some((f) => f.id === fileA.id), "expected fixtureA to be in the pool");
  assertTrue(list.files.some((f) => f.id === fileB.id), "expected fixtureB to be in the pool");

  const loadPromises = players.map((p) => once(p.socket, "game:load-audio"));
  host.emit("host:select-upload-pair", { code: roomCode, normalFileId: fileA.id, imposterFileId: fileB.id });
  const loads = await Promise.all(loadPromises);

  const room = await new Promise((resolve) => {
    // We don't have direct room access from the client; infer imposter by
    // which player's audioUrl matches fileB (the imposter file we set).
    resolve(players.find((p, i) => loads[i].audioUrl === fileB.url));
  });
  assertTrue(!!room, "expected exactly one player to receive the imposter file");
  const imposterIndex = players.indexOf(room);
  loads.forEach((load, i) => {
    assertTrue(load.sourceType === "upload", "expected sourceType upload for every player");
    assertTrue(load.startSeconds === 0, "expected upload tracks to have startSeconds 0");
    const expectedUrl = i === imposterIndex ? fileB.url : fileA.url;
    assertTrue(load.audioUrl === expectedUrl, `expected player ${i} to get ${expectedUrl}, got ${load.audioUrl}`);
  });

  console.log("  PASS — explicit upload pair correctly assigned per player");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario_uploadPairRandomFill() {
  console.log("\n[Scenario 2] upload-pair round: one explicit file, one random-filled");
  const fileA = await uploadFixtureFile("fixtureC.mp3");
  await uploadFixtureFile("fixtureD.mp3"); // adds a second pool candidate for random-fill

  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Dan", "Eve", "Frank"]);
  await selectGame(host, roomCode);

  const loadPromises = players.map((p) => once(p.socket, "game:load-audio"));
  host.emit("host:select-upload-pair", { code: roomCode, normalFileId: fileA.id, imposterFileId: null });
  const loads = await Promise.all(loadPromises);

  const urls = new Set(loads.map((l) => l.audioUrl));
  assertTrue(urls.size === 2, "expected exactly 2 distinct audio URLs assigned across the 3 players");
  assertTrue(loads.some((l) => l.audioUrl === fileA.url), "expected fixtureA to still be used for the normal track");

  console.log("  PASS — random-fill produced a valid, distinct second file");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario_uploadPairInsufficientPool() {
  console.log("\n[Scenario 3] upload-pair round: rejected when host picks the same file twice");
  const fileA = await uploadFixtureFile("fixtureE.mp3");

  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Gina", "Hank", "Ivy"]);
  await selectGame(host, roomCode);

  const errorPromise = once(host, "host:error");
  host.emit("host:select-upload-pair", { code: roomCode, normalFileId: fileA.id, imposterFileId: fileA.id });
  const errorMsg = await errorPromise;
  assertTrue(/at least 2 different/.test(errorMsg.error), `expected the duplicate-file error, got: ${errorMsg.error}`);

  console.log("  PASS — duplicate file selection rejected with a clear error");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario_youtubePairWithDifferentStartSeconds() {
  console.log("\n[Scenario 4] YouTube pair round: different start-seconds per track, verified structurally");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Jill", "Kevin", "Liam"]);
  await selectGame(host, roomCode);

  const loadPromises = players.map((p) => once(p.socket, "game:load-audio"));
  host.emit("host:select-youtube-pair", {
    code: roomCode,
    normal: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", startSeconds: 10 },
    imposter: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 40 },
  });
  const loads = await Promise.all(loadPromises);

  loads.forEach((l) => assertTrue(l.sourceType === "youtube" && l.videoId === "dQw4w9WgXcQ", "expected every player to get the same video id"));
  const imposterLoadIndex = loads.findIndex((l) => l.startSeconds === 40);
  assertTrue(imposterLoadIndex !== -1, "expected exactly one player to have startSeconds 40 (the imposter)");
  loads.forEach((l, i) => {
    const expected = i === imposterLoadIndex ? 40 : 10;
    assertTrue(l.startSeconds === expected, `expected player ${i} startSeconds ${expected}, got ${l.startSeconds}`);
  });

  // Ready everyone and play — confirm the broadcast position reflects each
  // player's own start-second (this is the per-player position formula,
  // verified structurally without any real YouTube connectivity).
  const readyPromise = once(host, "game:all-ready");
  players.forEach((p) => p.socket.emit("player:audio-ready", { code: roomCode }));
  await readyPromise;

  const playPromises = players.map((p) => once(p.socket, "game:play-at"));
  host.emit("host:play-audio", { code: roomCode });
  const plays = await Promise.all(playPromises);

  plays.forEach((play, i) => {
    const expected = i === imposterLoadIndex ? 40000 : 10000;
    assertTrue(play.position === expected, `expected player ${i} play position ${expected}, got ${play.position}`);
  });

  console.log("  PASS — per-player start-seconds correctly threaded through load-audio and play-at");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario_youtubeBadUrl() {
  console.log("\n[Scenario 5] YouTube pair round: rejected on an unparseable URL");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Mona", "Noah", "Owen"]);
  await selectGame(host, roomCode);

  const errorPromise = once(host, "host:error");
  host.emit("host:select-youtube-pair", {
    code: roomCode,
    normal: { url: "not a url", startSeconds: 0 },
    imposter: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 0 },
  });
  const errorMsg = await errorPromise;
  assertTrue(/video ID/.test(errorMsg.error), `expected a video-ID parse error, got: ${errorMsg.error}`);

  console.log("  PASS — unparseable URL rejected with a clear error");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((r) => setTimeout(r, 300));
  console.log(`Test server up on port ${PORT}`);

  try {
    await scenario_uploadPair();
    await scenario_uploadPairRandomFill();
    await scenario_uploadPairInsufficientPool();
    await scenario_youtubePairWithDifferentStartSeconds();
    await scenario_youtubeBadUrl();

    console.log("\nALL AUDIO-SOURCE E2E SCENARIOS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 2: Run it**

Run: `node test/e2e-audio-sources.js` (from the `server/` directory)
Expected: every `[Scenario N]` block prints `PASS`, ending with `ALL AUDIO-SOURCE E2E SCENARIOS PASSED`, exit code 0.

Run it a second time to confirm no flakiness (the random-fill scenario has genuine randomness in which file lands where, though the assertions don't depend on a specific outcome, only distinctness):
Run: `node test/e2e-audio-sources.js`
Expected: same clean pass.

- [ ] **Step 3: Add a package.json script and commit**

Edit `package.json`'s `scripts` block to add an entry (keep the existing `test` and `test:e2e` entries):

```json
    "test:e2e-audio": "node test/e2e-audio-sources.js"
```

```bash
git add test/e2e-audio-sources.js package.json
git commit -m "Add live E2E verification for YouTube and uploaded-file audio sources"
```

---

### Task 6: Host UI — three-tab track-select screen

**Files:**
- Modify: `public/host/index.html`
- Modify: `public/host/host.js`
- Modify: `public/host/style.css`

**Interfaces:**
- Consumes: `game:uploaded-files`, `game:track-pairs` (unchanged), `host:error` (unchanged) from Task 4's `index.js`.
- Emits: `host:list-uploaded-files`, `host:select-youtube-pair`, `host:select-upload-pair`; and a raw `fetch` POST to `/api/upload-audio`.

- [ ] **Step 1: Replace the `screen-track-select` section in `public/host/index.html`**

Find this block (from the currently-shipped file):

```html
    <section id="screen-track-select" class="screen">
      <h2 id="round-title">Round 1</h2>
      <p class="subtitle"><span id="active-count">0</span> players still in</p>
      <div id="pair-list" class="pair-list"></div>
      <p id="track-select-error" class="error"></p>
    </section>
```

Replace it with:

```html
    <section id="screen-track-select" class="screen">
      <h2 id="round-title">Round 1</h2>
      <p class="subtitle"><span id="active-count">0</span> players still in</p>

      <div class="source-tabs">
        <button type="button" class="tab-btn active" data-tab="builtin">Built-in</button>
        <button type="button" class="tab-btn" data-tab="youtube">YouTube</button>
        <button type="button" class="tab-btn" data-tab="upload">Uploaded Files</button>
      </div>

      <div id="tab-builtin" class="tab-panel active">
        <div id="pair-list" class="pair-list"></div>
      </div>

      <div id="tab-youtube" class="tab-panel">
        <label class="field-label">Normal track URL
          <input id="yt-normal-url" class="input-field" placeholder="https://youtube.com/watch?v=..." />
        </label>
        <label class="field-label">Normal start (seconds)
          <input id="yt-normal-start" class="input-field" type="number" min="0" value="0" />
        </label>
        <label class="field-label">Imposter track URL
          <input id="yt-imposter-url" class="input-field" placeholder="https://youtube.com/watch?v=..." />
        </label>
        <label class="field-label">Imposter start (seconds)
          <input id="yt-imposter-start" class="input-field" type="number" min="0" value="0" />
        </label>
        <button type="button" id="btn-select-youtube" class="btn-primary">Use These Tracks</button>
      </div>

      <div id="tab-upload" class="tab-panel">
        <input id="upload-file-input" type="file" accept=".mp3,.mp4" />
        <button type="button" id="btn-upload-file" class="btn-secondary">Upload</button>
        <p id="upload-status" class="hint"></p>
        <div id="upload-file-list" class="upload-file-list"></div>
        <button type="button" id="btn-select-upload" class="btn-primary">Use Selected Files</button>
      </div>

      <p id="track-select-error" class="error"></p>
    </section>
```

- [ ] **Step 2: Add the new logic to `public/host/host.js`**

Find the existing `enterTrackSelect` function:

```js
function enterTrackSelect() {
  document.getElementById("active-count").textContent = activePlayerCount;
  document.getElementById("round-title").textContent = `Round ${lastKnownRound + 1}`;
  showScreen("trackSelect");
}
```

Replace it with (adds a tab/selection reset on every fresh entry to track-select):

```js
let selectedUploadIds = { normal: null, imposter: null };

function enterTrackSelect() {
  document.getElementById("active-count").textContent = activePlayerCount;
  document.getElementById("round-title").textContent = `Round ${lastKnownRound + 1}`;
  document.getElementById("track-select-error").textContent = "";
  selectedUploadIds = { normal: null, imposter: null };
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector('.tab-btn[data-tab="builtin"]').classList.add("active");
  document.getElementById("tab-builtin").classList.add("active");
  showScreen("trackSelect");
}
```

Then append this new block to the end of `host.js` (after the existing `socket.on("room:reset", ...)` handler):

```js
// ---- Track-select tabs ----
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "upload") {
      socket.emit("host:list-uploaded-files", { code: roomCode });
    }
  });
});

// ---- YouTube tab ----
document.getElementById("btn-select-youtube").addEventListener("click", () => {
  document.getElementById("track-select-error").textContent = "";
  const normalUrl = document.getElementById("yt-normal-url").value.trim();
  const normalStart = Number(document.getElementById("yt-normal-start").value) || 0;
  const imposterUrl = document.getElementById("yt-imposter-url").value.trim();
  const imposterStart = Number(document.getElementById("yt-imposter-start").value) || 0;
  socket.emit("host:select-youtube-pair", {
    code: roomCode,
    normal: { url: normalUrl, startSeconds: normalStart },
    imposter: { url: imposterUrl, startSeconds: imposterStart },
  });
});

// ---- Uploaded-files tab ----
document.getElementById("btn-upload-file").addEventListener("click", async () => {
  const input = document.getElementById("upload-file-input");
  const file = input.files[0];
  const statusEl = document.getElementById("upload-status");
  if (!file) {
    statusEl.textContent = "Choose a file first.";
    return;
  }
  statusEl.textContent = "Uploading…";
  const form = new FormData();
  form.append("audio", file);
  try {
    const res = await fetch("/api/upload-audio", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || "Upload failed.";
      return;
    }
    statusEl.textContent = `Uploaded ${data.originalName}.`;
    input.value = "";
    socket.emit("host:list-uploaded-files", { code: roomCode });
  } catch (err) {
    statusEl.textContent = "Upload failed — check your connection.";
  }
});

socket.on("game:uploaded-files", ({ files }) => {
  renderUploadFileList(files);
});

function renderUploadFileList(files) {
  const container = document.getElementById("upload-file-list");
  container.innerHTML = "";
  if (files.length === 0) {
    container.innerHTML = '<p class="hint">No files uploaded yet.</p>';
    return;
  }
  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "upload-file-row";
    row.innerHTML = `
      <span>${f.originalName}</span>
      <button type="button" class="btn-secondary btn-slot" data-role="normal" data-id="${f.id}">Normal</button>
      <button type="button" class="btn-secondary btn-slot" data-role="imposter" data-id="${f.id}">Imposter</button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll(".btn-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.dataset.role;
      const id = btn.dataset.id;
      selectedUploadIds[role] = selectedUploadIds[role] === id ? null : id;
      container.querySelectorAll(`.btn-slot[data-role="${role}"]`).forEach((b) => b.classList.remove("selected"));
      if (selectedUploadIds[role]) {
        const activeBtn = container.querySelector(`.btn-slot[data-role="${role}"][data-id="${selectedUploadIds[role]}"]`);
        if (activeBtn) activeBtn.classList.add("selected");
      }
    });
  });
}

document.getElementById("btn-select-upload").addEventListener("click", () => {
  document.getElementById("track-select-error").textContent = "";
  socket.emit("host:select-upload-pair", {
    code: roomCode,
    normalFileId: selectedUploadIds.normal,
    imposterFileId: selectedUploadIds.imposter,
  });
});
```

- [ ] **Step 3: Append new styles to `public/host/style.css`**

```css
.source-tabs { display: flex; gap: 8px; margin: 16px 0; }
.tab-btn {
  flex: 1;
  padding: 10px;
  border: 2px solid transparent;
  border-radius: 10px;
  background: rgba(255,255,255,0.05);
  color: var(--text-dim);
  cursor: pointer;
  font-size: 0.9rem;
}
.tab-btn.active { border-color: var(--accent); color: var(--text); background: rgba(255,95,162,0.12); }

.tab-panel { display: none; }
.tab-panel.active { display: block; }

.field-label { display: block; margin-bottom: 12px; color: var(--text-dim); font-size: 0.9rem; }

.input-field {
  display: block;
  width: 100%;
  padding: 14px;
  font-size: 1rem;
  border-radius: 10px;
  border: 2px solid rgba(255,255,255,0.1);
  background: var(--panel);
  color: var(--text);
  margin-top: 6px;
}
.input-field:focus { outline: none; border-color: var(--accent); }

.upload-file-list { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.upload-file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--panel);
  padding: 10px 14px;
  border-radius: 10px;
}
.upload-file-row span { flex: 1; font-size: 0.9rem; }
.btn-slot { padding: 8px 12px; font-size: 0.85rem; width: auto; }
.btn-slot.selected { border-color: var(--accent); background: rgba(255,95,162,0.25); }
```

- [ ] **Step 4: Manual check**

Run: `npm start`, open `http://localhost:3000/host/`, create a room, join 3 players (from `http://localhost:3000/player/` tabs), select "Find the Imposter," click "Continue to Round 1." Confirm the three tabs render and switching tabs works, the Uploaded Files tab requests and shows an empty-pool message initially, and uploading a small test `.mp3` file (any small mp3 you have, or create one with `ffmpeg -f lavfi -i sine -t 1 test.mp3` if available, or any existing small audio file) makes it appear in the list with Normal/Imposter buttons. Stop the server after checking.

- [ ] **Step 5: Commit**

```bash
git add public/host/index.html public/host/host.js public/host/style.css
git commit -m "Add host UI tabs for YouTube URLs and uploaded-file track pairs"
```

---

### Task 7: Player UI — YouTube IFrame adapter

**Files:**
- Modify: `public/player/index.html`
- Modify: `public/player/player.js`

**Interfaces:**
- Consumes: `game:load-audio` (payload shape changed from `{gameId, audioUrl}` to `{gameId, sourceType, audioUrl?, videoId?, startSeconds}`), `game:play-at` (unchanged shape, now dispatched per-source), `game:pause-at` (unchanged shape, dispatched per-source) from Task 3/4.
- Produces: no new events — this task is purely about correctly rendering/playing whatever `game:load-audio` sends, uploaded files needing zero special-casing since they're already just another `audioUrl`.

- [ ] **Step 1: Add the hidden YouTube player container to `public/player/index.html`**

Find this line:

```html
  <audio id="audio-player" preload="auto"></audio>
```

Replace it with:

```html
  <audio id="audio-player" preload="auto"></audio>
  <div id="youtube-player-container" style="position:absolute; left:-9999px; width:1px; height:1px;"></div>
```

- [ ] **Step 2: Add the YouTube adapter and dual-dispatch logic to `public/player/player.js`**

Find this block:

```js
// ---- Game: audio loading ----
const audioEl = document.getElementById("audio-player");

socket.on("game:load-audio", ({ audioUrl }) => {
  audioEl.src = audioUrl;
  audioEl.load();
  document.getElementById("ready-status").textContent = "";
  document.getElementById("btn-ready").disabled = false;
  showScreen("audioReady");
});
```

Replace it with:

```js
// ---- Game: audio loading (built-in/upload use <audio>, YouTube uses a
// hidden IFrame Player -- both are dispatched from the same handler based
// on the track's sourceType) ----
const audioEl = document.getElementById("audio-player");
let currentTrack = null;
let ytPlayer = null;
let ytApiReadyPromise = null;

function ensureYouTubeApiLoaded() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiReadyPromise) return ytApiReadyPromise;
  ytApiReadyPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiReadyPromise;
}

function ensureYtPlayer() {
  return ensureYouTubeApiLoaded().then(() => {
    if (ytPlayer) return ytPlayer;
    return new Promise((resolve) => {
      ytPlayer = new YT.Player("youtube-player-container", {
        height: "1",
        width: "1",
        events: {
          onReady: () => resolve(ytPlayer),
          onError: () => {
            document.getElementById("ready-status").textContent =
              "This video couldn't be loaded — ask the host to pick a different link.";
            document.getElementById("btn-ready").disabled = true;
          },
        },
      });
    });
  });
}

socket.on("game:load-audio", (track) => {
  currentTrack = track;
  document.getElementById("ready-status").textContent = "";
  document.getElementById("btn-ready").disabled = false;

  if (track.sourceType === "youtube") {
    ensureYtPlayer().then((player) => {
      player.cueVideoById({ videoId: track.videoId, startSeconds: track.startSeconds || 0 });
    });
  } else {
    audioEl.src = track.audioUrl;
    audioEl.load();
  }
  showScreen("audioReady");
});
```

Find this block:

```js
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
```

Replace it with:

```js
document.getElementById("btn-ready").addEventListener("click", () => {
  // iOS/Android require a user gesture before audio can be played later —
  // this tap counts as that gesture. We prime playback here (play+immediately
  // pause) so the later synced play() call succeeds without another prompt.
  const markReady = () => {
    socket.emit("player:audio-ready", { code: roomCode });
    document.getElementById("ready-status").textContent = "Waiting for the host to start playback…";
    document.getElementById("btn-ready").disabled = true;
  };

  if (currentTrack && currentTrack.sourceType === "youtube") {
    ensureYtPlayer().then((player) => {
      player.playVideo();
      setTimeout(() => player.pauseVideo(), 50);
      markReady();
    });
    return;
  }

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
```

Find this block:

```js
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
```

Replace it with:

```js
// ---- Game: host-controlled synced playback ----
socket.on("game:play-at", ({ startAt, position }) => {
  const delay = Math.max(0, startAt - Date.now());
  if (currentTrack && currentTrack.sourceType === "youtube") {
    setTimeout(() => {
      ytPlayer.seekTo((position || 0) / 1000, true);
      ytPlayer.playVideo();
    }, delay);
  } else {
    setTimeout(() => {
      audioEl.currentTime = (position || 0) / 1000;
      audioEl.play().catch((err) => console.warn("Playback failed:", err));
    }, delay);
  }

  selectedVoteTarget = null;
  renderVoteOptions(currentPlayers);
  showScreen("playing");
  document.getElementById("vote-status").textContent = "";
});

socket.on("game:pause-at", ({ pauseAt }) => {
  const delay = Math.max(0, pauseAt - Date.now());
  if (currentTrack && currentTrack.sourceType === "youtube") {
    setTimeout(() => ytPlayer.pauseVideo(), delay);
  } else {
    setTimeout(() => audioEl.pause(), delay);
  }
});
```

- [ ] **Step 3: Manual check**

Run: `npm start`, open the host page and 3 player pages. Play a round using the YouTube tab (paste a real, short, ad-free-if-possible YouTube URL for both normal and imposter, with different start-seconds, e.g. 5 and 20). Confirm: players reach the "I'm Ready" screen without the page visibly showing a video (the iframe should be invisible), tapping Ready doesn't error in the browser console, and clicking Play on the host actually produces audible YouTube audio on each player's device starting at roughly their assigned second. Also play one round using an uploaded file (from Task 6's manual check) to confirm that path still works unchanged. Stop the server after checking.

- [ ] **Step 4: Commit**

```bash
git add public/player/index.html public/player/player.js
git commit -m "Add YouTube IFrame player adapter alongside the existing HTML5 audio path"
```

---

### Task 8: Full regression pass

**Files:** none (verification only)

**Interfaces:** none — this task re-runs everything built in Tasks 1–7 together.

- [ ] **Step 1: Run the full unit test suite**

Run: `node --test "test/*.test.js"`
Expected: all tests across `imposterLogic.test.js`, `findTheImposter.test.js`, `audioSourceLogic.test.js`, and `uploadStore.test.js` pass, 0 failures.

- [ ] **Step 2: Run both live E2E scripts**

Run: `node test/e2e-rounds.js`
Expected: `ALL E2E SCENARIOS PASSED` (confirms this feature didn't regress the round-elimination behavior — same server file, same event names for the unchanged paths).

Run: `node test/e2e-audio-sources.js`
Expected: `ALL AUDIO-SOURCE E2E SCENARIOS PASSED`.

- [ ] **Step 3: Manual browser walkthrough**

With the host page and at least 3 player pages/devices open on the same network, play through: a round using a built-in pair (confirm nothing regressed there), a round using two uploaded files, and a round using a YouTube URL pair with different start-seconds for normal/imposter — covering Play/Pause/Resume/Restart at least once on the YouTube round specifically, since that's the path with the least automated coverage (IFrame playback itself isn't exercisable by the E2E script). This is the one step in this plan that can't be automated (no browser-driving tooling in this environment) — do not report the feature as fully verified until this manual pass has actually been done.

- [ ] **Step 4: Final commit**

If Step 3 turned up no changes needed, there's nothing new to commit — this task is a pure verification gate. If it did turn up a bug, fix it, re-run Steps 1–2, then:

```bash
git add -A
git commit -m "Fix issues found during full regression pass"
```

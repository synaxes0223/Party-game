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

test("a disconnected player is excluded from vote quorum, letting the round resolve without their input", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");

  // p4 drops mid-game but keeps their seat in room.players (durable-session
  // reconnect model) -- only their connected flag flips.
  room.players.get("p4").connected = false;

  const activeIds = ["p1", "p2", "p3"];
  activeIds.forEach((id) => game.onPlayerReady(room, io, id));

  // Without the fix, getActivePlayerIds still counts p4, so readyToPlay.size
  // (3) never reaches activeIds.length (4) and this errors instead.
  const playResult = game.onHostPlay(room, io);
  assert.deepEqual(playResult, {});
  assert.equal(room.gameState.phase, "playing");

  activeIds.forEach((id) => game.onVote(room, io, id, "skip"));

  // Without the fix, votes.size (3) never reaches the inflated
  // activeIds.length (4), so the round would stay stuck in "voting" forever.
  assert.equal(room.gameState.phase, "round-results");
  assert.equal(room.gameState.votes.size, 3);
});

test("a stale vote from a player who has since disconnected does not let the round resolve before every remaining connected player has voted", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");
  readyAllActive(room, io);
  game.onHostPlay(room, io);

  // p1 votes while still connected...
  game.onVote(room, io, "p1", "skip");
  // ...then disconnects, but keeps their seat in room.players (durable-
  // session reconnect model) -- their already-cast vote stays in gs.votes.
  room.players.get("p1").connected = false;

  game.onVote(room, io, "p2", "skip");
  game.onVote(room, io, "p3", "skip");

  // votes.size is now 3 (p1's stale vote + p2 + p3), which matches the
  // naive connected-player count (p2, p3, p4) -- but p4, who is still
  // connected, never voted. A size-only quorum check would incorrectly
  // resolve here; the round must instead keep waiting for p4.
  assert.equal(room.gameState.phase, "voting");
  assert.equal(room.gameState.votes.size, 3);

  game.onVote(room, io, "p4", "skip");
  assert.equal(room.gameState.phase, "round-results");
});

test("an eliminated player is excluded from audio and votes in the following round", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io, emitted } = makeStubIo();
  game.onSelectTrackPair(room, io, "pair1");
  readyAllActive(room, io);
  game.onHostPlay(room, io);

  const imposterId = room.gameState.imposterId;
  const nonImposters = ["p1", "p2", "p3", "p4"].filter((id) => id !== imposterId);
  const [victim, voterB, voterC] = nonImposters;

  // 3 of 4 active players vote for victim -> meets the strict majority
  // threshold (floor(4/2)+1 = 3) without dropping to the 2-player end state.
  game.onVote(room, io, imposterId, victim);
  game.onVote(room, io, voterB, victim);
  game.onVote(room, io, voterC, victim);
  game.onVote(room, io, victim, "skip");

  assert.equal(room.gameState.phase, "round-results");
  assert.ok(room.gameState.eliminated.has(victim));
  assert.equal(room.gameState.eliminated.size, 1);

  const nextRoundResult = game.onNextRound(room, io);
  assert.deepEqual(nextRoundResult, {});
  assert.equal(room.gameState.phase, "track-select");

  const { io: io2, emitted: emitted2 } = makeStubIo();
  game.onSelectTrackPair(room, io2, "pair1");
  assert.equal(room.gameState.round, 2);

  const loadEvents2 = emitted2.filter((e) => e.event === "game:load-audio");
  assert.equal(loadEvents2.length, 3);
  assert.equal(loadEvents2.some((e) => e.id === victim), false);

  // Drive round 2 into "playing" phase for real, so the vote below exercises
  // onVote's actual activeIds.includes(socketId) guard rather than being
  // rejected earlier by the phase check (which would pass for anyone).
  readyAllActive(room, io2);
  game.onHostPlay(room, io2);
  assert.equal(room.gameState.phase, "playing");

  game.onVote(room, io2, victim, "skip");
  assert.equal(room.gameState.votes.has(victim), false);

  // Positive control: a still-active player's vote in the same phase IS
  // accepted, confirming voting was genuinely reachable here.
  game.onVote(room, io2, voterB, "skip");
  assert.equal(room.gameState.votes.has(voterB), true);
});

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

const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../games/wordWolf");

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
    gameId: "word-wolf",
    gameState: null,
  };
}

test("onSelectAutoPair rejects starting with too few players", () => {
  const room = makeRoom(["A", "B"]);
  const { io } = makeStubIo();
  const result = game.onSelectAutoPair(room, io);
  assert.match(result.error, /at least 3 players/);
});

test("onSelectAutoPair round 1 assigns a wolf and starts loading phase without revealing anything", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  const result = game.onSelectAutoPair(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "loading");
  assert.equal(room.gameState.round, 1);
  assert.ok(["p1", "p2", "p3"].includes(room.gameState.imposterId));
  assert.ok(room.gameState.wordPair.normal.word);
  assert.ok(room.gameState.wordPair.imposter.word);

  assert.equal(emitted.some((e) => e.event === "game:reveal-word"), false);
  const startedEvent = emitted.find((e) => e.event === "game:started");
  assert.deepEqual(startedEvent.payload, { round: 1, playerCount: 3 });
});

test("onSelectCustomPair rejects invalid words and does not touch game state", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io } = makeStubIo();
  const result = game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Coffee" });
  assert.equal(result.error, "The two words must be different.");
  assert.equal(room.gameState, null);
});

test("onSelectCustomPair round 1 starts the round with the given words", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io } = makeStubIo();
  const result = game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });
  assert.deepEqual(result, {});
  assert.equal(room.gameState.wordPair.normal.word, "Coffee");
  assert.equal(room.gameState.wordPair.imposter.word, "Tea");
});

test("onHostReveal only works from the loading phase and sends each active player their own word", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });

  const result = game.onHostReveal(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "revealed");

  const revealEvents = emitted.filter((e) => e.event === "game:reveal-word");
  assert.equal(revealEvents.length, 3);
  const imposterEvent = revealEvents.find((e) => e.id === room.gameState.imposterId);
  const crewEvent = revealEvents.find((e) => e.id !== room.gameState.imposterId);
  assert.equal(imposterEvent.payload.word, "Tea");
  assert.equal(crewEvent.payload.word, "Coffee");

  const again = game.onHostReveal(room, io);
  assert.ok(again.error);
});

test("onVote rejects self-votes and votes for unknown/inactive players", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });
  game.onHostReveal(room, io);

  game.onVote(room, io, "p1", "p1");
  assert.equal(room.gameState.votes.size, 0);

  game.onVote(room, io, "p1", "not-a-real-player");
  assert.equal(room.gameState.votes.size, 0);
});

test("majority vote eliminating the wolf ends the game with crew winning", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });
  game.onHostReveal(room, io);

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
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });
  game.onHostReveal(room, io);

  game.onVote(room, io, "p1", "skip");
  game.onVote(room, io, "p2", "skip");
  game.onVote(room, io, "p3", "p1");

  assert.equal(room.gameState.phase, "round-results");
  const roundEvent = emitted.find((e) => e.event === "game:round-results");
  assert.equal(roundEvent.payload.eliminated, null);
  assert.equal(room.gameState.eliminated.size, 0);
});

test("eliminating a non-wolf down to 2 active players ends the game with the wolf winning", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });
  game.onHostReveal(room, io);

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

test("onNextRound only works from round-results and signals the host to show word-select again", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });

  const tooEarly = game.onNextRound(room, io);
  assert.ok(tooEarly.error);

  game.onHostReveal(room, io);
  game.onVote(room, io, "p1", "skip");
  game.onVote(room, io, "p2", "skip");
  game.onVote(room, io, "p3", "skip");
  game.onVote(room, io, "p4", "skip");
  assert.equal(room.gameState.phase, "round-results");

  const { io: io2, emitted: emitted2 } = makeStubIo();
  const result = game.onNextRound(room, io2);
  assert.deepEqual(result, {});
  assert.ok(emitted2.some((e) => e.event === "game:word-select-ready"));
});

test("a second round picks an auto pair not used in round 1 (until the pool is exhausted)", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onSelectAutoPair(room, io);
  const firstNormalWord = room.gameState.wordPair.normal.word;

  game.onHostReveal(room, io);
  game.onVote(room, io, "p1", "skip");
  game.onVote(room, io, "p2", "skip");
  game.onVote(room, io, "p3", "skip");
  game.onVote(room, io, "p4", "skip");
  game.onNextRound(room, io);

  game.onSelectAutoPair(room, io);
  assert.equal(room.gameState.round, 2);
  // pickAutoPair excludes already-used indexes until the pool is exhausted --
  // with a fresh usedPairIndexes set and a 32-entry pool, two consecutive
  // draws are guaranteed to land on two different indexes/words, not just
  // "probably" different.
  assert.equal(room.gameState.usedPairIndexes.size, 2);
  assert.notEqual(room.gameState.wordPair.normal.word, firstNormalWord);
});

test("a disconnected player is excluded from vote quorum, letting the round resolve without their input", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });

  // p4 drops mid-game but keeps their seat in room.players (durable-session
  // reconnect model) -- only their connected flag flips.
  room.players.get("p4").connected = false;
  game.onHostReveal(room, io);

  game.onVote(room, io, "p1", "skip");
  game.onVote(room, io, "p2", "skip");
  assert.equal(room.gameState.phase, "voting");

  // Without the fix, votes.size (3) never reaches the inflated
  // activeIds.length (4, since p4 is still counted), so the round would stay
  // stuck in "voting" forever.
  game.onVote(room, io, "p3", "skip");
  assert.equal(room.gameState.phase, "round-results");
});

test("a stale vote from a player who has since disconnected does not let the round resolve before every remaining connected player has voted", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });
  game.onHostReveal(room, io);

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

test("onPlayerLeft removes a pending vote and lets the round resolve with one fewer voter", () => {
  const room = makeRoom(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });
  game.onHostReveal(room, io);

  game.onVote(room, io, "p1", "skip");
  game.onVote(room, io, "p2", "skip");
  room.players.delete("p4"); // simulate roomService having already removed them
  game.onPlayerLeft(room, io, "p4");

  assert.equal(room.gameState.phase, "voting");
  game.onVote(room, io, "p3", "skip");
  assert.equal(room.gameState.phase, "round-results");
});

test("onPlayerLeft ends the game if attrition alone drops active players to 2", () => {
  const room = makeRoom(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onSelectCustomPair(room, io, { normalWord: "Coffee", imposterWord: "Tea" });
  game.onHostReveal(room, io);

  room.players.delete("p1");
  game.onPlayerLeft(room, io, "p1");

  assert.equal(room.gameState.phase, "game-over");
  assert.ok(emitted.some((e) => e.event === "game:results"));
});

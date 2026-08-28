const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../games/xPeople");

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
  return { code: "TEST", hostId: "host1", state: "lobby", players, gameId: "x-people", gameState: null };
}

function setup(nicknames) {
  const room = makeRoom(nicknames);
  game.initGameState(room);
  return room;
}

test("initGameState creates prompt-select phase with default spice", () => {
  const room = setup(["A", "B", "C"]);
  assert.equal(room.gameState.phase, "prompt-select");
  assert.equal(room.gameState.promptState.maxSpice, 2);
});

test("onCustomPrompt starts a round and broadcasts playerCount", () => {
  const room = setup(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  const result = game.onCustomPrompt(room, io, "Have you ever muted this chat?");
  assert.deepEqual(result, {});
  const promptEvent = emitted.find((e) => e.event === "game:prompt");
  assert.equal(promptEvent.payload.playerCount, 3);
});

test("responses resolve automatically once every active player has answered", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test question");

  game.onSubmitResponse(room, io, "p1", true, 2);
  game.onSubmitResponse(room, io, "p2", false, 2);
  const { io: io2, emitted } = makeStubIo();
  game.onSubmitResponse(room, io2, "p3", true, 2);

  assert.equal(room.gameState.phase, "reveal");
  const reveal = emitted.find((e) => e.event === "game:count-reveal").payload;
  assert.equal(reveal.yesCount, 2);
});

test("scoring rewards exact predictions 100 and off-by-one 50, else 0", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test question");

  game.onSubmitResponse(room, io, "p1", true, 2); // exact (yesCount=2) -> 100
  game.onSubmitResponse(room, io, "p2", true, 1); // off by one -> 50
  const { io: io2, emitted } = makeStubIo();
  game.onSubmitResponse(room, io2, "p3", false, 3); // off by 1 (|3-2|=1) -> 50

  const gs = room.gameState;
  assert.equal(gs.scores.get("p1").score, 100);
  assert.equal(gs.scores.get("p2").score, 50);
  assert.equal(gs.scores.get("p3").score, 50);
  void emitted;
});

test("prediction is clamped to [0, playerCount]", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test question");
  game.onSubmitResponse(room, io, "p1", true, 999);
  assert.equal(room.gameState.responses.get("p1").prediction, 3);
  game.onSubmitResponse(room, io, "p2", true, -5);
  assert.equal(room.gameState.responses.get("p2").prediction, 0);
});

test("reveal payload never exposes individual answers", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test question");
  game.onSubmitResponse(room, io, "p1", true, 1);
  game.onSubmitResponse(room, io, "p2", false, 1);
  const { io: io2, emitted } = makeStubIo();
  game.onSubmitResponse(room, io2, "p3", true, 1);

  const reveal = emitted.find((e) => e.event === "game:count-reveal").payload;
  const serialized = JSON.stringify(reveal);
  assert.ok(!serialized.includes('"answer"'), "reveal payload must not leak per-player answers");
});

test("onForceAnswers requires at least 2 responses and resolves early", () => {
  const room = setup(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test question");
  const tooFew = game.onForceAnswers(room, io);
  assert.ok(tooFew.error);

  game.onSubmitResponse(room, io, "p1", true, 1);
  game.onSubmitResponse(room, io, "p2", false, 1);
  const { io: io2 } = makeStubIo();
  const result = game.onForceAnswers(room, io2);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "reveal");
});

test("onNextRound only valid from reveal; onEndGame reports winners", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test question");
  const tooEarly = game.onNextRound(room, io);
  assert.ok(tooEarly.error);

  room.gameState.phase = "reveal";
  const { io: io2, emitted } = makeStubIo();
  const result = game.onNextRound(room, io2);
  assert.deepEqual(result, {});
  assert.ok(emitted.some((e) => e.event === "game:prompt-select-ready"));

  const { io: io3, emitted: emitted3 } = makeStubIo();
  const end = game.onEndGame(room, io3);
  assert.deepEqual(end, {});
  const resultsEvent = emitted3.find((e) => e.event === "game:results");
  assert.ok(Array.isArray(resultsEvent.payload.winners));
});

test("onPlayerLeft during answering resolves once remaining players have all responded", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test question");
  game.onSubmitResponse(room, io, "p1", true, 1);
  room.players.delete("p3");
  const { io: io2, emitted } = makeStubIo();
  const result = game.onPlayerLeft(room, io2, "p3");
  assert.deepEqual(result, {});
  // p2 hasn't answered yet -- shouldn't resolve
  assert.equal(room.gameState.phase, "answering");
  void emitted;

  game.onSubmitResponse(room, io, "p2", true, 1);
  assert.equal(room.gameState.phase, "reveal");
});

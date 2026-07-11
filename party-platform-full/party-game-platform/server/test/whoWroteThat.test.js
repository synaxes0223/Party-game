const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../games/whoWroteThat");

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
  return { code: "TEST", hostSocketId: "host1", state: "lobby", players, gameId: meta_id(), gameState: null };
}
function meta_id() {
  return "who-wrote-that";
}

function setup(nicknames) {
  const room = makeRoom(nicknames);
  game.initGameState(room);
  return room;
}

test("initGameState creates a fresh prompt-select state", () => {
  const room = setup(["A", "B", "C"]);
  assert.equal(room.gameState.phase, "prompt-select");
  assert.equal(room.gameState.promptState.maxSpice, 2);
});

test("onDrawPrompt starts a round and broadcasts the prompt", () => {
  const room = setup(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  const result = game.onDrawPrompt(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "answering");
  assert.equal(room.gameState.round, 1);
  const promptEvent = emitted.find((e) => e.event === "game:prompt");
  assert.ok(promptEvent.payload.text);
});

test("onCustomPrompt validates and starts a round with the given text", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  const bad = game.onCustomPrompt(room, io, "   ");
  assert.ok(bad.error);
  const good = game.onCustomPrompt(room, io, "Your best CNY story");
  assert.deepEqual(good, {});
  assert.equal(room.gameState.currentPrompt.text, "Your best CNY story");
});

test("onPromptSubmitted queues a player prompt and reports the count to host", () => {
  const room = setup(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  const result = game.onPromptSubmitted(room, io, "p1", "My secret prompt");
  assert.deepEqual(result, {});
  assert.equal(room.gameState.promptState.queue.length, 1);
  assert.equal(room.gameState.promptState.queue[0].authorId, "p1");
  const countEvent = emitted.find((e) => e.event === "game:submission-count");
  assert.equal(countEvent.payload.count, 1);
});

test("onPromptSubmitted caps a single author at 5 pending prompts", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(game.onPromptSubmitted(room, io, "p1", `prompt ${i}`), {});
  }
  const sixth = game.onPromptSubmitted(room, io, "p1", "one too many");
  assert.ok(sixth.error);
});

test("onDrawPrompt drains a submitted prompt before the curated pack", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onPromptSubmitted(room, io, "p1", "queued prompt");
  game.onDrawPrompt(room, io);
  assert.equal(room.gameState.currentPrompt.text, "queued prompt");
  assert.equal(room.gameState.currentPrompt.source, "player");
});

test("full answer/guess/reveal cycle for one answer awards points correctly", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test prompt");

  game.onSubmitAnswer(room, io, "p1", "Answer from p1");
  game.onSubmitAnswer(room, io, "p2", "Answer from p2");
  const { io: io2 } = makeStubIo();
  const result = game.onSubmitAnswer(room, io2, "p3", "Answer from p3");
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "guessing");
  assert.equal(room.gameState.answers.length, 3);

  const gs = room.gameState;
  const authorId = gs.answers[0].playerId;
  const others = ["p1", "p2", "p3"].filter((id) => id !== authorId);

  const { io: io3, emitted: emitted3 } = makeStubIo();
  // author votes for someone else (camouflage), one guesser correct, one wrong
  game.onVoteAuthor(room, io3, authorId, others[0]);
  game.onVoteAuthor(room, io3, others[0], others[1]); // wrong guess
  game.onVoteAuthor(room, io3, others[1], authorId); // correct guess
  const reveal = emitted3.find((e) => e.event === "game:answer-reveal").payload;
  assert.equal(reveal.correctGuessers.length, 1);
  assert.equal(reveal.correctGuessers[0].id, others[1]);
  assert.equal(reveal.fooledCount, 1);
  assert.equal(reveal.authorBonus, 50);
  assert.equal(gs.scores.get(others[1]).score, 100);
  assert.equal(gs.scores.get(authorId).score, 50);
});

test("self-vote is rejected", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test");
  game.onSubmitAnswer(room, io, "p1", "a1");
  game.onSubmitAnswer(room, io, "p2", "a2");
  const { io: io2, emitted } = makeStubIo();
  game.onSubmitAnswer(room, io2, "p3", "a3");

  const { io: io3, emitted: emitted3 } = makeStubIo();
  game.onVoteAuthor(room, io3, "p1", "p1");
  assert.equal(room.gameState.votes.size, 0);
  assert.ok(emitted3.some((e) => e.event === "player:vote-rejected"));
  void emitted;
});

test("onForceAnswers requires at least 2 answers and advances to guessing", () => {
  const room = setup(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test");
  const tooFew = game.onForceAnswers(room, io);
  assert.ok(tooFew.error);

  game.onSubmitAnswer(room, io, "p1", "a1");
  game.onSubmitAnswer(room, io, "p2", "a2");
  const result = game.onForceAnswers(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "guessing");
  assert.equal(room.gameState.answers.length, 2);
});

test("onNextAnswer moves through answers then to round-results", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test");
  game.onSubmitAnswer(room, io, "p1", "a1");
  game.onSubmitAnswer(room, io, "p2", "a2");
  game.onSubmitAnswer(room, io, "p3", "a3");

  const gs = room.gameState;
  const currentAuthorId = gs.answers[0].playerId;
  const otherIds = ["p1", "p2", "p3"].filter((id) => id !== currentAuthorId);
  game.onVoteAuthor(room, io, currentAuthorId, otherIds[0]); // camouflage vote
  game.onVoteAuthor(room, io, otherIds[0], otherIds[1]); // wrong guess
  game.onVoteAuthor(room, io, otherIds[1], currentAuthorId); // correct guess
  assert.equal(gs.phase, "answer-reveal");

  const next1 = game.onNextAnswer(room, io);
  assert.deepEqual(next1, {});
  assert.equal(gs.phase, "guessing");
  assert.equal(gs.answerIndex, 1);
});

test("onNextRound only valid from round-results; onEndGame reports winners", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test");
  const tooEarly = game.onNextRound(room, io);
  assert.ok(tooEarly.error);

  room.gameState.phase = "round-results";
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

test("onPlayerLeft during answering advances once remaining players have all answered", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test");
  game.onSubmitAnswer(room, io, "p1", "a1");
  game.onSubmitAnswer(room, io, "p2", "a2");
  room.players.delete("p3");
  const result = game.onPlayerLeft(room, io, "p3");
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "guessing");
});

test("onPlayerLeft voids the current answer if the author disconnects mid-guessing", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onCustomPrompt(room, io, "Test");
  game.onSubmitAnswer(room, io, "p1", "a1");
  game.onSubmitAnswer(room, io, "p2", "a2");
  game.onSubmitAnswer(room, io, "p3", "a3");

  const authorId = room.gameState.answers[0].playerId;
  room.players.delete(authorId);
  const { io: io2, emitted } = makeStubIo();
  const result = game.onPlayerLeft(room, io2, authorId);
  assert.deepEqual(result, {});
  const reveal = emitted.find((e) => e.event === "game:answer-reveal");
  assert.equal(reveal.payload.voided, true);
});

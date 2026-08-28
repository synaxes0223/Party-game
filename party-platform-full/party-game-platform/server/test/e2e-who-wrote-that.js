// test/e2e-who-wrote-that.js
// Live integration check: runs the real server in-process and drives full
// Who Wrote That? games through socket.io-client (no mocks). Run with:
// node test/e2e-who-wrote-that.js

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

let tokenCounter = 0;
function nextToken() {
  return `e2e-wwt-token-${String(tokenCounter++).padStart(4, "0")}`;
}

async function createRoom() {
  const host = await connect();
  const hostToken = nextToken();
  const created = await new Promise((resolve) => {
    host.once("host:room-created", resolve);
    host.emit("host:create-room", { token: hostToken });
  });
  return { host, hostToken, roomCode: created.room.code };
}

async function joinPlayers(roomCode, names) {
  const players = [];
  for (const name of names) {
    const socket = await connect();
    const token = nextToken();
    await new Promise((resolve, reject) => {
      socket.once("player:joined", () => resolve());
      socket.once("player:join-error", (d) => reject(new Error(d.error)));
      socket.emit("player:join-room", { code: roomCode, nickname: name, token });
    });
    players.push({ name, socket, token });
  }
  return players;
}

async function selectGame(host, roomCode) {
  const sourcesPromise = once(host, "game:prompt-sources");
  host.emit("host:select-game", { code: roomCode, gameId: "who-wrote-that" });
  await sourcesPromise;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function playFullAnswerReveal(host, roomCode, players) {
  const promptPromises = players.map((p) => once(p.socket, "game:prompt"));
  const progressPromise = once(host, "game:answer-progress");
  host.emit("host:draw-prompt", { code: roomCode });
  await Promise.all(promptPromises);
  await progressPromise;

  const showAnswerPromise = once(host, "game:show-answer");
  players.forEach((p) => p.socket.emit("player:submit-answer", { code: roomCode, text: `Answer from ${p.name}` }));
  await showAnswerPromise;

  const revealPromise = once(host, "game:answer-reveal");
  const authorName = players[0].name; // shuffled order unknown, but voting works regardless of identity
  void authorName;
  const [a, b, c] = players;
  a.socket.emit("player:vote-author", { code: roomCode, votedForId: b.token });
  b.socket.emit("player:vote-author", { code: roomCode, votedForId: c.token });
  c.socket.emit("player:vote-author", { code: roomCode, votedForId: a.token });
  await revealPromise;
}

async function scenario1_promptSubmissionDrawnFirst() {
  console.log("\n[Scenario 1] Player-submitted prompt is drawn before the curated pack");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol"]);
  await selectGame(host, roomCode);

  const acceptedPromise = once(players[0].socket, "player:prompt-accepted");
  players[0].socket.emit("player:submit-prompt", { code: roomCode, text: "Custom submitted prompt" });
  await acceptedPromise;

  const promptPromise = once(host, "game:prompt");
  host.emit("host:draw-prompt", { code: roomCode });
  const promptEvent = await promptPromise;
  assertTrue(promptEvent.text === "Custom submitted prompt", "expected the submitted prompt to be drawn first");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario2_fullRoundAndScoring() {
  console.log("\n[Scenario 2] Full answer/guess/reveal loop across all answers, then round results and next round");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Dave", "Eve", "Frank"]);
  await selectGame(host, roomCode);

  const promptPromise = once(host, "game:prompt");
  host.emit("host:draw-prompt", { code: roomCode });
  await promptPromise;

  const showAnswerPromise = once(host, "game:show-answer");
  players.forEach((p) => p.socket.emit("player:submit-answer", { code: roomCode, text: `Answer ${p.name}` }));
  const shown1 = await showAnswerPromise;
  assertTrue(shown1.totalAnswers === 3, "expected 3 shuffled answers");

  const roundResultsPromise = once(host, "game:round-results");
  for (let i = 0; i < 3; i++) {
    const revealPromise = once(host, "game:answer-reveal");
    const showAnswerOrDonePromise = i < 2 ? once(host, "game:show-answer") : Promise.resolve(null);
    players[0].socket.emit("player:vote-author", { code: roomCode, votedForId: players[1].token });
    players[1].socket.emit("player:vote-author", { code: roomCode, votedForId: players[2].token });
    players[2].socket.emit("player:vote-author", { code: roomCode, votedForId: players[0].token });
    await revealPromise;
    host.emit("host:next-answer", { code: roomCode });
    await showAnswerOrDonePromise;
  }
  const roundResults = await roundResultsPromise;
  assertTrue(Array.isArray(roundResults.scores), "expected a scoreboard in round results");

  const readyPromise = once(host, "game:prompt-select-ready");
  host.emit("host:next-round", { code: roomCode });
  await readyPromise;

  const resultsPromise = once(host, "game:results");
  host.emit("host:end-game", { code: roomCode });
  const results = await resultsPromise;
  assertTrue(Array.isArray(results.winners), "expected winners in final results");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario3_selfVoteRejectedAndForceAnswers() {
  console.log("\n[Scenario 3] Self-vote rejected; host force-starts guessing with a missing answer");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Gil", "Hana", "Ivo"]);
  await selectGame(host, roomCode);

  const progressPromise = once(host, "game:answer-progress");
  host.emit("host:draw-prompt", { code: roomCode });
  await progressPromise;

  const showAnswerPromise = once(host, "game:show-answer");
  players[0].socket.emit("player:submit-answer", { code: roomCode, text: "a1" });
  players[1].socket.emit("player:submit-answer", { code: roomCode, text: "a2" });
  host.emit("host:force-answers", { code: roomCode });
  await showAnswerPromise;

  const rejectedPromise = once(players[0].socket, "player:vote-rejected");
  players[0].socket.emit("player:vote-author", { code: roomCode, votedForId: players[0].token });
  await rejectedPromise;
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((r) => setTimeout(r, 300));
  console.log(`Test server up on port ${PORT}`);

  try {
    await scenario1_promptSubmissionDrawnFirst();
    await scenario2_fullRoundAndScoring();
    await scenario3_selfVoteRejectedAndForceAnswers();

    console.log("\nALL WHO WROTE THAT E2E SCENARIOS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

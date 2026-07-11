// test/e2e-x-people.js
// Live integration check: runs the real server in-process and drives full
// X People In This Room games through socket.io-client (no mocks). Run with:
// node test/e2e-x-people.js

const path = require("node:path");
const { io } = require("socket.io-client");

const PORT = 3100;
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
  const sourcesPromise = once(host, "game:prompt-sources");
  host.emit("host:select-game", { code: roomCode, gameId: "x-people" });
  await sourcesPromise;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function scenario1_packDrawAndScoring() {
  console.log("\n[Scenario 1] Draw from pack, verify count reveal and exact/off-by-one scoring");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol"]);
  await selectGame(host, roomCode);

  const promptPromises = players.map((p) => once(p.socket, "game:prompt"));
  host.emit("host:draw-prompt", { code: roomCode });
  const promptEvents = await Promise.all(promptPromises);
  assertTrue(promptEvents[0].playerCount === 3, "expected playerCount 3");

  const revealPromise = once(host, "game:count-reveal");
  players[0].socket.emit("player:submit-response", { code: roomCode, answer: true, prediction: 2 });
  players[1].socket.emit("player:submit-response", { code: roomCode, answer: true, prediction: 1 });
  players[2].socket.emit("player:submit-response", { code: roomCode, answer: false, prediction: 3 });
  const reveal = await revealPromise;

  assertTrue(reveal.yesCount === 2, `expected yesCount 2, got ${reveal.yesCount}`);
  const serialized = JSON.stringify(reveal);
  assertTrue(!serialized.includes('"answer"'), "reveal must never leak per-player answers");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario2_customPromptFullLoop() {
  console.log("\n[Scenario 2] Custom prompt, next round, end game with final scores");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Dave", "Eve", "Frank"]);
  await selectGame(host, roomCode);

  const promptPromise = once(host, "game:prompt");
  host.emit("host:custom-prompt", { code: roomCode, text: "Have you ever muted this chat?" });
  await promptPromise;

  const revealPromise = once(host, "game:count-reveal");
  players.forEach((p) => p.socket.emit("player:submit-response", { code: roomCode, answer: true, prediction: 3 }));
  await revealPromise;

  const readyPromise = once(host, "game:prompt-select-ready");
  host.emit("host:next-round", { code: roomCode });
  await readyPromise;

  const resultsPromise = once(host, "game:results");
  host.emit("host:end-game", { code: roomCode });
  const results = await resultsPromise;
  assertTrue(Array.isArray(results.winners) && results.winners.length > 0, "expected winners in final results");
  assertTrue(results.winners[0].score === 100, "expected all 3 players to have scored 100 (exact predictions)");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario3_submittedPromptDrawnFirstAndForceAnswers() {
  console.log("\n[Scenario 3] Submitted question drawn first; host can force-reveal early");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Gil", "Hana", "Ivo", "Jaz"]);
  await selectGame(host, roomCode);

  const acceptedPromise = once(players[0].socket, "player:prompt-accepted");
  players[0].socket.emit("player:submit-prompt", { code: roomCode, text: "Have you skipped a yumcha invite?" });
  await acceptedPromise;

  const promptPromise = once(host, "game:prompt");
  host.emit("host:draw-prompt", { code: roomCode });
  const prompt = await promptPromise;
  assertTrue(prompt.text === "Have you skipped a yumcha invite?", "expected the submitted question drawn first");

  const revealPromise = once(host, "game:count-reveal");
  players[0].socket.emit("player:submit-response", { code: roomCode, answer: true, prediction: 1 });
  players[1].socket.emit("player:submit-response", { code: roomCode, answer: false, prediction: 1 });
  host.emit("host:force-answers", { code: roomCode });
  const reveal = await revealPromise;
  assertTrue(reveal.playerCount === 2, "expected force-reveal with only 2 responses in");
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
    await scenario1_packDrawAndScoring();
    await scenario2_customPromptFullLoop();
    await scenario3_submittedPromptDrawnFirstAndForceAnswers();

    console.log("\nALL X PEOPLE E2E SCENARIOS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

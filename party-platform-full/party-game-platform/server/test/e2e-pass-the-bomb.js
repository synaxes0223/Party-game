// test/e2e-pass-the-bomb.js
// Live integration check: runs the real server in-process and drives full
// Pass The Bomb games through socket.io-client (no mocks). Sets a short fuse
// via BOMB_FUSE_MS_RANGE so the run finishes in seconds instead of waiting
// the real 20-50s. Run with: node test/e2e-pass-the-bomb.js

const path = require("node:path");
const { io } = require("socket.io-client");

const PORT = 3101;
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
  return `e2e-ptb-token-${String(tokenCounter++).padStart(4, "0")}`;
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
  host.emit("host:select-game", { code: roomCode, gameId: "pass-the-bomb" });
  await sourcesPromise;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function scenario1_passThenExplode() {
  console.log("\n[Scenario 1] Pass the bomb a couple times, then let it explode on whoever's holding it");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol", "Dave"]);
  await selectGame(host, roomCode);

  const startedPromise = once(host, "game:bomb-started");
  host.emit("host:custom-prompt", { code: roomCode, text: "Milo variants" });
  const started = await startedPromise;
  assertTrue(started.ring.length === 4, "expected all 4 players in the ring");

  const byId = Object.fromEntries(players.map((p) => [p.token, p]));
  let holderId = started.holderId;

  // Pass twice, verifying only the true holder's pass is honored
  const notHolder = players.find((p) => p.token !== holderId);
  notHolder.socket.emit("player:pass-bomb", { code: roomCode });
  await new Promise((r) => setTimeout(r, 50)); // give the (ignored) event a moment to be processed

  const passedPromise = once(host, "game:bomb-passed");
  byId[holderId].socket.emit("player:pass-bomb", { code: roomCode });
  const passed = await passedPromise;
  assertTrue(passed.holderId !== holderId, "expected the bomb to move to a new holder");
  holderId = passed.holderId;

  const explodedPromise = once(host, "game:bomb-exploded");
  const exploded = await explodedPromise;
  assertTrue(exploded.holderId === holderId, "expected the explosion to hit whoever was holding it");
  assertTrue(exploded.booms.find((b) => b.id === holderId).count === 1, "expected exactly one boom recorded");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario2_nextRoundAndEndGame() {
  console.log("\n[Scenario 2] Next round after a boom, then end game with min-boom winners");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Eve", "Frank", "Gil"]);
  await selectGame(host, roomCode);

  host.emit("host:custom-prompt", { code: roomCode, text: "Pasar malam foods" });
  await once(host, "game:bomb-exploded");

  const readyPromise = once(host, "game:prompt-select-ready");
  host.emit("host:next-round", { code: roomCode });
  await readyPromise;

  const startedPromise = once(host, "game:bomb-started");
  host.emit("host:custom-prompt", { code: roomCode, text: "CNY snacks" });
  const started = await startedPromise;
  assertTrue(started.round === 2, "expected round 2");
  await once(host, "game:bomb-exploded");

  const resultsPromise = once(host, "game:results");
  host.emit("host:end-game", { code: roomCode });
  const results = await resultsPromise;
  assertTrue(Array.isArray(results.winners) && results.winners.length > 0, "expected winners in final results");
  assertTrue(Array.isArray(results.booms) && results.booms.length === 3, "expected a boom tally for all 3 players");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario3_disconnectingHolderStillTakesTheBoom() {
  console.log("\n[Scenario 3] A holder who drops mid-fuse keeps the bomb (token seats survive blips) and takes the boom");
  // With token-based sessions a disconnect no longer notifies the game -- a
  // brief phone-lock must not reshuffle the ring. The fuse keeps running, so
  // a holder who genuinely left simply takes the explosion when it expires.
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Hana", "Ivo", "Jaz"]);
  await selectGame(host, roomCode);

  const startedPromise = once(host, "game:bomb-started");
  host.emit("host:custom-prompt", { code: roomCode, text: "LRT stations" });
  const started = await startedPromise;

  const holder = players.find((p) => p.token === started.holderId);
  const explodedPromise = once(host, "game:bomb-exploded");
  holder.socket.close();
  const exploded = await explodedPromise;
  assertTrue(exploded.holderId === started.holderId, "expected the explosion to hit the holder who dropped");
  console.log("  PASS");

  host.close();
  players.filter((p) => p !== holder).forEach((p) => p.socket.close());
}

async function main() {
  process.env.PORT = String(PORT);
  process.env.BOMB_FUSE_MS_RANGE = "300,600";
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((r) => setTimeout(r, 300));
  console.log(`Test server up on port ${PORT}`);

  try {
    await scenario1_passThenExplode();
    await scenario2_nextRoundAndEndGame();
    await scenario3_disconnectingHolderStillTakesTheBoom();

    console.log("\nALL PASS THE BOMB E2E SCENARIOS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

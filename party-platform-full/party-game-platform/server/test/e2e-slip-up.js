// e2e-slip-up.js
// Full-stack Slip-Up scenario over real sockets: start a game, mark catches
// across different players, confirm no player's personalized broadcast ever
// contains their own current entry, confirm live score updates reach every
// client, end the game, and check the final ranking. Run with:
//   node test/e2e-slip-up.js

const path = require("path");
const { io: ioClient } = require("socket.io-client");

const PORT = 3097;
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

let tokenCounter = 0;
function nextToken() {
  return `e2e-slip-up-token-${tokenCounter++}`;
}

async function createRoom() {
  const host = await connect();
  const hostToken = nextToken();
  host.emit("host:create-room", { token: hostToken });
  const { room } = await once(host, "host:room-created");
  return { host, hostToken, roomCode: room.code };
}

async function joinPlayers(roomCode, names) {
  const players = [];
  for (const name of names) {
    const socket = await connect();
    const token = nextToken();
    socket.emit("player:join-room", { code: roomCode, nickname: name, token });
    await Promise.race([
      once(socket, "player:joined"),
      once(socket, "player:join-error").then((e) => Promise.reject(new Error(e.error))),
    ]);
    players.push({ name, socket, token });
  }
  return players;
}

async function scenarioFullGame() {
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol"]);

  host.emit("host:select-game", { code: roomCode, gameId: "slip-up" });
  const { entries } = await once(host, "game:entry-pool");
  assertTrue(entries.length >= 30, "entry pool should have at least 30 entries");

  const yourViewPromises = players.map((p) => once(p.socket, "game:your-view"));
  const refereeViewPromise = once(host, "game:referee-view");
  const scorePromise = once(host, "game:score-update");

  host.emit("host:start-game", { code: roomCode, excludedIds: [], customEntries: [] });

  const yourViews = await Promise.all(yourViewPromises);
  const refereeView = await refereeViewPromise;
  const startScore = await scorePromise;

  yourViews.forEach((view, i) => {
    assertTrue(view.others.length === 2, `${players[i].name} should see exactly 2 other entries`);
  });
  assertTrue(refereeView.players.length === 3, "referee view should list all 3 players");
  assertTrue(startScore.scores.every((s) => s.catchCount === 0), "all scores should start at 0");

  function assertNoSelfLeak(refView, viewsInOrder, label) {
    const entryById = new Map(refView.players.map((p) => [p.id, p.entry.id]));
    players.forEach((p, i) => {
      const myEntryId = entryById.get(p.token);
      const leaked = viewsInOrder[i].others.some((o) => o.id === p.token && o.entry.id === myEntryId);
      assertTrue(!leaked, `${p.name} should never see their own entry in their own view (${label})`);
    });
  }

  assertNoSelfLeak(refereeView, yourViews, "initial deal");

  // Catch player 0 (Alice); confirm reassignment doesn't leak, and that a
  // PLAYER socket (not just the host) receives the live score update.
  const target1 = players[0];
  const caught1Promise = once(target1.socket, "game:you-were-caught");
  const yourViewAfterCatch1Promises = players.map((p) => once(p.socket, "game:your-view"));
  const refereeAfterCatch1Promise = once(host, "game:referee-view");
  const hostScoreAfterCatch1Promise = once(host, "game:score-update");
  const playerScoreAfterCatch1Promise = once(players[1].socket, "game:score-update");
  host.emit("host:mark-caught", { code: roomCode, targetPlayerId: target1.token });
  await caught1Promise;
  const yourViewsAfterCatch1 = await Promise.all(yourViewAfterCatch1Promises);
  const refereeAfterCatch1 = await refereeAfterCatch1Promise;
  const hostScoreAfterCatch1 = await hostScoreAfterCatch1Promise;
  await playerScoreAfterCatch1Promise;

  assertNoSelfLeak(refereeAfterCatch1, yourViewsAfterCatch1, "after catching player 1");
  const target1Score = hostScoreAfterCatch1.scores.find((s) => s.id === target1.token);
  assertTrue(target1Score.catchCount === 1, "first caught player's score should be 1");

  // Catch a DIFFERENT player (Bob) to confirm catches are tracked
  // independently per player, not just for a single repeat offender.
  const target2 = players[1];
  const caught2Promise = once(target2.socket, "game:you-were-caught");
  const yourViewAfterCatch2Promises = players.map((p) => once(p.socket, "game:your-view"));
  const refereeAfterCatch2Promise = once(host, "game:referee-view");
  const hostScoreAfterCatch2Promise = once(host, "game:score-update");
  host.emit("host:mark-caught", { code: roomCode, targetPlayerId: target2.token });
  await caught2Promise;
  const yourViewsAfterCatch2 = await Promise.all(yourViewAfterCatch2Promises);
  const refereeAfterCatch2 = await refereeAfterCatch2Promise;
  const hostScoreAfterCatch2 = await hostScoreAfterCatch2Promise;

  assertNoSelfLeak(refereeAfterCatch2, yourViewsAfterCatch2, "after catching player 2");
  const target1ScoreFinal = hostScoreAfterCatch2.scores.find((s) => s.id === target1.token);
  const target2ScoreFinal = hostScoreAfterCatch2.scores.find((s) => s.id === target2.token);
  assertTrue(target1ScoreFinal.catchCount === 1, "player 1 should still have exactly 1 catch");
  assertTrue(target2ScoreFinal.catchCount === 1, "player 2 should have exactly 1 catch");

  const finalResultsPromises = [host, ...players.map((p) => p.socket)].map((s) => once(s, "game:final-results"));
  host.emit("host:end-game", { code: roomCode });
  const finalResultsAll = await Promise.all(finalResultsPromises);

  finalResultsAll.forEach(({ results }) => {
    assertTrue(results.length === 3, "final results should list all 3 players");
    const counts = results.map((r) => r.catchCount);
    const sorted = [...counts].sort((a, b) => a - b);
    assertTrue(JSON.stringify(counts) === JSON.stringify(sorted), "final results should be sorted ascending");
    const zeroCatchPlayer = results.find((r) => r.catchCount === 0);
    assertTrue(
      zeroCatchPlayer && zeroCatchPlayer.id === players[2].token,
      "the never-caught player should have 0 catches"
    );
  });

  host.close();
  players.forEach((p) => p.socket.close());
  console.log("scenarioFullGame passed");
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    await scenarioFullGame();
    console.log("All Slip-Up E2E scenarios passed.");
    process.exit(0);
  } catch (err) {
    console.error("Slip-Up E2E FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

// test/e2e-secret-missions.js
// Live integration check: runs the real server in-process and drives a full
// Secret Mission Bingo night through socket.io-client (no mocks), including
// the reconnect path (disconnect + rejoin by nickname) that this game
// requires. Run with: node test/e2e-secret-missions.js

const path = require("node:path");
const { io } = require("socket.io-client");

const PORT = 3102;
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
  host.emit("host:select-game", { code: roomCode, gameId: "secret-missions" });
  await sourcesPromise;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function scenario1_startClaimAccuseAndReveal() {
  console.log("\n[Scenario 1] Start the night, claim a mission, hit an accusation, miss an accusation, end game");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol"]);
  await selectGame(host, roomCode);

  const yourMissionsPromises = players.map((p) => once(p.socket, "game:your-missions"));
  const boardPromise = once(host, "game:mission-board");
  host.emit("host:start-missions", { code: roomCode });
  const [aliceMissions, bobMissions, carolMissions] = await Promise.all(yourMissionsPromises);
  const board = await boardPromise;
  assertTrue(board.missions.length === 9, "expected 9 missions on the public board");
  assertTrue(!JSON.stringify(board.missions).includes("ownerId"), "public board must never expose ownerId");
  assertTrue(aliceMissions.missions.length === 3, "expected Alice to have 3 missions");

  // Alice claims her first mission
  const boardAfterClaimPromise = once(host, "game:mission-board");
  players[0].socket.emit("player:claim-mission", { code: roomCode, missionId: aliceMissions.missions[0].id });
  const boardAfterClaim = await boardAfterClaimPromise;
  const claimedEntry = boardAfterClaim.missions.find((m) => m.id === aliceMissions.missions[0].id);
  assertTrue(claimedEntry.status === "claimed", "expected the claimed mission to show status claimed");

  // Bob accuses Carol of owning one of Bob's own missions (guaranteed miss)
  const accusationPromise = once(host, "game:accusation-result");
  players[1].socket.emit("player:accuse", {
    code: roomCode,
    targetPlayerId: players[2].socket.id,
    missionId: bobMissions.missions[0].id,
  });
  const missResult = await accusationPromise;
  assertTrue(missResult.hit === false, "expected this accusation to miss");

  // Bob accuses Carol correctly this time (Carol is the real owner of carolMissions[0])
  const hitPromise = once(host, "game:accusation-result");
  players[1].socket.emit("player:accuse", {
    code: roomCode,
    targetPlayerId: players[2].socket.id,
    missionId: carolMissions.missions[0].id,
  });
  const hitResult = await hitPromise;
  assertTrue(hitResult.hit === true, "expected this accusation to hit");

  const resultsPromise = once(host, "game:results");
  host.emit("host:end-game", { code: roomCode });
  const results = await resultsPromise;
  assertTrue(results.reveal.length === 9, "expected the full reveal to list all 9 missions");
  assertTrue(results.reveal.every((m) => m.ownerNickname), "expected every revealed mission to have an owner nickname");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario2_disconnectAndRejoinSurvivesState() {
  console.log("\n[Scenario 2] A player's phone locks (disconnect) then reconnects by nickname -- state survives");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Dave", "Eve", "Frank"]);
  await selectGame(host, roomCode);

  const yourMissionsPromises = players.map((p) => once(p.socket, "game:your-missions"));
  host.emit("host:start-missions", { code: roomCode });
  const [daveMissions] = await Promise.all(yourMissionsPromises);

  // Dave claims one mission before disconnecting, so we can verify it
  // survives. Wait for Dave's OWN game:your-missions echo (not the host's
  // game:mission-board) -- that's the unambiguous confirmation the claim
  // round-trip actually completed server-side before we close his socket.
  const claimConfirmedPromise = once(players[0].socket, "game:your-missions");
  players[0].socket.emit("player:claim-mission", { code: roomCode, missionId: daveMissions.missions[0].id });
  await claimConfirmedPromise;

  const roomUpdatedPromise = once(host, "host:room-updated");
  players[0].socket.close();
  const roomUpdated = await roomUpdatedPromise;
  const daveEntry = roomUpdated.room.players.find((p) => p.nickname === "Dave");
  assertTrue(daveEntry.connected === false, "expected Dave to show as disconnected, not removed");

  // Dave rejoins with the same nickname on a new socket
  const newDaveSocket = await connect();
  const yourMissionsAfterRejoinPromise = once(newDaveSocket, "game:your-missions");
  await new Promise((resolve, reject) => {
    newDaveSocket.once("player:joined", () => resolve());
    newDaveSocket.once("player:join-error", (d) => reject(new Error(d.error)));
    newDaveSocket.emit("player:join-room", { code: roomCode, nickname: "dave" }); // case-insensitive
  });
  const missionsAfterRejoin = await yourMissionsAfterRejoinPromise;
  assertTrue(missionsAfterRejoin.missions.length === 3, "expected Dave's 3 missions to still be his after reconnect");
  const stillClaimed = missionsAfterRejoin.missions.find((m) => m.id === daveMissions.missions[0].id);
  assertTrue(stillClaimed.status === "claimed", "expected Dave's claimed mission to survive the reconnect");

  // A random unrecognized nickname must still be rejected mid-game
  const strangerSocket = await connect();
  const rejectPromise = new Promise((resolve) => strangerSocket.once("player:join-error", resolve));
  strangerSocket.emit("player:join-room", { code: roomCode, nickname: "TotallyNewPerson" });
  const rejectResult = await rejectPromise;
  assertTrue(!!rejectResult.error, "expected an unrecognized nickname to still be rejected mid-game");

  console.log("  PASS");

  host.close();
  newDaveSocket.close();
  strangerSocket.close();
  players.slice(1).forEach((p) => p.socket.close());
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((r) => setTimeout(r, 300));
  console.log(`Test server up on port ${PORT}`);

  try {
    await scenario1_startClaimAccuseAndReveal();
    await scenario2_disconnectAndRejoinSurvivesState();

    console.log("\nALL SECRET MISSION BINGO E2E SCENARIOS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

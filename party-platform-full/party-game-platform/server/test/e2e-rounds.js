// test/e2e-rounds.js
// Live integration check: runs the real server in-process and drives full
// games through socket.io-client (no mocks), covering every scenario in the
// spec's testing plan. Run with: node test/e2e-rounds.js

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

// Selects the pair for this round, waits for every active player to load
// audio and confirm ready, and waits for the host's "all ready" signal.
async function startRoundAndGetReady(host, roomCode, activePlayers) {
  const loadPromises = activePlayers.map((p) => once(p.socket, "game:load-audio"));
  const allReadyPromise = once(host, "game:all-ready");

  host.emit("host:select-track-pair", { code: roomCode, pairId: "pair1" });

  const loadResults = await Promise.all(loadPromises);
  const audioByName = {};
  activePlayers.forEach((p, i) => {
    audioByName[p.name] = loadResults[i].audioUrl;
    p.socket.emit("player:audio-ready", { code: roomCode });
  });

  await allReadyPromise;
  return audioByName;
}

async function playSyncedAudio(host, roomCode, activePlayers) {
  const playAtPromises = activePlayers.map((p) => once(p.socket, "game:play-at"));
  host.emit("host:play-audio", { code: roomCode });
  await Promise.all(playAtPromises);
}

async function nextRound(host, roomCode) {
  const pairsPromise = once(host, "game:track-pairs");
  host.emit("host:next-round", { code: roomCode });
  await pairsPromise;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function scenario1(host, roomCode, players) {
  console.log("\n[Scenario 1] 4 players, round 1 split vote -> no majority, game continues");
  await startRoundAndGetReady(host, roomCode, players);
  await playSyncedAudio(host, roomCode, players);

  const roundResultsPromise = once(host, "game:round-results");
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: players[1].socket.id });
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: players[2].socket.id });
  players[2].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[3].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  const roundResult = await roundResultsPromise;

  assertTrue(roundResult.eliminated === null, "expected no elimination on a split vote");
  assertTrue(roundResult.remainingActive === 4, "expected all 4 players still active");
  console.log("  PASS");
}

// Returns { ended, winner, remaining } — ended is true if this round's
// majority vote happened to catch the imposter and finish the game.
async function scenario2_eliminateOneRound(host, roomCode, players) {
  console.log("\n[Scenario 2] round 2 votes out a non-imposter (3/4 majority)");
  await nextRound(host, roomCode);
  await startRoundAndGetReady(host, roomCode, players);
  await playSyncedAudio(host, roomCode, players);

  const target = players[0];
  const roundResultsPromise = once(host, "game:round-results");
  const resultsPromise = once(host, "game:results").catch(() => null);
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: target.socket.id });
  players[2].socket.emit("player:vote", { code: roomCode, votedForId: target.socket.id });
  players[3].socket.emit("player:vote", { code: roomCode, votedForId: target.socket.id });
  target.socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  const roundResult = await roundResultsPromise;

  assertTrue(roundResult.eliminated !== null, "expected an elimination on a 3/4 majority");
  assertTrue(roundResult.eliminated.id === target.socket.id, "expected the targeted player to be eliminated");
  assertTrue(roundResult.remainingActive === 3, "expected 3 active players remaining");
  console.log(`  PASS — ${target.name} eliminated, 3 players remain`);

  if (roundResult.wasImposter) {
    const finalResults = await resultsPromise;
    console.log("  (targeted player happened to be the imposter — game ended here)");
    return { ended: true, winner: finalResults.winner, eliminatedPlayer: target };
  }
  return { ended: false, remaining: players.filter((p) => p.socket.id !== target.socket.id), eliminatedPlayer: target };
}

async function scenario3_reachTwoPlayers(host, roomCode, remaining, eliminatedPlayer) {
  console.log("\n[Scenario 3] round 3 down to 3 active players, next elimination reaches 2 -> auto-end");

  // Confirm the round-2-eliminated player gets no audio and can't vote here.
  let eliminatedGotAudio = false;
  eliminatedPlayer.socket.once("game:load-audio", () => {
    eliminatedGotAudio = true;
  });

  await nextRound(host, roomCode);
  const audioByName = await startRoundAndGetReady(host, roomCode, remaining);
  assertTrue(!eliminatedGotAudio, "eliminated player should not receive audio in a later round");

  await playSyncedAudio(host, roomCode, remaining);

  // The imposter is randomly assigned among the 3 remaining players — target
  // a non-imposter for elimination so this round exercises the "auto-end at
  // 2 active players" path rather than accidentally catching the imposter
  // (which would end the game via the crew-win path instead, already
  // covered by Scenario 2's contingency and Scenario 4).
  const imposterInRound = remaining.find((p) => audioByName[p.name] === "/audio/imposter-song1.mp3");
  const [victim, survivor] = remaining.filter((p) => p !== imposterInRound);

  const resultsPromise = once(host, "game:results");
  imposterInRound.socket.emit("player:vote", { code: roomCode, votedForId: victim.socket.id });
  survivor.socket.emit("player:vote", { code: roomCode, votedForId: victim.socket.id });
  victim.socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  eliminatedPlayer.socket.emit("player:vote", { code: roomCode, votedForId: victim.socket.id }); // ignored
  const finalResults = await resultsPromise;

  assertTrue(finalResults.winner === "imposter", "expected the imposter to win once down to 2 active players");
  console.log("  PASS — game auto-ended at 2 active players, imposter won");
}

async function scenario4_imposterCaughtImmediately() {
  console.log("\n[Scenario 4] imposter voted out directly in round 1 -> immediate crew win");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Eve", "Frank", "Grace"]);
  await selectGame(host, roomCode);

  const audioByName = await startRoundAndGetReady(host, roomCode, players);
  const imposterPlayer = players.find((p) => audioByName[p.name] === "/audio/imposter-song1.mp3");
  await playSyncedAudio(host, roomCode, players);

  const resultsPromise = once(host, "game:results");
  const others = players.filter((p) => p !== imposterPlayer);
  others[0].socket.emit("player:vote", { code: roomCode, votedForId: imposterPlayer.socket.id });
  others[1].socket.emit("player:vote", { code: roomCode, votedForId: imposterPlayer.socket.id });
  imposterPlayer.socket.emit("player:vote", { code: roomCode, votedForId: others[0].socket.id });
  const finalResults = await resultsPromise;

  assertTrue(finalResults.winner === "crew", "expected crew to win when the imposter is caught round 1");
  assertTrue(finalResults.imposter.id === imposterPlayer.socket.id, "expected the revealed imposter to match");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario5_playbackControls() {
  console.log("\n[Scenario 5] host Play -> Pause -> Resume -> Restart controls");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Ivy", "Jack", "Kim"]);
  await selectGame(host, roomCode);
  await startRoundAndGetReady(host, roomCode, players);

  const firstPlayAt = await new Promise((resolve) => {
    players[0].socket.once("game:play-at", resolve);
    host.emit("host:play-audio", { code: roomCode });
  });
  assertTrue(firstPlayAt.position === 0, "expected Play to start from position 0");

  // Wait past the synced start (SYNC_BUFFER_MS) plus a margin so real
  // playback has actually begun before pausing — pausing immediately after
  // Play (same tick) legitimately yields an elapsed position of 0, which
  // would make the "Resume continues from non-zero" assertion below flaky.
  await new Promise((r) => setTimeout(r, 1700));

  const pauseEvent = await new Promise((resolve) => {
    players[0].socket.once("game:pause-at", resolve);
    host.emit("host:pause-audio", { code: roomCode });
  });
  assertTrue(typeof pauseEvent.pauseAt === "number", "expected a numeric pause timestamp");

  const resumePlayAt = await new Promise((resolve) => {
    players[0].socket.once("game:play-at", resolve);
    host.emit("host:resume-audio", { code: roomCode });
  });
  assertTrue(resumePlayAt.position > 0, "expected Resume to continue from a non-zero position");

  const restartPlayAt = await new Promise((resolve) => {
    players[0].socket.once("game:play-at", resolve);
    host.emit("host:restart-audio", { code: roomCode });
  });
  assertTrue(restartPlayAt.position === 0, "expected Restart to go back to position 0");

  console.log("  PASS");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario6_selfVoteRejected() {
  console.log("\n[Scenario 6] self-votes are rejected server-side");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Liam", "Mona", "Noah"]);
  await selectGame(host, roomCode);
  await startRoundAndGetReady(host, roomCode, players);
  await playSyncedAudio(host, roomCode, players);

  const progressPromise = once(host, "game:vote-progress");
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: players[0].socket.id });
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: players[2].socket.id });
  const progress = await progressPromise;

  assertTrue(progress.voted === 1, "expected the self-vote to be ignored, leaving only 1 valid vote");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario7_disconnectDuringVoting() {
  console.log("\n[Scenario 7] a player disconnecting mid-vote doesn't block round resolution");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Omar", "Priya", "Quinn", "Rosa"]);
  await selectGame(host, roomCode);
  await startRoundAndGetReady(host, roomCode, players);
  await playSyncedAudio(host, roomCode, players);

  const roomUpdatedPromise = once(host, "host:room-updated");
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[3].socket.close(); // Rosa drops before voting
  await roomUpdatedPromise; // wait for the server to finish processing the disconnect

  const roundResultsPromise = once(host, "game:round-results");
  players[2].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  const roundResult = await roundResultsPromise;

  assertTrue(roundResult.remainingActive === 3, "expected 3 active players after the disconnect");
  console.log("  PASS — round resolved among the 3 remaining active players");

  host.close();
  players.slice(0, 3).forEach((p) => p.socket.close());
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((r) => setTimeout(r, 300));
  console.log(`Test server up on port ${PORT}`);

  try {
    const { host, roomCode } = await createRoom();
    const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol", "Dave"]);
    await selectGame(host, roomCode);

    await scenario1(host, roomCode, players);
    const step2 = await scenario2_eliminateOneRound(host, roomCode, players);
    if (!step2.ended) {
      await scenario3_reachTwoPlayers(host, roomCode, step2.remaining, step2.eliminatedPlayer);
    }
    host.close();
    players.forEach((p) => p.socket.close());

    await scenario4_imposterCaughtImmediately();
    await scenario5_playbackControls();
    await scenario6_selfVoteRejected();
    await scenario7_disconnectDuringVoting();

    console.log("\nALL E2E SCENARIOS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

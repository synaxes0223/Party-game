// test/e2e-word-wolf.js
// Live integration check: runs the real server in-process and drives full
// Word Wolf games through socket.io-client (no mocks). Run with:
// node test/e2e-word-wolf.js

const path = require("node:path");
const { io } = require("socket.io-client");

const PORT = 3098;
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
  const startedPromise = once(host, "game:started").catch(() => null);
  host.emit("host:select-game", { code: roomCode, gameId: "word-wolf" });
  // No game:track-pairs-equivalent fires here for Word Wolf -- just give the
  // server a moment to process the selection before the caller proceeds.
  await new Promise((r) => setTimeout(r, 50));
  void startedPromise;
}

async function revealAndCollectWords(host, roomCode, activePlayers) {
  const wordPromises = activePlayers.map((p) => once(p.socket, "game:reveal-word"));
  host.emit("host:reveal-words", { code: roomCode });
  const wordResults = await Promise.all(wordPromises);
  const wordByName = {};
  activePlayers.forEach((p, i) => (wordByName[p.name] = wordResults[i].word));
  return wordByName;
}

async function nextRound(host, roomCode) {
  const readyPromise = once(host, "game:word-select-ready");
  host.emit("host:next-round", { code: roomCode });
  await readyPromise;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function scenario1_autoPairAndSplitVote() {
  console.log("\n[Scenario 1] Auto pair, 4 players, round 1 split vote -> no majority, game continues");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol", "Dave"]);
  await selectGame(host, roomCode);

  const startedPromise = once(host, "game:started");
  host.emit("host:select-auto-pair", { code: roomCode });
  const started = await startedPromise;
  assertTrue(started.round === 1 && started.playerCount === 4, "expected round 1 with 4 players");

  const wordByName = await revealAndCollectWords(host, roomCode, players);
  const distinctWords = new Set(Object.values(wordByName));
  assertTrue(distinctWords.size === 2, "expected exactly one player to have a different word");

  const roundResultsPromise = once(host, "game:round-results");
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: players[1].socket.id });
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: players[2].socket.id });
  players[2].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[3].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  const roundResult = await roundResultsPromise;

  assertTrue(roundResult.eliminated === null, "expected no elimination on a split vote");
  assertTrue(roundResult.remainingActive === 4, "expected all 4 players still active");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario2_customPairImmediateCatch() {
  console.log("\n[Scenario 2] Custom pair, wolf voted out directly in round 1 -> immediate crew win");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Eve", "Frank", "Grace"]);
  await selectGame(host, roomCode);

  host.emit("host:select-custom-pair", { code: roomCode, normalWord: "Coffee", imposterWord: "Tea" });
  await once(host, "game:started");

  const wordByName = await revealAndCollectWords(host, roomCode, players);
  const wolfPlayer = players.find((p) => wordByName[p.name] === "Tea");
  assertTrue(!!wolfPlayer, "expected exactly one player to receive the custom wolf word");

  const resultsPromise = once(host, "game:results");
  const others = players.filter((p) => p !== wolfPlayer);
  others[0].socket.emit("player:vote", { code: roomCode, votedForId: wolfPlayer.socket.id });
  others[1].socket.emit("player:vote", { code: roomCode, votedForId: wolfPlayer.socket.id });
  wolfPlayer.socket.emit("player:vote", { code: roomCode, votedForId: others[0].socket.id });
  const finalResults = await resultsPromise;

  assertTrue(finalResults.winner === "crew", "expected crew to win when the wolf is caught round 1");
  assertTrue(finalResults.imposter.id === wolfPlayer.socket.id, "expected the revealed wolf to match");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario3_downToTwoPlayers() {
  console.log("\n[Scenario 3] Eliminating a non-wolf down to 2 active players ends the game with the wolf winning");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Ivy", "Jack", "Kim"]);
  await selectGame(host, roomCode);

  host.emit("host:select-custom-pair", { code: roomCode, normalWord: "Beach", imposterWord: "Desert" });
  await once(host, "game:started");
  const wordByName = await revealAndCollectWords(host, roomCode, players);
  const wolfPlayer = players.find((p) => wordByName[p.name] === "Desert");
  const nonWolves = players.filter((p) => p !== wolfPlayer);
  const [victim, voterA] = nonWolves;

  const resultsPromise = once(host, "game:results");
  voterA.socket.emit("player:vote", { code: roomCode, votedForId: victim.socket.id });
  wolfPlayer.socket.emit("player:vote", { code: roomCode, votedForId: victim.socket.id });
  victim.socket.emit("player:vote", { code: roomCode, votedForId: voterA.socket.id });
  const finalResults = await resultsPromise;

  assertTrue(finalResults.winner === "imposter", "expected the wolf to win once down to 2 active players");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario4_selfVoteRejectedAndNextRound() {
  console.log("\n[Scenario 4] Self-votes rejected; skip-majority round continues; next round re-picks a pair");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Liam", "Mona", "Noah", "Omar"]);
  await selectGame(host, roomCode);

  host.emit("host:select-auto-pair", { code: roomCode });
  await once(host, "game:started");
  await revealAndCollectWords(host, roomCode, players);

  const progressPromise = once(host, "game:vote-progress");
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: players[0].socket.id });
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: players[2].socket.id });
  const progress = await progressPromise;
  assertTrue(progress.voted === 1, "expected the self-vote to be ignored, leaving only 1 valid vote");

  const roundResultsPromise = once(host, "game:round-results");
  // players[0]'s self-vote above was rejected and never counted, so it must
  // be resubmitted here (as a valid skip) or the round's vote count would
  // permanently sit at 3/4 and game:round-results would never fire.
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[2].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[3].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  await roundResultsPromise;

  await nextRound(host, roomCode);
  const startedPromise = once(host, "game:started");
  host.emit("host:select-auto-pair", { code: roomCode });
  const started = await startedPromise;
  assertTrue(started.round === 2, "expected round 2 after next-round + auto-pair");
  console.log("  PASS");

  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario5_disconnectDuringVoting() {
  console.log("\n[Scenario 5] A player disconnecting mid-vote doesn't block round resolution");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Priya", "Quinn", "Rosa", "Sam"]);
  await selectGame(host, roomCode);

  host.emit("host:select-custom-pair", { code: roomCode, normalWord: "Ocean", imposterWord: "Lake" });
  await once(host, "game:started");
  await revealAndCollectWords(host, roomCode, players);

  const roomUpdatedPromise = once(host, "host:room-updated");
  players[0].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[1].socket.emit("player:vote", { code: roomCode, votedForId: "skip" });
  players[3].socket.close(); // Sam drops before voting
  await roomUpdatedPromise;

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
    await scenario1_autoPairAndSplitVote();
    await scenario2_customPairImmediateCatch();
    await scenario3_downToTwoPlayers();
    await scenario4_selfVoteRejectedAndNextRound();
    await scenario5_disconnectDuringVoting();

    console.log("\nALL WORD WOLF E2E SCENARIOS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

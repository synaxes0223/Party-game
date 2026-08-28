// e2e-avalon.js
// Full-stack Avalon scenarios over real sockets: a Good win by completing 3
// quests with the Assassin guessing wrong, an Evil win via 3 failed quests,
// an Evil win via 5 straight rejected team proposals, and an Evil win via a
// correct Assassin guess. Run with:
//   node test/e2e-avalon.js

const path = require("path");
const { io: ioClient } = require("socket.io-client");

const PORT = 3101;
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
  return `e2e-avalon-token-${tokenCounter++}`;
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

async function startAvalon(host, roomCode, players) {
  host.emit("host:select-game", { code: roomCode, gameId: "avalon" });

  const rolePromises = players.map((p) => once(p.socket, "game:avalon-role"));
  const statePromise = once(host, "game:avalon-state");
  host.emit("host:avalon-start", { code: roomCode });
  const roles = await Promise.all(rolePromises);
  const initialState = await statePromise;
  assertTrue(initialState.phase === "role-reveal", "should start in role-reveal");

  players.forEach((p, i) => (p.role = roles[i]));
  return initialState;
}

function findByRole(players, roleName) {
  return players.find((p) => p.role.role === roleName);
}

function isEvil(role) {
  return role === "assassin" || role === "morgana" || role === "minion";
}

async function beginQuests(host, roomCode) {
  const statePromise = once(host, "game:avalon-state");
  host.emit("host:avalon-begin", { code: roomCode });
  const state = await statePromise;
  assertTrue(state.phase === "team-proposal", "should move to team-proposal");
  return state;
}

function pickTeamWithEvil(players, teamSize) {
  // Roles are shuffled independent of join order, so "the first N players"
  // could easily be all-Good by chance — scenarios that need a guaranteed
  // fail vote must deliberately include at least one Evil player.
  const evilPlayers = players.filter((p) => isEvil(p.role.role));
  const goodPlayers = players.filter((p) => !isEvil(p.role.role));
  return [...evilPlayers, ...goodPlayers].slice(0, teamSize).map((p) => p.token);
}

async function proposeAndApproveTeam(host, roomCode, players, state, teamSize, teamIdsOverride) {
  const leader = players.find((p) => p.token === state.leaderId);
  const teamIds = teamIdsOverride || players.slice(0, teamSize).map((p) => p.token);

  const voteResultPromise = once(host, "game:avalon-team-vote-result");
  const nextStatePromise = once(host, "game:avalon-state");
  leader.socket.emit("player:avalon-propose-team", { code: roomCode, teamPlayerIds: teamIds });
  const proposalState = await nextStatePromise;
  assertTrue(proposalState.phase === "team-vote", "should move to team-vote");

  players.forEach((p) => p.socket.emit("player:avalon-team-vote", { code: roomCode, approve: true }));
  const voteResult = await voteResultPromise;
  assertTrue(voteResult.approved === true, "unanimous approval should approve the team");

  return teamIds;
}

async function runQuest(host, roomCode, players, teamIds, allSuccess) {
  const questResultPromise = once(host, "game:avalon-quest-result");
  const nextStatePromise = once(host, "game:avalon-state");
  teamIds.forEach((id) => {
    const player = players.find((p) => p.token === id);
    const success = allSuccess || !isEvil(player.role.role);
    player.socket.emit("player:avalon-quest-vote", { code: roomCode, success });
  });
  const questResult = await questResultPromise;
  const state = await nextStatePromise;
  return { questResult, state };
}

async function scenarioGoodWinsAssassinWrong() {
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol", "Dave", "Eve"]);
  await startAvalon(host, roomCode, players);
  let state = await beginQuests(host, roomCode);

  for (let q = 0; q < 3; q++) {
    const teamSize = state.teamSize;
    const teamIds = await proposeAndApproveTeam(host, roomCode, players, state, teamSize);
    const { questResult, state: afterQuestState } = await runQuest(host, roomCode, players, teamIds, true);
    assertTrue(questResult.outcome === "success", `quest ${q + 1} should succeed`);
    state = afterQuestState;

    if (state.phase === "quest-result") {
      const nextStatePromise = once(host, "game:avalon-state");
      host.emit("host:next-round", { code: roomCode });
      state = await nextStatePromise;
    }
  }

  assertTrue(state.phase === "assassin", "3 successes should move to the assassin phase");
  const assassin = players.find((p) => p.token === state.assassinId);
  const nonMerlin = players.find((p) => p.role.role !== "merlin" && p.token !== assassin.token);

  const resultsPromises = [host, ...players.map((p) => p.socket)].map((s) => once(s, "game:avalon-results"));
  assassin.socket.emit("player:avalon-assassin-guess", { code: roomCode, targetId: nonMerlin.token });
  const allResults = await Promise.all(resultsPromises);
  allResults.forEach(({ winner }) => assertTrue(winner === "good", "Good should win when the Assassin guesses wrong"));

  host.close();
  players.forEach((p) => p.socket.close());
  console.log("scenarioGoodWinsAssassinWrong passed");
}

async function scenarioEvilWinsThreeFails() {
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol", "Dave", "Eve"]);
  await startAvalon(host, roomCode, players);
  let state = await beginQuests(host, roomCode);

  for (let q = 0; q < 3; q++) {
    const teamSize = state.teamSize;
    const forcedTeamIds = pickTeamWithEvil(players, teamSize);
    const teamIds = await proposeAndApproveTeam(host, roomCode, players, state, teamSize, forcedTeamIds);
    const { questResult, state: afterQuestState } = await runQuest(host, roomCode, players, teamIds, false);
    assertTrue(questResult.outcome === "fail", `quest ${q + 1} should fail (an evil teammate is always included)`);
    state = afterQuestState;

    if (state.phase === "quest-result") {
      const nextStatePromise = once(host, "game:avalon-state");
      host.emit("host:next-round", { code: roomCode });
      state = await nextStatePromise;
    }
  }

  assertTrue(state.phase === "game-over", "3 failed quests should end the game");
  assertTrue(state.winner === "evil", "Evil should win on 3 failed quests");

  host.close();
  players.forEach((p) => p.socket.close());
  console.log("scenarioEvilWinsThreeFails passed");
}

async function scenarioEvilWinsFiveRejections() {
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol", "Dave", "Eve"]);
  await startAvalon(host, roomCode, players);
  let state = await beginQuests(host, roomCode);

  for (let i = 0; i < 5; i++) {
    const leader = players.find((p) => p.token === state.leaderId);
    const teamIds = players.slice(0, state.teamSize).map((p) => p.token);

    // Wait for the team-vote-open state fully BEFORE registering the next
    // pair of listeners — registering both `.once()` calls up front would
    // have them both resolve off this same team-vote-open emission instead
    // of the later post-vote-resolution one.
    const teamVoteOpenPromise = once(host, "game:avalon-state");
    leader.socket.emit("player:avalon-propose-team", { code: roomCode, teamPlayerIds: teamIds });
    await teamVoteOpenPromise;

    const voteResultPromise = once(host, "game:avalon-team-vote-result");
    const nextStatePromise = once(host, "game:avalon-state");
    players.forEach((p) => p.socket.emit("player:avalon-team-vote", { code: roomCode, approve: false }));
    const voteResult = await voteResultPromise;
    assertTrue(voteResult.approved === false, "unanimous rejection should reject the team");
    state = await nextStatePromise;
  }

  assertTrue(state.phase === "game-over", "5 straight rejections should end the game");
  assertTrue(state.winner === "evil", "Evil should win on 5 straight rejections");

  host.close();
  players.forEach((p) => p.socket.close());
  console.log("scenarioEvilWinsFiveRejections passed");
}

async function scenarioEvilWinsAssassinCorrect() {
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol", "Dave", "Eve"]);
  await startAvalon(host, roomCode, players);
  let state = await beginQuests(host, roomCode);

  for (let q = 0; q < 3; q++) {
    const teamSize = state.teamSize;
    const teamIds = await proposeAndApproveTeam(host, roomCode, players, state, teamSize);
    const { state: afterQuestState } = await runQuest(host, roomCode, players, teamIds, true);
    state = afterQuestState;

    if (state.phase === "quest-result") {
      const nextStatePromise = once(host, "game:avalon-state");
      host.emit("host:next-round", { code: roomCode });
      state = await nextStatePromise;
    }
  }

  const assassin = players.find((p) => p.token === state.assassinId);
  const merlin = findByRole(players, "merlin");

  const resultsPromises = [host, ...players.map((p) => p.socket)].map((s) => once(s, "game:avalon-results"));
  assassin.socket.emit("player:avalon-assassin-guess", { code: roomCode, targetId: merlin.token });
  const allResults = await Promise.all(resultsPromises);
  allResults.forEach(({ winner }) => assertTrue(winner === "evil", "Evil should win when the Assassin guesses Merlin correctly"));

  host.close();
  players.forEach((p) => p.socket.close());
  console.log("scenarioEvilWinsAssassinCorrect passed");
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    await scenarioGoodWinsAssassinWrong();
    await scenarioEvilWinsThreeFails();
    await scenarioEvilWinsFiveRejections();
    await scenarioEvilWinsAssassinCorrect();
    console.log("All Avalon E2E scenarios passed.");
    process.exit(0);
  } catch (err) {
    console.error("Avalon E2E FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

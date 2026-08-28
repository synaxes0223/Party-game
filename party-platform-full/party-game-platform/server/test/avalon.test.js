const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../games/avalon");

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
  return {
    code: "TEST",
    hostId: "host1",
    state: "lobby",
    players,
    gameId: "avalon",
    gameState: null,
  };
}

const FIVE = ["Alice", "Bob", "Carol", "Dave", "Eve"];
const EVIL_ROLE_NAMES = new Set(["assassin", "morgana", "minion"]);

test("meta has the expected shape", () => {
  assert.equal(game.meta.id, "avalon");
  assert.equal(game.meta.name, "Avalon");
  assert.equal(game.meta.minPlayers, 5);
  assert.equal(game.meta.maxPlayers, 10);
});

test("getRoleTable returns the official table for 5-10 players and null outside it", () => {
  assert.deepEqual(game.getRoleTable(5), { evilCount: 2, teamSizes: [2, 3, 2, 3, 3], doubleFailQuestIndex: null });
  assert.deepEqual(game.getRoleTable(7), { evilCount: 3, teamSizes: [2, 3, 3, 4, 4], doubleFailQuestIndex: 3 });
  assert.deepEqual(game.getRoleTable(10), { evilCount: 4, teamSizes: [3, 4, 4, 5, 5], doubleFailQuestIndex: 3 });
  assert.equal(game.getRoleTable(4), null);
  assert.equal(game.getRoleTable(11), null);
});

test("assignRoles errors outside the 5-10 player range", () => {
  const result = game.assignRoles(["p1", "p2", "p3", "p4"]);
  assert.match(result.error, /5-10 players/);
});

function countRoles(roles) {
  const counts = {};
  for (const role of roles.values()) counts[role] = (counts[role] || 0) + 1;
  return counts;
}

test("assignRoles produces exactly one merlin, one percival, one assassin, one morgana for 5 players, no minions", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  const { roles } = game.assignRoles(ids);
  assert.equal(roles.size, 5);
  const counts = countRoles(roles);
  assert.deepEqual(counts, { merlin: 1, percival: 1, "loyal-servant": 1, assassin: 1, morgana: 1 });
});

test("assignRoles fills remaining good/evil slots with loyal-servant/minion for 8 players", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const { roles } = game.assignRoles(ids);
  const counts = countRoles(roles);
  // 8 players -> 3 evil, 5 good
  assert.deepEqual(counts, { merlin: 1, percival: 1, "loyal-servant": 3, assassin: 1, morgana: 1, minion: 1 });
});

test("assignRoles randomizes who gets which role across repeated calls", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  const seenMerlins = new Set();
  for (let i = 0; i < 30; i++) {
    const { roles } = game.assignRoles(ids);
    for (const [id, role] of roles.entries()) {
      if (role === "merlin") seenMerlins.add(id);
    }
  }
  assert.ok(seenMerlins.size > 1, "merlin should land on different players across repeated assignments");
});

test("computeKnowledge: merlin sees the full evil list, evil players see each other but not themselves", () => {
  const roles = new Map([
    ["p1", "merlin"], ["p2", "percival"], ["p3", "loyal-servant"],
    ["p4", "assassin"], ["p5", "morgana"],
  ]);
  const nicknames = new Map([
    ["p1", "Alice"], ["p2", "Bob"], ["p3", "Carol"], ["p4", "Dave"], ["p5", "Eve"],
  ]);
  const knowledge = game.computeKnowledge(roles, nicknames);

  const merlinView = knowledge.get("p1");
  assert.equal(merlinView.team, "good");
  const merlinEvilIds = merlinView.evilPlayers.map((p) => p.id).sort();
  assert.deepEqual(merlinEvilIds, ["p4", "p5"]);

  const assassinView = knowledge.get("p4");
  assert.equal(assassinView.team, "evil");
  assert.deepEqual(assassinView.evilPlayers.map((p) => p.id), ["p5"]);

  const morganaView = knowledge.get("p5");
  assert.deepEqual(morganaView.evilPlayers.map((p) => p.id), ["p4"]);
});

test("computeKnowledge: percival sees an unordered {merlin, morgana} pair and nothing else", () => {
  const roles = new Map([
    ["p1", "merlin"], ["p2", "percival"], ["p3", "loyal-servant"],
    ["p4", "assassin"], ["p5", "morgana"],
  ]);
  const nicknames = new Map([
    ["p1", "Alice"], ["p2", "Bob"], ["p3", "Carol"], ["p4", "Dave"], ["p5", "Eve"],
  ]);
  const knowledge = game.computeKnowledge(roles, nicknames);

  const percivalView = knowledge.get("p2");
  assert.equal(percivalView.evilPlayers.length, 0);
  const pairIds = percivalView.percivalPair.map((p) => p.id).sort();
  assert.deepEqual(pairIds, ["p1", "p5"]);
});

test("computeKnowledge: loyal servants see nothing extra", () => {
  const roles = new Map([
    ["p1", "merlin"], ["p2", "percival"], ["p3", "loyal-servant"],
    ["p4", "assassin"], ["p5", "morgana"],
  ]);
  const nicknames = new Map([
    ["p1", "Alice"], ["p2", "Bob"], ["p3", "Carol"], ["p4", "Dave"], ["p5", "Eve"],
  ]);
  const knowledge = game.computeKnowledge(roles, nicknames);

  const servantView = knowledge.get("p3");
  assert.equal(servantView.team, "good");
  assert.equal(servantView.evilPlayers.length, 0);
  assert.equal(servantView.percivalPair, null);
});

test("tallyTeamVote: majority approve wins", () => {
  const votes = new Map([["p1", true], ["p2", true], ["p3", false]]);
  const result = game.tallyTeamVote(votes);
  assert.equal(result.approved, true);
  assert.equal(result.approveCount, 2);
  assert.equal(result.rejectCount, 1);
});

test("tallyTeamVote: a tie counts as rejected", () => {
  const votes = new Map([["p1", true], ["p2", false]]);
  const result = game.tallyTeamVote(votes);
  assert.equal(result.approved, false);
});

test("resolveQuest: a single fail fails a normal quest", () => {
  const votes = new Map([["p1", true], ["p2", false]]);
  assert.equal(game.resolveQuest(votes, false), "fail");
});

test("resolveQuest: all success passes a normal quest", () => {
  const votes = new Map([["p1", true], ["p2", true]]);
  assert.equal(game.resolveQuest(votes, false), "success");
});

test("resolveQuest: a single fail is NOT enough on a double-fail quest", () => {
  const votes = new Map([["p1", true], ["p2", true], ["p3", false]]);
  assert.equal(game.resolveQuest(votes, true), "success");
});

test("resolveQuest: two fails DO fail a double-fail quest", () => {
  const votes = new Map([["p1", false], ["p2", true], ["p3", false]]);
  assert.equal(game.resolveQuest(votes, true), "fail");
});

test("nextLeaderIndex wraps around", () => {
  assert.equal(game.nextLeaderIndex(0, 5), 1);
  assert.equal(game.nextLeaderIndex(4, 5), 0);
});

test("countQuestResults tallies success/fail counts", () => {
  const counts = game.countQuestResults(["success", "fail", "success"]);
  assert.deepEqual(counts, { successCount: 2, failCount: 1 });
});

test("onStartGame errors below minPlayers", () => {
  const room = makeRoom(["Alice", "Bob", "Carol"]);
  const { io } = makeStubIo();
  const result = game.onStartGame(room, io);
  assert.match(result.error, /5-10 players/);
});

test("onStartGame assigns roles, sets role-reveal phase, and broadcasts a personalized game:avalon-role to every player", () => {
  const room = makeRoom(FIVE);
  const { io, emitted } = makeStubIo();
  const result = game.onStartGame(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.state, "in-progress");
  assert.equal(room.gameState.phase, "role-reveal");
  assert.equal(room.gameState.playerOrder.length, 5);
  assert.equal(room.gameState.leaderIndex, 0);
  assert.equal(room.gameState.questIndex, 0);
  assert.deepEqual(room.gameState.teamSizes, [2, 3, 2, 3, 3]);
  assert.deepEqual(room.gameState.questResults, []);

  const roleEmits = emitted.filter((e) => e.event === "game:avalon-role");
  assert.equal(roleEmits.length, 5);
  roleEmits.forEach((e) => {
    assert.equal(e.kind, "to");
    assert.ok(["merlin", "percival", "loyal-servant", "assassin", "morgana"].includes(e.payload.role));
  });
});

test("onStartGame broadcasts an initial game:avalon-state to the whole room", () => {
  const room = makeRoom(FIVE);
  const { io, emitted } = makeStubIo();
  game.onStartGame(room, io);

  const stateEmit = emitted.find((e) => e.event === "game:avalon-state");
  assert.equal(stateEmit.kind, "in");
  assert.equal(stateEmit.id, "TEST");
  assert.equal(stateEmit.payload.phase, "role-reveal");
  assert.ok(room.gameState.playerOrder.includes(stateEmit.payload.leaderId));
  assert.equal(stateEmit.payload.questIndex, 0);
  assert.equal(stateEmit.payload.winner, null);
});

test("onStartGame errors if a game is already in progress", () => {
  const room = makeRoom(FIVE);
  const { io } = makeStubIo();
  game.onStartGame(room, io);
  const result = game.onStartGame(room, io);
  assert.match(result.error, /already in progress/);
});

function startedRoom(nicknames) {
  const room = makeRoom(nicknames);
  const { io } = makeStubIo();
  game.onStartGame(room, io);
  return room;
}

test("onHostBeginQuests moves role-reveal to team-proposal", () => {
  const room = startedRoom(FIVE);
  const { io, emitted } = makeStubIo();
  const result = game.onHostBeginQuests(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "team-proposal");
  const stateEmit = emitted.find((e) => e.event === "game:avalon-state");
  assert.equal(stateEmit.payload.phase, "team-proposal");
});

test("onHostBeginQuests errors outside role-reveal", () => {
  const room = startedRoom(FIVE);
  const { io } = makeStubIo();
  game.onHostBeginQuests(room, io);
  const result = game.onHostBeginQuests(room, io);
  assert.match(result.error, /Not ready/);
});

test("onProposeTeam rejects a non-leader's proposal", () => {
  const room = startedRoom(FIVE);
  const { io } = makeStubIo();
  game.onHostBeginQuests(room, io);
  const leaderId = room.gameState.playerOrder[0];
  const nonLeaderId = room.gameState.playerOrder.find((id) => id !== leaderId);

  game.onProposeTeam(room, io, nonLeaderId, [leaderId, nonLeaderId]);
  assert.equal(room.gameState.phase, "team-proposal");
});

test("onProposeTeam rejects a team of the wrong size and notifies the leader", () => {
  const room = startedRoom(FIVE); // quest 1 team size is 2
  const { io } = makeStubIo();
  game.onHostBeginQuests(room, io);
  const leaderId = room.gameState.playerOrder[0];

  const { io: io2, emitted } = makeStubIo();
  game.onProposeTeam(room, io2, leaderId, [leaderId]); // only 1, need 2
  assert.equal(room.gameState.phase, "team-proposal");
  const rejection = emitted.find((e) => e.event === "game:avalon-propose-rejected");
  assert.equal(rejection.id, leaderId);
});

test("onProposeTeam with a valid team moves to team-vote and broadcasts the team", () => {
  const room = startedRoom(FIVE);
  const { io } = makeStubIo();
  game.onHostBeginQuests(room, io);
  const leaderId = room.gameState.playerOrder[0];
  const teammateId = room.gameState.playerOrder[1];

  const { io: io2, emitted } = makeStubIo();
  game.onProposeTeam(room, io2, leaderId, [leaderId, teammateId]);
  assert.equal(room.gameState.phase, "team-vote");
  assert.deepEqual(room.gameState.currentTeam.sort(), [leaderId, teammateId].sort());
  const stateEmit = emitted.find((e) => e.event === "game:avalon-state");
  assert.equal(stateEmit.payload.currentTeam.length, 2);
});

function proposedRoom(nicknames, teamOverride) {
  const room = startedRoom(nicknames);
  const { io } = makeStubIo();
  game.onHostBeginQuests(room, io);
  const leaderId = room.gameState.playerOrder[0];
  const requiredSize = room.gameState.teamSizes[0];
  const team = teamOverride || room.gameState.playerOrder.slice(0, requiredSize);
  game.onProposeTeam(room, io, leaderId, team);
  return room;
}

test("onTeamVote does nothing until every player has voted", () => {
  const room = proposedRoom(FIVE);
  const { io, emitted } = makeStubIo();
  room.gameState.playerOrder.slice(0, 4).forEach((id) => game.onTeamVote(room, io, id, true));
  assert.equal(room.gameState.phase, "team-vote");
  assert.equal(emitted.find((e) => e.event === "game:avalon-team-vote-result"), undefined);
});

test("onTeamVote: majority approve moves to quest phase", () => {
  const room = proposedRoom(FIVE);
  const { io, emitted } = makeStubIo();
  room.gameState.playerOrder.forEach((id) => game.onTeamVote(room, io, id, true));

  assert.equal(room.gameState.phase, "quest");
  const resultEmit = emitted.find((e) => e.event === "game:avalon-team-vote-result");
  assert.equal(resultEmit.payload.approved, true);
  assert.equal(resultEmit.payload.votes.length, 5);
});

test("onTeamVote excludes a disconnected player from quorum, resolving once the remaining players have voted", () => {
  const room = proposedRoom(FIVE);
  // One player drops mid-vote but keeps their seat in room.players (durable-
  // session reconnect model) -- only their connected flag flips.
  const disconnectedId = room.gameState.playerOrder[4];
  room.players.get(disconnectedId).connected = false;

  const { io, emitted } = makeStubIo();
  const voters = room.gameState.playerOrder.filter((id) => id !== disconnectedId);
  // Without the fix, teamVotes.size (4) never reaches the inflated
  // playerOrder.length (5, since the disconnected player is still counted),
  // so the vote would stay stuck in "team-vote" forever.
  voters.forEach((id) => game.onTeamVote(room, io, id, true));

  assert.equal(room.gameState.phase, "quest");
  const resultEmit = emitted.find((e) => e.event === "game:avalon-team-vote-result");
  assert.equal(resultEmit.payload.approved, true);
  assert.equal(resultEmit.payload.votes.length, 4);
});

test("onTeamVote: a stale vote from a player who has since disconnected does not let the vote resolve before every remaining connected player has voted", () => {
  const room = proposedRoom(FIVE);
  const [p1, p2, p3, p4, p5] = room.gameState.playerOrder;
  const { io } = makeStubIo();

  // p1 votes while still connected...
  game.onTeamVote(room, io, p1, true);
  // ...then disconnects, but keeps their seat in room.players (durable-
  // session reconnect model) -- their already-cast vote stays in gs.teamVotes.
  room.players.get(p1).connected = false;

  game.onTeamVote(room, io, p2, true);
  game.onTeamVote(room, io, p3, true);
  game.onTeamVote(room, io, p4, true);

  // teamVotes.size is now 4 (p1's stale vote + p2 + p3 + p4), matching the
  // naive connected-player count (p2, p3, p4, p5) -- but p5, still
  // connected, never voted. A size-only quorum check would incorrectly
  // resolve here; the vote must instead keep waiting for p5.
  assert.equal(room.gameState.phase, "team-vote");
  assert.equal(room.gameState.teamVotes.size, 4);

  game.onTeamVote(room, io, p5, true);
  assert.equal(room.gameState.phase, "quest");
});

test("onTeamVote does not resolve if every player is currently disconnected (waits rather than dividing by zero)", () => {
  const room = proposedRoom(FIVE);
  room.gameState.playerOrder.forEach((id) => {
    room.players.get(id).connected = false;
  });
  const { io, emitted } = makeStubIo();
  // Without the connected-count > 0 guard, teamVotes.size (1) >= connectedCount
  // (0) would be true and this single vote would incorrectly resolve the
  // round with nobody real having voted.
  game.onTeamVote(room, io, room.gameState.playerOrder[0], true);
  assert.equal(room.gameState.phase, "team-vote");
  assert.equal(emitted.find((e) => e.event === "game:avalon-team-vote-result"), undefined);
});

test("onTeamVote: majority reject rotates leader and returns to team-proposal", () => {
  const room = proposedRoom(FIVE);
  const startingLeader = room.gameState.leaderIndex;
  const { io } = makeStubIo();
  room.gameState.playerOrder.forEach((id) => game.onTeamVote(room, io, id, false));

  assert.equal(room.gameState.phase, "team-proposal");
  assert.equal(room.gameState.rejectionCount, 1);
  assert.equal(room.gameState.leaderIndex, game.nextLeaderIndex(startingLeader, 5));
  assert.equal(room.gameState.currentTeam, null);
});

test("onTeamVote: the 5th straight rejection ends the game with Evil winning", () => {
  const room = proposedRoom(FIVE);
  const { io, emitted } = makeStubIo();

  for (let i = 0; i < 5; i++) {
    room.gameState.playerOrder.forEach((id) => game.onTeamVote(room, io, id, false));
    if (room.gameState.phase === "team-proposal" && i < 4) {
      const leaderId = room.gameState.playerOrder[room.gameState.leaderIndex];
      const requiredSize = room.gameState.teamSizes[room.gameState.questIndex];
      game.onProposeTeam(room, io, leaderId, room.gameState.playerOrder.slice(0, requiredSize));
    }
  }

  assert.equal(room.gameState.phase, "game-over");
  assert.equal(room.gameState.winner, "evil");
  assert.equal(room.state, "results");
  const resultsEmit = emitted.find((e) => e.event === "game:avalon-results");
  assert.equal(resultsEmit.payload.winner, "evil");
});

function questRoom(nicknames) {
  const room = proposedRoom(nicknames);
  const { io } = makeStubIo();
  room.gameState.playerOrder.forEach((id) => game.onTeamVote(room, io, id, true));
  return room; // phase is now "quest"
}

test("onQuestVote rejects a Good player's fail vote and does not record it", () => {
  const room = questRoom(FIVE);
  const goodIds = Array.from(room.gameState.roles.entries())
    .filter(([, role]) => !EVIL_ROLE_NAMES.has(role))
    .map(([id]) => id);
  const evilIds = Array.from(room.gameState.roles.entries())
    .filter(([, role]) => EVIL_ROLE_NAMES.has(role))
    .map(([id]) => id);
  room.gameState.currentTeam = [goodIds[0], evilIds[0]];
  const goodMemberId = goodIds[0];

  const { io, emitted } = makeStubIo();
  game.onQuestVote(room, io, goodMemberId, false);
  assert.equal(room.gameState.questVotes.has(goodMemberId), false);
  const rejection = emitted.find((e) => e.event === "game:avalon-quest-vote-rejected");
  assert.equal(rejection.id, goodMemberId);
});

test("onQuestVote ignores a vote from a player not on the current team", () => {
  const room = questRoom(FIVE);
  const outsiderId = room.gameState.playerOrder.find((id) => !room.gameState.currentTeam.includes(id));
  const { io } = makeStubIo();
  game.onQuestVote(room, io, outsiderId, true);
  assert.equal(room.gameState.questVotes.has(outsiderId), false);
});

test("onQuestVote: all-success resolves the quest as success and advances to quest-result", () => {
  const room = questRoom(FIVE);
  const team = room.gameState.currentTeam;
  const { io, emitted } = makeStubIo();
  team.forEach((id) => game.onQuestVote(room, io, id, true));

  assert.equal(room.gameState.questResults[0], "success");
  assert.equal(room.gameState.phase, "quest-result");
  assert.equal(room.gameState.rejectionCount, 0);
  const resultEmit = emitted.find((e) => e.event === "game:avalon-quest-result");
  assert.equal(resultEmit.payload.outcome, "success");
});

test("onQuestVote: a stale vote from a player who has since disconnected does not let the quest resolve before every remaining connected team member has voted", () => {
  const room = questRoom(FIVE);
  const [p1, p2, p3, p4, p5] = room.gameState.playerOrder;
  // Override the (real, size-2) currentTeam with the full 5-player roster --
  // onQuestVote itself doesn't validate team size (only onProposeTeam does),
  // so this is a valid way to exercise the quorum logic with enough members
  // to show "some but not all connected members voted" distinctly. Voting
  // only `true` throughout means no player's role matters here (the
  // Evil-only-fail check only triggers on a `false` vote).
  room.gameState.currentTeam = [p1, p2, p3, p4, p5];
  room.gameState.questVotes = new Map();
  const { io } = makeStubIo();

  // p1 votes while still connected...
  game.onQuestVote(room, io, p1, true);
  // ...then disconnects, but keeps their seat in room.players (durable-
  // session reconnect model) -- their already-cast vote stays in gs.questVotes.
  room.players.get(p1).connected = false;

  game.onQuestVote(room, io, p2, true);
  game.onQuestVote(room, io, p3, true);
  game.onQuestVote(room, io, p4, true);

  // questVotes.size is now 4 (p1's stale vote + p2 + p3 + p4), matching the
  // naive connected-player count (p2, p3, p4, p5) -- but p5, still
  // connected, never voted. A size-only quorum check would incorrectly
  // resolve here; the quest must instead keep waiting for p5.
  assert.equal(room.gameState.phase, "quest");
  assert.equal(room.gameState.questVotes.size, 4);

  game.onQuestVote(room, io, p5, true);
  assert.equal(room.gameState.phase, "quest-result");
});

test("onQuestVote excludes a disconnected team member from quorum, resolving once the remaining members have voted", () => {
  const room = questRoom(FIVE);
  const team = room.gameState.currentTeam;
  // One team member drops mid-vote but keeps their seat in room.players
  // (durable-session reconnect model) -- only their connected flag flips.
  const disconnectedId = team[0];
  room.players.get(disconnectedId).connected = false;
  const remainingTeam = team.slice(1);

  const { io, emitted } = makeStubIo();
  // Without the fix, questVotes.size never reaches the inflated
  // currentTeam.length (still counting the disconnected member), so the
  // quest would stay stuck in "quest" forever.
  remainingTeam.forEach((id) => game.onQuestVote(room, io, id, true));

  assert.equal(room.gameState.phase, "quest-result");
  const resultEmit = emitted.find((e) => e.event === "game:avalon-quest-result");
  assert.equal(resultEmit.payload.outcome, "success");
});

test("onQuestVote does not resolve if every team member is currently disconnected (waits rather than dividing by zero)", () => {
  const room = questRoom(FIVE);
  const team = room.gameState.currentTeam;
  team.forEach((id) => {
    room.players.get(id).connected = false;
  });
  const { io, emitted } = makeStubIo();
  // Without the connected-count > 0 guard, questVotes.size (1) >=
  // connectedCount (0) would be true and this single vote would incorrectly
  // resolve the quest with nobody real having voted.
  game.onQuestVote(room, io, team[0], true);
  assert.equal(room.gameState.phase, "quest");
  assert.equal(emitted.find((e) => e.event === "game:avalon-quest-result"), undefined);
});

test("onQuestVote: 3rd failed quest ends the game with Evil winning", () => {
  const room = questRoom(FIVE);
  room.gameState.questResults = ["fail", "fail"];
  const evilIds = Array.from(room.gameState.roles.entries())
    .filter(([, role]) => EVIL_ROLE_NAMES.has(role))
    .map(([id]) => id);
  room.gameState.currentTeam = evilIds.slice(0, room.gameState.teamSizes[room.gameState.questIndex]);
  const team = room.gameState.currentTeam;
  const { io, emitted } = makeStubIo();
  team.forEach((id) => game.onQuestVote(room, io, id, false));

  assert.equal(room.gameState.phase, "game-over");
  assert.equal(room.gameState.winner, "evil");
  assert.equal(room.state, "results");
  const resultsEmit = emitted.find((e) => e.event === "game:avalon-results");
  assert.equal(resultsEmit.payload.winner, "evil");
});

test("onQuestVote: 3rd successful quest moves straight to the assassin phase", () => {
  const room = questRoom(FIVE);
  room.gameState.questResults = ["success", "success"];
  const team = room.gameState.currentTeam;
  const { io, emitted } = makeStubIo();
  team.forEach((id) => game.onQuestVote(room, io, id, true));

  assert.equal(room.gameState.phase, "assassin");
  const stateEmit = emitted.find((e) => e.event === "game:avalon-state");
  assert.equal(stateEmit.payload.assassinId, room.gameState.assassinId);
});

function quest1SuccessRoom(nicknames) {
  const room = questRoom(nicknames);
  const team = room.gameState.currentTeam;
  const { io } = makeStubIo();
  team.forEach((id) => game.onQuestVote(room, io, id, true));
  return room; // phase is now "quest-result", questIndex 1
}

test("onNextRound errors outside quest-result", () => {
  const room = questRoom(FIVE);
  const { io } = makeStubIo();
  const result = game.onNextRound(room, io);
  assert.match(result.error, /Not ready/);
});

test("onNextRound moves quest-result back to team-proposal", () => {
  const room = quest1SuccessRoom(FIVE);
  const { io, emitted } = makeStubIo();
  const result = game.onNextRound(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "team-proposal");
  const stateEmit = emitted.find((e) => e.event === "game:avalon-state");
  assert.equal(stateEmit.payload.questIndex, 1);
});

function assassinPhaseRoom(nicknames) {
  const room = questRoom(nicknames);
  room.gameState.questResults = ["success", "success"];
  const team = room.gameState.currentTeam;
  const { io } = makeStubIo();
  team.forEach((id) => game.onQuestVote(room, io, id, true));
  return room; // phase is now "assassin"
}

test("onAssassinGuess ignores a guess from a non-assassin", () => {
  const room = assassinPhaseRoom(FIVE);
  const impostor = room.gameState.playerOrder.find((id) => id !== room.gameState.assassinId);
  const { io } = makeStubIo();
  game.onAssassinGuess(room, io, impostor, room.gameState.playerOrder[0]);
  assert.equal(room.gameState.phase, "assassin");
});

test("onAssassinGuess: correct guess flips the win to Evil", () => {
  const room = assassinPhaseRoom(FIVE);
  const merlinId = Array.from(room.gameState.roles.entries()).find(([, r]) => r === "merlin")[0];
  const { io, emitted } = makeStubIo();
  game.onAssassinGuess(room, io, room.gameState.assassinId, merlinId);

  assert.equal(room.gameState.phase, "game-over");
  assert.equal(room.gameState.winner, "evil");
  assert.equal(room.state, "results");
  const resultsEmit = emitted.find((e) => e.event === "game:avalon-results");
  assert.equal(resultsEmit.payload.winner, "evil");
});

test("onAssassinGuess: wrong guess gives Good the win", () => {
  const room = assassinPhaseRoom(FIVE);
  const nonMerlinId = Array.from(room.gameState.roles.entries()).find(([, r]) => r !== "merlin")[0];
  const { io, emitted } = makeStubIo();
  game.onAssassinGuess(room, io, room.gameState.assassinId, nonMerlinId);

  assert.equal(room.gameState.winner, "good");
  assert.equal(room.state, "results");
  const resultsEmit = emitted.find((e) => e.event === "game:avalon-results");
  assert.equal(resultsEmit.payload.winner, "good");
});

test("onPlayerLeft ends the game with winner null (interrupted) and still reveals roles", () => {
  const room = startedRoom(FIVE);
  const departingId = room.gameState.playerOrder[0];
  room.players.delete(departingId); // index.js removes the player before calling onPlayerLeft

  const { io, emitted } = makeStubIo();
  game.onPlayerLeft(room, io, departingId);

  assert.equal(room.gameState.phase, "game-over");
  assert.equal(room.gameState.winner, null);
  assert.equal(room.state, "results");
  const resultsEmit = emitted.find((e) => e.event === "game:avalon-results");
  assert.equal(resultsEmit.payload.winner, null);
  assert.equal(resultsEmit.payload.roles.length, 5);
  const departingEntry = resultsEmit.payload.roles.find((r) => r.id === departingId);
  assert.ok(departingEntry.nickname, "departing player's nickname should still be present via gs.nicknames");
});

test("onPlayerLeft is a no-op once the game is already over", () => {
  const room = startedRoom(FIVE);
  room.gameState.phase = "game-over";
  room.gameState.winner = "good";
  const { io, emitted } = makeStubIo();
  game.onPlayerLeft(room, io, room.gameState.playerOrder[0]);
  assert.equal(emitted.length, 0);
  assert.equal(room.gameState.winner, "good");
});

test("onPlayerLeft is a no-op if no game has started", () => {
  const room = makeRoom(FIVE);
  const { io, emitted } = makeStubIo();
  game.onPlayerLeft(room, io, "p1");
  assert.equal(emitted.length, 0);
});

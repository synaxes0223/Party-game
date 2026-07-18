// avalon.js
// Game module: The Resistance: Avalon (base roles + Percival/Morgana). Hidden
// good/evil roles, a leader rotates and proposes a quest team each round,
// everyone publicly votes to approve/reject the team, an approved team
// secretly passes or fails the quest, and three failed/successful quests
// decide the game — unless Good wins three quests, in which case the
// Assassin gets one guess at Merlin's identity to steal the win for Evil.
//
// Single-file game module by design: constants, pure helpers, and the
// socket-facing on* handlers all live here together (no sibling
// avalonLogic.js), unlike Word Wolf/Find the Imposter/Slip-Up.

const meta = {
  id: "avalon",
  name: "Avalon",
  description:
    "Hidden roles, secret missions. Merlin and the loyal servants must complete three quests before the minions of Mordred sabotage three of them — and even then, the Assassin gets one shot at unmasking Merlin.",
  minPlayers: 5,
  maxPlayers: 10,
  supportedModes: ["multiplayer"],
};

// Official Avalon table for 5-10 players. doubleFailQuestIndex is the
// 0-based quest index (quest 4 == index 3) that requires two fails instead
// of one to fail the quest; null means every quest in that row needs just 1.
const ROLE_TABLE = {
  5: { evilCount: 2, teamSizes: [2, 3, 2, 3, 3], doubleFailQuestIndex: null },
  6: { evilCount: 2, teamSizes: [2, 3, 4, 3, 4], doubleFailQuestIndex: null },
  7: { evilCount: 3, teamSizes: [2, 3, 3, 4, 4], doubleFailQuestIndex: 3 },
  8: { evilCount: 3, teamSizes: [3, 4, 4, 5, 5], doubleFailQuestIndex: 3 },
  9: { evilCount: 3, teamSizes: [3, 4, 4, 5, 5], doubleFailQuestIndex: 3 },
  10: { evilCount: 4, teamSizes: [3, 4, 4, 5, 5], doubleFailQuestIndex: 3 },
};

const EVIL_ROLES = new Set(["assassin", "morgana", "minion"]);

function getRoleTable(playerCount) {
  return ROLE_TABLE[playerCount] || null;
}

function shuffle(array) {
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function assignRoles(playerIds) {
  const table = getRoleTable(playerIds.length);
  if (!table) {
    return { error: `Avalon needs 5-10 players (got ${playerIds.length}).` };
  }

  const shuffled = shuffle(playerIds);
  const evilIds = shuffled.slice(0, table.evilCount);
  const goodIds = shuffled.slice(table.evilCount);

  const roles = new Map();
  goodIds.forEach((id, i) => {
    if (i === 0) roles.set(id, "merlin");
    else if (i === 1) roles.set(id, "percival");
    else roles.set(id, "loyal-servant");
  });
  evilIds.forEach((id, i) => {
    if (i === 0) roles.set(id, "assassin");
    else if (i === 1) roles.set(id, "morgana");
    else roles.set(id, "minion");
  });

  return { roles };
}

function findIdByRole(roles, roleName) {
  for (const [id, role] of roles.entries()) {
    if (role === roleName) return id;
  }
  return null;
}

function computeKnowledge(roles, nicknames) {
  const nickOf = (id) => nicknames.get(id) || "";
  const evilIds = Array.from(roles.entries())
    .filter(([, role]) => EVIL_ROLES.has(role))
    .map(([id]) => id);
  const merlinId = findIdByRole(roles, "merlin");
  const morganaId = findIdByRole(roles, "morgana");

  const knowledge = new Map();
  for (const [id, role] of roles.entries()) {
    const team = EVIL_ROLES.has(role) ? "evil" : "good";
    let evilPlayers = [];
    let percivalPair = null;

    if (role === "merlin") {
      evilPlayers = evilIds.map((eid) => ({ id: eid, nickname: nickOf(eid) }));
    } else if (role === "percival") {
      percivalPair = shuffle([
        { id: merlinId, nickname: nickOf(merlinId) },
        { id: morganaId, nickname: nickOf(morganaId) },
      ]);
    } else if (EVIL_ROLES.has(role)) {
      evilPlayers = evilIds.filter((eid) => eid !== id).map((eid) => ({ id: eid, nickname: nickOf(eid) }));
    }

    knowledge.set(id, { role, team, evilPlayers, percivalPair });
  }
  return knowledge;
}

function tallyTeamVote(teamVotes) {
  let approveCount = 0;
  let rejectCount = 0;
  for (const approve of teamVotes.values()) {
    if (approve) approveCount++;
    else rejectCount++;
  }
  return { approved: approveCount > rejectCount, approveCount, rejectCount };
}

function resolveQuest(questVotes, requiresDoubleFail) {
  let failCount = 0;
  for (const success of questVotes.values()) {
    if (!success) failCount++;
  }
  const threshold = requiresDoubleFail ? 2 : 1;
  return failCount >= threshold ? "fail" : "success";
}

function nextLeaderIndex(currentIndex, playerCount) {
  return (currentIndex + 1) % playerCount;
}

function countQuestResults(questResults) {
  const successCount = questResults.filter((r) => r === "success").length;
  const failCount = questResults.filter((r) => r === "fail").length;
  return { successCount, failCount };
}

function getPlayerIds(room) {
  return Array.from(room.players.keys());
}

function broadcastRoles(room, io, knowledge) {
  for (const [id, k] of knowledge.entries()) {
    io.to(id).emit("game:avalon-role", {
      role: k.role,
      team: k.team,
      evilPlayers: k.evilPlayers,
      percivalPair: k.percivalPair,
    });
  }
}

function broadcastState(room, io) {
  const gs = room.gameState;
  const leaderId = gs.playerOrder[gs.leaderIndex] || null;
  const leaderNickname = leaderId ? gs.nicknames.get(leaderId) : null;
  const currentTeam = gs.currentTeam
    ? gs.currentTeam.map((id) => ({ id, nickname: gs.nicknames.get(id) }))
    : null;

  io.in(room.code).emit("game:avalon-state", {
    phase: gs.phase,
    leaderId,
    leaderNickname,
    questIndex: gs.questIndex,
    teamSize: gs.teamSizes[gs.questIndex] || null,
    currentTeam,
    rejectionCount: gs.rejectionCount,
    questResults: gs.questResults,
    assassinId: gs.phase === "assassin" ? gs.assassinId : null,
    winner: gs.winner,
  });
}

function onStartGame(room, io) {
  if (room.gameState && room.gameState.phase !== "game-over") {
    return { error: "Game already in progress." };
  }

  const playerIds = getPlayerIds(room);
  const table = getRoleTable(playerIds.length);
  if (!table) {
    return { error: `Avalon needs 5-10 players (got ${playerIds.length}).` };
  }

  const nicknames = new Map(playerIds.map((id) => [id, room.players.get(id).nickname]));
  const { roles } = assignRoles(playerIds);
  const knowledge = computeKnowledge(roles, nicknames);
  const assassinId = findIdByRole(roles, "assassin");

  room.state = "in-progress";
  room.gameState = {
    phase: "role-reveal",
    playerOrder: shuffle(playerIds),
    nicknames,
    roles,
    leaderIndex: 0,
    questIndex: 0,
    teamSizes: table.teamSizes,
    doubleFailQuestIndex: table.doubleFailQuestIndex,
    questResults: [],
    rejectionCount: 0,
    currentTeam: null,
    teamVotes: new Map(),
    questVotes: new Map(),
    assassinId,
    winner: null,
  };

  broadcastRoles(room, io, knowledge);
  broadcastState(room, io);
  return {};
}

function onHostBeginQuests(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "role-reveal") return { error: "Not ready to begin quests." };
  gs.phase = "team-proposal";
  broadcastState(room, io);
  return {};
}

function onProposeTeam(room, io, socketId, teamPlayerIds) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "team-proposal") return;
  const leaderId = gs.playerOrder[gs.leaderIndex];
  if (socketId !== leaderId) return;

  const requiredSize = gs.teamSizes[gs.questIndex];
  const ids = Array.isArray(teamPlayerIds) ? Array.from(new Set(teamPlayerIds)) : [];
  const validIds = ids.filter((id) => gs.playerOrder.includes(id));
  if (validIds.length !== requiredSize) {
    io.to(socketId).emit("game:avalon-propose-rejected", {
      reason: `Pick exactly ${requiredSize} players.`,
    });
    return;
  }

  gs.currentTeam = validIds;
  gs.teamVotes = new Map();
  gs.phase = "team-vote";
  broadcastState(room, io);
}

function broadcastResults(room, io) {
  const gs = room.gameState;
  const roles = gs.playerOrder.map((id) => ({
    id,
    nickname: gs.nicknames.get(id),
    role: gs.roles.get(id),
    team: EVIL_ROLES.has(gs.roles.get(id)) ? "evil" : "good",
  }));
  io.in(room.code).emit("game:avalon-results", {
    winner: gs.winner,
    roles,
    questResults: gs.questResults,
  });
}

function resolveTeamVote(room, io) {
  const gs = room.gameState;
  const tally = tallyTeamVote(gs.teamVotes);
  const votes = Array.from(gs.teamVotes.entries()).map(([id, approve]) => ({
    id,
    nickname: gs.nicknames.get(id),
    approve,
  }));

  io.in(room.code).emit("game:avalon-team-vote-result", {
    approved: tally.approved,
    votes,
    rejectionCount: gs.rejectionCount,
  });

  if (tally.approved) {
    gs.phase = "quest";
    gs.questVotes = new Map();
  } else {
    gs.rejectionCount += 1;
    gs.currentTeam = null;
    if (gs.rejectionCount >= 5) {
      gs.phase = "game-over";
      gs.winner = "evil";
      room.state = "results";
    } else {
      gs.leaderIndex = nextLeaderIndex(gs.leaderIndex, gs.playerOrder.length);
      gs.phase = "team-proposal";
    }
  }

  broadcastState(room, io);
  if (gs.phase === "game-over") broadcastResults(room, io);
}

function onTeamVote(room, io, socketId, approve) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "team-vote") return;
  if (!gs.playerOrder.includes(socketId)) return;
  gs.teamVotes.set(socketId, !!approve);

  if (gs.teamVotes.size === gs.playerOrder.length) {
    resolveTeamVote(room, io);
  }
}

module.exports = {
  meta,
  getRoleTable,
  assignRoles,
  computeKnowledge,
  tallyTeamVote,
  resolveQuest,
  nextLeaderIndex,
  countQuestResults,
  onStartGame,
  onHostBeginQuests,
  onProposeTeam,
  onTeamVote,
};

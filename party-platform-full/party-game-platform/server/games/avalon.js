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

module.exports = { meta, getRoleTable, assignRoles, computeKnowledge };

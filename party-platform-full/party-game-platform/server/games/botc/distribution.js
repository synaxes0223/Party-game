// distribution.js
// Player-count -> character-count table (from the spec's own rulebook-
// sourced table) and the Baron's +2 Outsider / -2 Townsfolk modifier. Pure
// data and pure functions -- the Storyteller can still deal any set they
// like via grimoire.js's manual overrides; this only computes what to warn
// about (spec's Governing Principle: "warn, never block" for distribution).

const BASE_TABLE = {
  5: { townsfolk: 3, outsiders: 0, minions: 1, demon: 1 },
  6: { townsfolk: 3, outsiders: 1, minions: 1, demon: 1 },
  7: { townsfolk: 5, outsiders: 0, minions: 1, demon: 1 },
  8: { townsfolk: 5, outsiders: 1, minions: 1, demon: 1 },
  9: { townsfolk: 5, outsiders: 2, minions: 1, demon: 1 },
  10: { townsfolk: 7, outsiders: 0, minions: 2, demon: 1 },
  11: { townsfolk: 7, outsiders: 1, minions: 2, demon: 1 },
  12: { townsfolk: 7, outsiders: 2, minions: 2, demon: 1 },
  13: { townsfolk: 9, outsiders: 0, minions: 3, demon: 1 },
  14: { townsfolk: 9, outsiders: 1, minions: 3, demon: 1 },
  15: { townsfolk: 9, outsiders: 2, minions: 3, demon: 1 },
};

function baseDistributionFor(playerCount) {
  return BASE_TABLE[playerCount] || null;
}

function applyBaronModifier(baseDistribution) {
  return {
    ...baseDistribution,
    townsfolk: baseDistribution.townsfolk - 2,
    outsiders: baseDistribution.outsiders + 2,
  };
}

function checkDistribution(playerCount, dealtTeamCounts, baronInPlay) {
  const base = baseDistributionFor(playerCount);
  if (!base) return `No distribution table entry for ${playerCount} players.`;
  const expected = baronInPlay ? applyBaronModifier(base) : base;
  const mismatches = [];
  for (const team of ["townsfolk", "outsiders", "minions", "demon"]) {
    const got = dealtTeamCounts[team] || 0;
    if (got !== expected[team]) {
      mismatches.push(`${team}: expected ${expected[team]}, got ${got}`);
    }
  }
  return mismatches.length ? mismatches.join("; ") : null;
}

module.exports = { BASE_TABLE, baseDistributionFor, applyBaronModifier, checkDistribution };

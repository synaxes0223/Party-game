// demonInfo.js
// First-night pseudo-step: "the Demon learns the Minion plus three
// not-in-play good characters as bluffs." Same one-legal-outcome reasoning
// as minionInfo.js.

const characters = require("../characters");

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function computeCandidates(state, seat) {
  const minionSeats = state.seats.filter((s) => s.alive && characters.teamOf(s.characterId) === "minion");
  if (minionSeats.length === 0) return [];

  const dealtIds = new Set(state.seats.map((s) => s.characterId));
  const goodPool = [
    ...characters.charactersOfTeam("townsfolk"),
    ...characters.charactersOfTeam("outsider"),
  ].filter((id) => !dealtIds.has(id));
  // The bluff pool is the good characters NOT in play. The curated library
  // implements 11 good characters (8 townsfolk + Butler/Drunk/Saint), so a
  // game that happens to deal nearly all of them can leave goodPool with
  // fewer than 3 entries (or none). This degrades safely -- slice() never
  // throws, and applyChoice/renderForPlayer both handle a short or empty
  // bluffs array -- and stops mattering once the full 22-character script
  // exists.
  const bluffs = shuffle(goodPool).slice(0, 3);

  const minionList = minionSeats.map((s) => s.nickname).join(", ");
  return [{
    id: "reveal-minion-and-bluffs",
    label: `Reveal all Minions (${minionList}) and 3 bluffs`,
    truthful: true,
    payload: {
      minions: minionSeats.map((s) => ({ seatId: s.seatId, nickname: s.nickname, characterId: s.characterId })),
      bluffs,
    },
  }];
}

function renderForPlayer(payload) {
  const minionText = payload.minions
    .map((m) => `${m.nickname} (${m.characterId})`)
    .join(", ");
  return `Your Minion${payload.minions.length !== 1 ? "s are" : " is"} ${minionText}. Possible bluffs: ${payload.bluffs.join(", ")}.`;
}

module.exports = {
  id: "demon-info",
  team: null,
  night: { firstNight: true, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};

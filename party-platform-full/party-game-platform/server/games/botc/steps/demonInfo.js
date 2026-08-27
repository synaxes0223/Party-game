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
  const minionSeat = state.seats.find((s) => characters.teamOf(s.characterId) === "minion");
  if (!minionSeat) return [];

  const dealtIds = new Set(state.seats.map((s) => s.characterId));
  const goodPool = [
    ...characters.charactersOfTeam("townsfolk"),
    ...characters.charactersOfTeam("outsider"),
  ].filter((id) => !dealtIds.has(id));
  const bluffs = shuffle(goodPool).slice(0, 3);

  return [{
    id: "reveal-minion-and-bluffs",
    label: `Reveal the Minion (${minionSeat.nickname}) and 3 bluffs`,
    truthful: true,
    payload: {
      minion: { seatId: minionSeat.seatId, nickname: minionSeat.nickname, characterId: minionSeat.characterId },
      bluffs,
    },
  }];
}

function renderForPlayer(payload) {
  return `Your Minion is ${payload.minion.nickname} (${payload.minion.characterId}). Possible bluffs: ${payload.bluffs.join(", ")}.`;
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

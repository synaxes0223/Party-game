// minionInfo.js
// First-night pseudo-step: "the Minion learns the Demon." At 5-9 players
// there is exactly one Minion and one Demon, so this always has exactly one
// legal (truthful) outcome -- no false option exists, because nothing has
// had a chance to poison anyone yet in this plan's night order (Task 9 runs
// this before the Poisoner's own first action).

const characters = require("../characters");

function computeCandidates(state, seat) {
  const demon = state.seats.find((s) => characters.teamOf(s.characterId) === "demon");
  if (!demon) return [];
  return [{
    id: "reveal-demon",
    label: `Reveal the Demon: ${demon.nickname} (${demon.characterId})`,
    truthful: true,
    payload: { seatId: demon.seatId, nickname: demon.nickname, characterId: demon.characterId },
  }];
}

function renderForPlayer(payload) {
  return `Your Demon is ${payload.nickname} (${payload.characterId}).`;
}

module.exports = {
  id: "minion-info",
  team: null,
  night: { firstNight: true, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};

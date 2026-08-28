// empath.js
// "Each night, you learn how many of your 2 alive neighbours are evil."
// Every night, including the first. No player-driven choice -- the app
// computes the true count from the live seating; the Storyteller picks
// which of the three possible counts to send.

const stateModule = require("../state");
const grimoire = require("../grimoire");

function computeCandidates(state, seat) {
  const { left, right } = stateModule.aliveNeighborsOf(state, seat.seatId);
  if (!left || !right) return [];
  const trueCount = [left, right].filter((n) => grimoire.isEvilRegistering(n)).length;
  return [0, 1, 2].map((count) => ({
    id: `count-${count}`,
    label: count === trueCount ? `True: ${count} evil neighbour(s)` : `False: ${count} evil neighbour(s)`,
    truthful: count === trueCount,
    payload: { count },
  }));
}

function renderForPlayer(payload) {
  return `${payload.count} of your alive neighbours are evil.`;
}

module.exports = {
  id: "empath",
  team: "townsfolk",
  night: { firstNight: true, otherNights: true },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};

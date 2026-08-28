// chef.js
// "You start knowing how many pairs of evil players there are." First night
// only, no choice. "Pair" = two evil players in adjacent seats; adjacency
// wraps the circle, and a run of three evils counts as two pairs.

const grimoire = require("../grimoire");

function adjacentEvilPairs(state) {
  const seats = state.seats;
  const n = seats.length;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    const a = seats[i];
    const b = seats[(i + 1) % n];
    if (grimoire.isEvilRegistering(a) && grimoire.isEvilRegistering(b)) pairs++;
  }
  // A 2-seat game would double-count the single wrap pair; not a real
  // Blood on the Clocktower configuration (min 5), but guard anyway.
  return n === 2 ? Math.min(pairs, 1) : pairs;
}

function computeCandidates(state, seat) {
  const trueCount = adjacentEvilPairs(state);
  const maxPlausible = Math.max(3, trueCount);
  const counts = [];
  for (let c = 0; c <= maxPlausible; c++) counts.push(c);
  return counts.map((count) => ({
    id: `count-${count}`,
    label: count === trueCount ? `True: ${count} pair(s)` : `False: ${count} pair(s)`,
    truthful: count === trueCount,
    payload: { count },
  }));
}

function renderForPlayer(payload) {
  return `There are ${payload.count} pair(s) of evil players sitting next to each other.`;
}

module.exports = {
  id: "chef",
  team: "townsfolk",
  night: { firstNight: true, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};

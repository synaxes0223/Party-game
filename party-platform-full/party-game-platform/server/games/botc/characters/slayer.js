// slayer.js (character module)
// "Once per game, during the day, publicly choose a player: if they are the
// Demon, they die." No night step -- the day trigger lives in
// games/botc/slayer.js, wired by index.js.

module.exports = {
  id: "slayer",
  team: "townsfolk",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};

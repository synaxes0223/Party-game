// virgin.js (character module)
// "The first time you are nominated, if the nominator is a Townsfolk, they
// are executed immediately." No night step -- the day-phase trigger lives
// in games/botc/virgin.js, wired by index.js.

module.exports = {
  id: "virgin",
  team: "townsfolk",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};

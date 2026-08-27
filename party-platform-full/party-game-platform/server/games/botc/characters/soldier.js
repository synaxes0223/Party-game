// soldier.js
// "You are safe from the Demon." Purely passive -- there is no night step
// for the Soldier at all, so nightLoop.js never calls this module. The
// protection itself is read by imp.js via grimoire.isSafeFromDemon.

module.exports = {
  id: "soldier",
  team: "townsfolk",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};

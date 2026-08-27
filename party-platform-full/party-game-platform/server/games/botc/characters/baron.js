// baron.js
// "There are extra Outsiders in play." Purely a setup-time distribution
// modifier (see distribution.js's applyBaronModifier, invoked by whichever
// task-11 setup flow detects a dealt Baron) -- no night step at all.

module.exports = {
  id: "baron",
  team: "minion",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};

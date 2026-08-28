// saint.js
// "If you die by execution, your team loses." Passive -- no night step. The
// execution branch lives in winConditions.js, fed the executed seat id by
// index.js's host:botc-execute handler.

module.exports = {
  id: "saint",
  team: "outsider",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};

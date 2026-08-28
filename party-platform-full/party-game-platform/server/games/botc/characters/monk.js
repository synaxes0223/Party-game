// monk.js
// "Each night*, choose a player (not yourself): they are safe from the
// Demon tonight." A poisoned or drunk Monk protects nobody -- guarded here,
// the same way imp.js guards its kill. The 'protected' reminder lasts one
// night; nightLoop.startNight clears it, like 'poisoned'.

const stateModule = require("../state");
const grimoire = require("../grimoire");

function applyChoice(state, seat, choice) {
  if (grimoire.isImpaired(seat)) return;
  const target = stateModule.findSeatById(state, choice.targetSeatId);
  if (!target || target.seatId === seat.seatId) return;
  grimoire.addReminder(state, target, "protected", "monk", "Protected");
}

module.exports = {
  id: "monk",
  team: "townsfolk",
  night: { firstNight: false, otherNights: true },
  requiresChoice: () => ({ type: "select-one-player-excluding-self" }),
  applyChoice,
  computeCandidates: () => [],
  renderForPlayer: () => null,
};

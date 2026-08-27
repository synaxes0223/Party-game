// poisoner.js
// "Each night, choose a player: they are poisoned tonight and tomorrow
// day." The poison itself expires at the start of the *next* night --
// nightLoop.js clears every "poisoned" reminder across the room before
// running any step, so this module only ever needs to add one.

const stateModule = require("../state");
const grimoire = require("../grimoire");

function applyChoice(state, seat, choice) {
  const target = stateModule.findSeatById(state, choice.targetSeatId);
  if (!target) return;
  grimoire.addReminder(state, target, "poisoned", "poisoner", "Poisoned");
}

module.exports = {
  id: "poisoner",
  team: "minion",
  night: { firstNight: true, otherNights: true },
  requiresChoice: () => ({ type: "select-one-player" }),
  applyChoice,
  computeCandidates: () => [],
  renderForPlayer: () => null,
};

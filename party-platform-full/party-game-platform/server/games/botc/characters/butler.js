// butler.js
// "Each night, choose a player (not yourself): tomorrow, you may only vote
// if they are voting too." The master is stored as a targeted reminder on
// the Butler's own seat; voting.js reads it when tallying (Task 10), rather
// than the night loop needing to enforce anything mid-vote.

const stateModule = require("../state");
const grimoire = require("../grimoire");

function applyChoice(state, seat, choice) {
  grimoire.removeRemindersFrom(seat, "butler"); // clear last night's master, if any
  const master = stateModule.findSeatById(state, choice.targetSeatId);
  if (!master) return;
  grimoire.addReminder(state, seat, "custom", "butler", `Master: ${master.nickname}`, master.seatId);
}

module.exports = {
  id: "butler",
  team: "outsider",
  night: { firstNight: true, otherNights: true },
  requiresChoice: () => ({ type: "select-one-player-excluding-self" }),
  applyChoice,
  computeCandidates: () => [],
  renderForPlayer: () => null,
};

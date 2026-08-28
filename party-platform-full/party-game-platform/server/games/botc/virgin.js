// virgin.js
// "The first time you are nominated, if the nominator is a Townsfolk, they
// are executed immediately." The app never judges "is a Townsfolk" or "is
// the Virgin sober" -- index.js pauses on the nomination and the
// Storyteller confirms. This module is only the once-per-game bookkeeping.

const grimoire = require("./grimoire");

function isUnusedVirgin(seat) {
  return (
    seat.believedCharacterId === "virgin" &&
    !seat.reminders.some((r) => r.sourceCharacterId === "virgin" && r.kind === "used")
  );
}

function markUsed(state, seat) {
  if (isUnusedVirgin(seat)) grimoire.addReminder(state, seat, "used", "virgin", "Ability used");
}

module.exports = { isUnusedVirgin, markUsed };

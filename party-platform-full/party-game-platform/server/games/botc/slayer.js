// slayer.js
// "Once per game, during the day, publicly choose a player: if they are the
// Demon, they die." The Slayer's shot is public, so index.js accepts it
// from the Storyteller (host:botc-slayer-shot); the Storyteller confirms the
// kill because a drunk/poisoned Slayer's shot does nothing and the app
// cannot judge that.

const grimoire = require("./grimoire");

function isSlayer(seat) {
  return seat.believedCharacterId === "slayer";
}

function hasUsedShot(seat) {
  return seat.reminders.some((r) => r.sourceCharacterId === "slayer" && r.kind === "used");
}

function resolveShot(state, shooterSeat, targetSeat, killed) {
  if (shooterSeat && !hasUsedShot(shooterSeat)) {
    grimoire.addReminder(state, shooterSeat, "used", "slayer", "Shot used");
  }
  if (killed && targetSeat) grimoire.setAlive(targetSeat, false);
}

module.exports = { isSlayer, hasUsedShot, resolveShot };

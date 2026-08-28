// grimoire.js
// Reminders and the two derived-status checks every character consults
// instead of re-deriving poison/drunk logic itself, plus the Storyteller's
// manual-override primitives (spec's Governing Principle: everything the
// app computes is a suggestion, and any seat's character, alignment, life
// state and reminders can be edited at any time).

const stateModule = require("./state");

function isPoisoned(seat) {
  return seat.reminders.some((r) => r.kind === "poisoned");
}

// Poisoned, or believing they're a different character than they truly are
// (the Drunk's mechanism -- the scheduler wakes the Drunk as their believed
// character, and this check makes every character's computeCandidates treat
// that seat as unreliable).
function isImpaired(seat) {
  return isPoisoned(seat) || seat.characterId !== seat.believedCharacterId;
}

// Deliberately simple: no Recluse/Spy registration quirks exist in this
// plan's character set, so "evil" just means evil. Named generically so a
// future Recluse/Spy can change this function's body without changing any
// of its callers.
function isEvilRegistering(seat) {
  return seat.alignment === "evil";
}

function isSafeFromDemon(seat) {
  if (seat.reminders.some((r) => r.kind === "protected")) return true;
  return seat.characterId === "soldier" && !isImpaired(seat);
}

function addReminder(state, seat, kind, sourceCharacterId, label, targetSeatId = null) {
  const reminder = {
    id: stateModule.nextReminderId(state),
    kind,
    sourceCharacterId,
    label,
    targetSeatId,
  };
  seat.reminders.push(reminder);
  return reminder;
}

function removeReminder(seat, reminderId) {
  const index = seat.reminders.findIndex((r) => r.id === reminderId);
  if (index === -1) return false;
  seat.reminders.splice(index, 1);
  return true;
}

function removeRemindersFrom(seat, sourceCharacterId) {
  seat.reminders = seat.reminders.filter((r) => r.sourceCharacterId !== sourceCharacterId);
}

function removeRemindersOfKind(state, kind) {
  for (const seat of state.seats) {
    seat.reminders = seat.reminders.filter((r) => r.kind !== kind);
  }
}

function reorderSeats(state, orderedSeatIds) {
  if (orderedSeatIds.length !== state.seats.length) {
    return { error: "Seat list length mismatch." };
  }
  const bySeatId = new Map(state.seats.map((s) => [s.seatId, s]));
  const reordered = [];
  for (const id of orderedSeatIds) {
    const seat = bySeatId.get(id);
    if (!seat) return { error: `Unknown seat id: ${id}` };
    reordered.push(seat);
  }
  state.seats = reordered;
  return {};
}

function setCharacter(seat, characterId, alignment) {
  seat.characterId = characterId;
  seat.believedCharacterId = characterId;
  seat.alignment = alignment;
}

function setAlive(seat, alive) {
  seat.alive = alive;
}

// The Drunk must never go through setCharacter, which force-syncs
// believedCharacterId = characterId and would erase the split identity that
// isImpaired and nightLoop scheduling both depend on.
function setDrunk(seat, believedCharacterId) {
  seat.characterId = "drunk";
  seat.believedCharacterId = believedCharacterId;
  seat.alignment = "good";
}

module.exports = {
  isPoisoned,
  isImpaired,
  isEvilRegistering,
  isSafeFromDemon,
  addReminder,
  removeReminder,
  removeRemindersFrom,
  removeRemindersOfKind,
  reorderSeats,
  setCharacter,
  setAlive,
  setDrunk,
};

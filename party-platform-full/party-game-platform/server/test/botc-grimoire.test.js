const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const grimoire = require("../games/botc/grimoire");

function seededState(names) {
  const s = state.createInitialState();
  s.seats = names.map((n, i) => state.createSeat(i + 1, `tok-${n}`, n));
  return s;
}

test("a fresh seat is neither poisoned nor impaired", () => {
  const s = seededState(["Alice"]);
  const seat = s.seats[0];
  grimoire.setCharacter(seat, "empath", "good");
  assert.equal(grimoire.isPoisoned(seat), false);
  assert.equal(grimoire.isImpaired(seat), false);
});

test("addReminder with kind 'poisoned' makes isPoisoned and isImpaired true", () => {
  const s = seededState(["Alice"]);
  const seat = s.seats[0];
  grimoire.setCharacter(seat, "empath", "good");
  grimoire.addReminder(s, seat, "poisoned", "poisoner", "Poisoned");
  assert.equal(grimoire.isPoisoned(seat), true);
  assert.equal(grimoire.isImpaired(seat), true);
});

test("a seat whose believed character differs from its true character is impaired but not poisoned", () => {
  const s = seededState(["Alice"]);
  const seat = s.seats[0];
  seat.characterId = "empath";
  seat.believedCharacterId = "washerwoman"; // simulates a future Drunk
  assert.equal(grimoire.isPoisoned(seat), false);
  assert.equal(grimoire.isImpaired(seat), true);
});

test("isEvilRegistering reflects alignment directly", () => {
  const s = seededState(["Alice", "Bob"]);
  grimoire.setCharacter(s.seats[0], "imp", "evil");
  grimoire.setCharacter(s.seats[1], "empath", "good");
  assert.equal(grimoire.isEvilRegistering(s.seats[0]), true);
  assert.equal(grimoire.isEvilRegistering(s.seats[1]), false);
});

test("isSafeFromDemon is true only for an un-impaired Soldier", () => {
  const s = seededState(["Alice", "Bob", "Carol"]);
  grimoire.setCharacter(s.seats[0], "soldier", "good");
  grimoire.setCharacter(s.seats[1], "soldier", "good");
  grimoire.setCharacter(s.seats[2], "empath", "good");
  grimoire.addReminder(s, s.seats[1], "poisoned", "poisoner", "Poisoned");
  assert.equal(grimoire.isSafeFromDemon(s.seats[0]), true);
  assert.equal(grimoire.isSafeFromDemon(s.seats[1]), false, "a poisoned Soldier is not protected");
  assert.equal(grimoire.isSafeFromDemon(s.seats[2]), false, "only the Soldier is protected");
});

test("addReminder assigns unique, room-scoped ids and stores an optional targetSeatId", () => {
  const s = seededState(["Alice", "Bob"]);
  const r1 = grimoire.addReminder(s, s.seats[0], "custom", "butler", "Master: Bob", 2);
  const r2 = grimoire.addReminder(s, s.seats[0], "poisoned", "poisoner", "Poisoned");
  assert.equal(r1.id, 1);
  assert.equal(r1.targetSeatId, 2);
  assert.equal(r2.id, 2);
  assert.equal(r2.targetSeatId, null);
  assert.equal(s.seats[0].reminders.length, 2);
});

test("removeReminder removes exactly the matching reminder", () => {
  const s = seededState(["Alice"]);
  const seat = s.seats[0];
  const r1 = grimoire.addReminder(s, seat, "custom", "x", "one");
  grimoire.addReminder(s, seat, "custom", "x", "two");
  assert.equal(grimoire.removeReminder(seat, r1.id), true);
  assert.equal(seat.reminders.length, 1);
  assert.equal(seat.reminders[0].label, "two");
  assert.equal(grimoire.removeReminder(seat, 999), false);
});

test("removeRemindersFrom clears every reminder from one source, leaving others", () => {
  const s = seededState(["Alice"]);
  const seat = s.seats[0];
  grimoire.addReminder(s, seat, "custom", "butler", "Master: Bob");
  grimoire.addReminder(s, seat, "poisoned", "poisoner", "Poisoned");
  grimoire.removeRemindersFrom(seat, "butler");
  assert.equal(seat.reminders.length, 1);
  assert.equal(seat.reminders[0].sourceCharacterId, "poisoner");
});

test("removeRemindersOfKind clears that kind across every seat in the room", () => {
  const s = seededState(["Alice", "Bob"]);
  grimoire.addReminder(s, s.seats[0], "poisoned", "poisoner", "Poisoned");
  grimoire.addReminder(s, s.seats[1], "poisoned", "poisoner", "Poisoned");
  grimoire.addReminder(s, s.seats[1], "custom", "butler", "Master: Alice");
  grimoire.removeRemindersOfKind(s, "poisoned");
  assert.equal(s.seats[0].reminders.length, 0);
  assert.equal(s.seats[1].reminders.length, 1);
  assert.equal(s.seats[1].reminders[0].kind, "custom");
});

test("reorderSeats accepts a permutation and rejects an unknown or mismatched-length list", () => {
  const s = seededState(["Alice", "Bob", "Carol"]);
  const result = grimoire.reorderSeats(s, [3, 1, 2]);
  assert.equal(result.error, undefined);
  assert.deepEqual(s.seats.map((seat) => seat.nickname), ["Carol", "Alice", "Bob"]);

  const badLength = grimoire.reorderSeats(s, [1, 2]);
  assert.equal(typeof badLength.error, "string");

  const unknownId = grimoire.reorderSeats(s, [1, 2, 999]);
  assert.equal(typeof unknownId.error, "string");
});

test("setCharacter sets characterId, believedCharacterId and alignment together", () => {
  const s = seededState(["Alice"]);
  const seat = s.seats[0];
  grimoire.setCharacter(seat, "imp", "evil");
  assert.equal(seat.characterId, "imp");
  assert.equal(seat.believedCharacterId, "imp");
  assert.equal(seat.alignment, "evil");
});

test("setAlive toggles the alive flag", () => {
  const s = seededState(["Alice"]);
  const seat = s.seats[0];
  grimoire.setAlive(seat, false);
  assert.equal(seat.alive, false);
  grimoire.setAlive(seat, true);
  assert.equal(seat.alive, true);
});

test("isSafeFromDemon is true for a seat carrying a protected reminder", () => {
  const s = state.createInitialState();
  s.seats = [state.createSeat(1, "t1", "A")];
  dealing.dealManual(s, [{ seatId: 1, characterId: "empath" }]);
  assert.equal(grimoire.isSafeFromDemon(s.seats[0]), false);
  grimoire.addReminder(s, s.seats[0], "protected", "monk", "Protected");
  assert.equal(grimoire.isSafeFromDemon(s.seats[0]), true);
});

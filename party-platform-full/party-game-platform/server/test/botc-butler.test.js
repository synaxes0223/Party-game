const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const butler = require("../games/botc/characters/butler");

function seededState(names) {
  const s = state.createInitialState();
  s.seats = names.map((n, i) => state.createSeat(i + 1, `tok-${n}`, n));
  return s;
}

test("butler requires choosing one player, excluding themselves", () => {
  const s = seededState(["Alice", "Bob"]);
  assert.deepEqual(butler.requiresChoice(s, s.seats[0]), { type: "select-one-player-excluding-self" });
});

test("butler produces no candidates", () => {
  const s = seededState(["Alice", "Bob"]);
  assert.deepEqual(butler.computeCandidates(s, s.seats[0]), []);
});

test("applyChoice records the chosen master as a targeted reminder on the butler's own seat", () => {
  const s = seededState(["Alice", "Bob"]);
  butler.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  const reminder = s.seats[0].reminders.find((r) => r.sourceCharacterId === "butler");
  assert.ok(reminder);
  assert.equal(reminder.targetSeatId, 2);
  assert.match(reminder.label, /Bob/);
});

test("applyChoice on a later night replaces the previous master, not adds a second one", () => {
  const s = seededState(["Alice", "Bob", "Carol"]);
  butler.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  butler.applyChoice(s, s.seats[0], { targetSeatId: 3 });
  const masterReminders = s.seats[0].reminders.filter((r) => r.sourceCharacterId === "butler");
  assert.equal(masterReminders.length, 1);
  assert.equal(masterReminders[0].targetSeatId, 3);
});

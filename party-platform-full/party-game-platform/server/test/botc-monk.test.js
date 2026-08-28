const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const grimoire = require("../games/botc/grimoire");
const monk = require("../games/botc/characters/monk");
const imp = require("../games/botc/characters/imp");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("monk requires an excluding-self choice and acts only on other nights", () => {
  assert.deepEqual(monk.requiresChoice(), { type: "select-one-player-excluding-self" });
  assert.deepEqual(monk.night, { firstNight: false, otherNights: true });
});

test("applyChoice adds a 'protected' reminder to the target", () => {
  const s = dealtState([
    { nickname: "A", characterId: "monk" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "imp" },
  ]);
  monk.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  assert.ok(s.seats[1].reminders.some((r) => r.kind === "protected"));
});

test("a protected player survives the Imp's kill", () => {
  const s = dealtState([
    { nickname: "A", characterId: "monk" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "imp" },
  ]);
  monk.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  imp.applyChoice(s, s.seats[2], { targetSeatId: 2 });
  assert.equal(s.seats[1].alive, true);
});

test("a poisoned Monk's protection does nothing", () => {
  const s = dealtState([
    { nickname: "A", characterId: "monk" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "imp" },
  ]);
  grimoire.addReminder(s, s.seats[0], "poisoned", "poisoner", "Poisoned");
  monk.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  assert.equal(s.seats[1].reminders.some((r) => r.kind === "protected"), false);
  imp.applyChoice(s, s.seats[2], { targetSeatId: 2 });
  assert.equal(s.seats[1].alive, false);
});

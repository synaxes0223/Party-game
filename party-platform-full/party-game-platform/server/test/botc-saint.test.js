const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const winConditions = require("../games/botc/winConditions");
const saint = require("../games/botc/characters/saint");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("saint is passive", () => {
  assert.deepEqual(saint.night, { firstNight: false, otherNights: false });
});

test("executing the Saint hands the game to evil", () => {
  const s = dealtState([
    { nickname: "A", characterId: "saint" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "soldier" },
    { nickname: "D", characterId: "poisoner" },
    { nickname: "E", characterId: "imp" },
  ]);
  s.seats[0].alive = false; // just executed
  const verdict = winConditions.checkWinCondition(s, { executedSeatId: 1 });
  assert.deepEqual(verdict, { winner: "evil", reason: "The Saint was executed." });
});

test("the Saint dying at night (no executedSeatId) does NOT end the game for evil", () => {
  const s = dealtState([
    { nickname: "A", characterId: "saint" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "soldier" },
    { nickname: "D", characterId: "washerwoman" },
    { nickname: "E", characterId: "poisoner" },
    { nickname: "F", characterId: "imp" },
  ]);
  s.seats[0].alive = false;
  // 3 good vs 2 evil still alive, Demon alive -> no rule fires
  assert.equal(winConditions.checkWinCondition(s), null);
});

test("executing a non-Saint is unaffected by the new branch", () => {
  const s = dealtState([
    { nickname: "A", characterId: "saint" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "soldier" },
    { nickname: "D", characterId: "washerwoman" },
    { nickname: "E", characterId: "poisoner" },
    { nickname: "F", characterId: "imp" },
  ]);
  s.seats[1].alive = false; // a non-Saint good player executed
  // 3 good vs 2 evil still alive, Demon alive -> no other rule fires either
  assert.equal(winConditions.checkWinCondition(s, { executedSeatId: 2 }), null);
});

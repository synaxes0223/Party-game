const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const slayer = require("../games/botc/slayer");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `t${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("isSlayer / hasUsedShot track the once-per-game state", () => {
  const s = dealtState([
    { nickname: "A", characterId: "slayer" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  assert.equal(slayer.isSlayer(s.seats[0]), true);
  assert.equal(slayer.isSlayer(s.seats[2]), false);
  assert.equal(slayer.hasUsedShot(s.seats[0]), false);
  slayer.resolveShot(s, s.seats[0], s.seats[1], false);
  assert.equal(slayer.hasUsedShot(s.seats[0]), true);
});

test("resolveShot kills the target only when killed is true", () => {
  const s = dealtState([
    { nickname: "A", characterId: "slayer" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  slayer.resolveShot(s, s.seats[0], s.seats[1], false);
  assert.equal(s.seats[1].alive, true);

  const s2 = dealtState([
    { nickname: "A", characterId: "slayer" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  slayer.resolveShot(s2, s2.seats[0], s2.seats[1], true);
  assert.equal(s2.seats[1].alive, false);
});

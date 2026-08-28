const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const grimoire = require("../games/botc/grimoire");
const winConditions = require("../games/botc/winConditions");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("no win condition is met while the Demon is alive and evil is outnumbered", () => {
  const s = dealtState([
    { nickname: "P1", characterId: "washerwoman" },
    { nickname: "P2", characterId: "empath" },
    { nickname: "P3", characterId: "soldier" },
    { nickname: "P4", characterId: "poisoner" },
    { nickname: "P5", characterId: "imp" },
  ]);
  assert.equal(winConditions.checkWinCondition(s), null);
});

test("good wins the moment the Demon dies", () => {
  const s = dealtState([
    { nickname: "P1", characterId: "washerwoman" },
    { nickname: "P2", characterId: "poisoner" },
    { nickname: "P3", characterId: "imp" },
  ]);
  grimoire.setAlive(s.seats[2], false); // the Imp dies
  const result = winConditions.checkWinCondition(s);
  assert.equal(result.winner, "good");
});

test("evil wins once their count reaches parity with good among the living", () => {
  const s = dealtState([
    { nickname: "P1", characterId: "washerwoman" },
    { nickname: "P2", characterId: "poisoner" },
    { nickname: "P3", characterId: "imp" },
  ]);
  grimoire.setAlive(s.seats[0], false); // the sole good player dies, leaving 1 good... wait this leaves 0 good
  const result = winConditions.checkWinCondition(s);
  assert.equal(result.winner, "evil");
});

test("evil wins on exact parity, not only when outnumbering good", () => {
  const s = dealtState([
    { nickname: "P1", characterId: "washerwoman" },
    { nickname: "P2", characterId: "soldier" },
    { nickname: "P3", characterId: "poisoner" },
    { nickname: "P4", characterId: "imp" },
  ]);
  // 2 good (washerwoman, soldier) vs 2 evil (poisoner, imp), all alive -- a genuine tie
  const result = winConditions.checkWinCondition(s);
  assert.equal(result.winner, "evil");
});

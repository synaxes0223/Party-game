const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const grimoire = require("../games/botc/grimoire");
const ft = require("../games/botc/characters/fortuneTeller");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("before a choice is stored, requiresChoice asks for two players and computeCandidates is empty", () => {
  const s = dealtState([
    { nickname: "A", characterId: "fortuneTeller" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  assert.deepEqual(ft.requiresChoice(s, s.seats[0]), { type: "select-two-players" });
  assert.deepEqual(ft.computeCandidates(s, s.seats[0]), []);
});

test("after applyChoice stores the pair, requiresChoice is null and two yes/no candidates appear", () => {
  const s = dealtState([
    { nickname: "A", characterId: "fortuneTeller" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  ft.applyChoice(s, s.seats[0], { targetSeatIds: [2, 3] });
  assert.equal(ft.requiresChoice(s, s.seats[0]), null);
  const cands = ft.computeCandidates(s, s.seats[0]);
  assert.equal(cands.length, 2);
  const yes = cands.find((c) => c.payload.demon === true);
  assert.equal(yes.truthful, true, "one of the pair IS the Demon, so 'yes' is the true candidate");
});

test("the red herring makes a 'yes' truthful even when neither pick is the Demon", () => {
  const s = dealtState([
    { nickname: "A", characterId: "fortuneTeller" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "soldier" },
    { nickname: "D", characterId: "imp" },
  ]);
  grimoire.addReminder(s, s.seats[1], "red-herring", "fortuneTeller", "Red herring");
  ft.applyChoice(s, s.seats[0], { targetSeatIds: [2, 3] }); // B (red herring) + C (nobody)
  const yes = ft.computeCandidates(s, s.seats[0]).find((c) => c.payload.demon === true);
  assert.equal(yes.truthful, true);
});

test("renderForPlayer yields a yes/no phrase from the payload alone", () => {
  assert.match(ft.renderForPlayer({ demon: true }), /yes/i);
  assert.match(ft.renderForPlayer({ demon: false }), /no/i);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const empath = require("../games/botc/characters/empath");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("empath never requires a player-driven choice", () => {
  const s = dealtState([{ nickname: "Alice", characterId: "empath" }, { nickname: "Bob", characterId: "imp" }, { nickname: "Carol", characterId: "soldier" }]);
  assert.equal(empath.requiresChoice(s, s.seats[0]), null);
});

test("computeCandidates returns exactly three candidates, one per count, with the true one correctly identified", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "empath" },
    { nickname: "Bob", characterId: "imp" }, // evil neighbour
    { nickname: "Carol", characterId: "soldier" }, // good neighbour
  ]);
  const candidates = empath.computeCandidates(s, s.seats[0]);
  assert.equal(candidates.length, 3);
  const truthful = candidates.filter((c) => c.truthful);
  assert.equal(truthful.length, 1);
  assert.equal(truthful[0].payload.count, 1); // exactly one of the two neighbours (Bob) is evil
});

test("computeCandidates counts zero evil neighbours correctly", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "empath" },
    { nickname: "Bob", characterId: "soldier" },
    { nickname: "Carol", characterId: "washerwoman" },
  ]);
  const candidates = empath.computeCandidates(s, s.seats[0]);
  const truthful = candidates.find((c) => c.truthful);
  assert.equal(truthful.payload.count, 0);
});

test("computeCandidates uses alive neighbours, skipping a dead adjacent seat", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "empath" },
    { nickname: "Bob", characterId: "imp" },
    { nickname: "Carol", characterId: "soldier" },
    { nickname: "Dave", characterId: "poisoner" },
  ]);
  s.seats[1].alive = false; // Bob (imp, evil) is dead
  // Alice's alive neighbours are now Dave (left, wrapping) and Carol (right)
  const candidates = empath.computeCandidates(s, s.seats[0]);
  const truthful = candidates.find((c) => c.truthful);
  assert.equal(truthful.payload.count, 1); // Dave (poisoner, evil) counts; Carol (soldier, good) doesn't
});

test("renderForPlayer states the count from payload alone", () => {
  assert.equal(empath.renderForPlayer({ count: 2 }), "2 of your alive neighbours are evil.");
});

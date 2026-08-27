const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const grimoire = require("../games/botc/grimoire");
const poisoner = require("../games/botc/characters/poisoner");

function seededState(names) {
  const s = state.createInitialState();
  s.seats = names.map((n, i) => state.createSeat(i + 1, `tok-${n}`, n));
  return s;
}

test("poisoner requires choosing one player", () => {
  const s = seededState(["Alice", "Bob"]);
  assert.deepEqual(poisoner.requiresChoice(s, s.seats[0]), { type: "select-one-player" });
});

test("poisoner produces no candidates -- applyChoice does the work directly", () => {
  const s = seededState(["Alice", "Bob"]);
  assert.deepEqual(poisoner.computeCandidates(s, s.seats[0]), []);
});

test("applyChoice adds a poisoned reminder to the target seat", () => {
  const s = seededState(["Alice", "Bob"]);
  poisoner.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  assert.equal(grimoire.isPoisoned(s.seats[1]), true);
  assert.equal(grimoire.isPoisoned(s.seats[0]), false);
});

test("applyChoice can target the poisoner's own seat", () => {
  const s = seededState(["Alice", "Bob"]);
  poisoner.applyChoice(s, s.seats[0], { targetSeatId: 1 });
  assert.equal(grimoire.isPoisoned(s.seats[0]), true);
});

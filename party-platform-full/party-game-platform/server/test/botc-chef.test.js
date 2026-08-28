const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const chef = require("../games/botc/characters/chef");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("chef never requires a choice and is a first-night-only character", () => {
  assert.equal(chef.requiresChoice(), null);
  assert.equal(chef.night.firstNight, true);
  assert.equal(chef.night.otherNights, false);
});

test("computeCandidates true count is the number of adjacent evil pairs, wrapping the circle", () => {
  // seats: Chef, Poisoner(evil), Imp(evil), good, good  -> Poisoner+Imp adjacent = 1 pair
  const s = dealtState([
    { nickname: "A", characterId: "chef" },
    { nickname: "B", characterId: "poisoner" },
    { nickname: "C", characterId: "imp" },
    { nickname: "D", characterId: "empath" },
    { nickname: "E", characterId: "soldier" },
  ]);
  const truthful = chef.computeCandidates(s, s.seats[0]).filter((c) => c.truthful);
  assert.equal(truthful.length, 1);
  assert.equal(truthful[0].payload.count, 1);
});

test("computeCandidates counts zero when the two evil players are not adjacent", () => {
  const s = dealtState([
    { nickname: "A", characterId: "poisoner" }, // evil
    { nickname: "B", characterId: "chef" },
    { nickname: "C", characterId: "imp" },       // evil, not adjacent to A (B is between; E wraps to A)
    { nickname: "D", characterId: "empath" },
    { nickname: "E", characterId: "soldier" },
  ]);
  const chefSeat = s.seats[1];
  const truthful = chef.computeCandidates(s, chefSeat).find((c) => c.truthful);
  assert.equal(truthful.payload.count, 0);
});

test("computeCandidates offers false counts alongside the true one", () => {
  const s = dealtState([
    { nickname: "A", characterId: "chef" },
    { nickname: "B", characterId: "poisoner" },
    { nickname: "C", characterId: "imp" },
  ]);
  const candidates = chef.computeCandidates(s, s.seats[0]);
  assert.ok(candidates.some((c) => !c.truthful), "at least one false candidate");
  assert.ok(candidates.every((c) => typeof c.payload.count === "number"));
});

test("renderForPlayer states the pair count from the payload alone", () => {
  assert.match(chef.renderForPlayer({ count: 2 }), /2/);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const librarian = require("../games/botc/characters/librarian");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("computeCandidates truthfully names an in-play Outsider", () => {
  const s = dealtState([
    { nickname: "A", characterId: "librarian" },
    { nickname: "B", characterId: "butler" },   // outsider
    { nickname: "C", characterId: "empath" },
    { nickname: "D", characterId: "poisoner" },
    { nickname: "E", characterId: "imp" },
  ]);
  const truthful = librarian.computeCandidates(s, s.seats[0]).filter((c) => c.truthful);
  assert.ok(truthful.some((c) => c.payload.characterId === "butler"));
  assert.ok(truthful.every((c) => !c.payload.none || c.truthful === false));
});

test("computeCandidates truthful candidate is 'no Outsiders' when none were dealt", () => {
  const s = dealtState([
    { nickname: "A", characterId: "librarian" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "soldier" },
    { nickname: "D", characterId: "poisoner" },
    { nickname: "E", characterId: "imp" },
  ]);
  const truthful = librarian.computeCandidates(s, s.seats[0]).filter((c) => c.truthful);
  assert.equal(truthful.length, 1);
  assert.equal(truthful[0].payload.none, true);
});

test("a 'no Outsiders' false candidate exists when an Outsider IS in play", () => {
  const s = dealtState([
    { nickname: "A", characterId: "librarian" },
    { nickname: "B", characterId: "butler" },
    { nickname: "C", characterId: "imp" },
  ]);
  const c = librarian.computeCandidates(s, s.seats[0]).find((x) => x.payload.none);
  assert.equal(c.truthful, false);
});

test("renderForPlayer handles both the named and the none payloads", () => {
  assert.match(librarian.renderForPlayer({ characterId: "butler", shown: [{ seatId: 2, nickname: "B" }, { seatId: 3, nickname: "C" }] }), /butler/);
  assert.match(librarian.renderForPlayer({ none: true }), /no Outsiders/i);
});

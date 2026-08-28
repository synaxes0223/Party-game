const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const investigator = require("../games/botc/characters/investigator");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("investigator is a first-night-only info character with no choice", () => {
  assert.equal(investigator.requiresChoice(), null);
  assert.deepEqual(investigator.night, { firstNight: true, otherNights: false });
});

test("computeCandidates has a truthful candidate naming the real Minion, never showing the Investigator", () => {
  const s = dealtState([
    { nickname: "A", characterId: "investigator" },
    { nickname: "B", characterId: "poisoner" },
    { nickname: "C", characterId: "empath" },
    { nickname: "D", characterId: "soldier" },
    { nickname: "E", characterId: "imp" },
  ]);
  const truthful = investigator.computeCandidates(s, s.seats[0]).filter((c) => c.truthful);
  assert.ok(truthful.length > 0);
  for (const c of truthful) {
    assert.equal(c.payload.characterId, "poisoner");
    const shownIds = c.payload.shown.map((p) => p.seatId);
    assert.ok(shownIds.includes(2), "the real Poisoner (seat 2) is one of the two shown");
    assert.ok(!shownIds.includes(1), "never shows the Investigator herself");
  }
});

test("computeCandidates offers false candidates naming a Minion not in play (e.g. baron)", () => {
  const s = dealtState([
    { nickname: "A", characterId: "investigator" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "poisoner" },
  ]);
  const falseIds = investigator.computeCandidates(s, s.seats[0]).filter((c) => !c.truthful).map((c) => c.payload.characterId);
  assert.ok(falseIds.includes("baron"));
});

test("renderForPlayer names both shown players and the Minion character", () => {
  const text = investigator.renderForPlayer({ characterId: "poisoner", shown: [{ seatId: 2, nickname: "B" }, { seatId: 3, nickname: "C" }] });
  assert.match(text, /B/);
  assert.match(text, /C/);
  assert.match(text, /poisoner/);
});

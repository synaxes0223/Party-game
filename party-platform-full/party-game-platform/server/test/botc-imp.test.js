const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const grimoire = require("../games/botc/grimoire");
const dealing = require("../games/botc/dealing");
const imp = require("../games/botc/characters/imp");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("imp requires choosing one player and never acts on the first night", () => {
  const s = dealtState([{ nickname: "Alice", characterId: "imp" }, { nickname: "Bob", characterId: "soldier" }]);
  assert.equal(imp.night.firstNight, false);
  assert.equal(imp.night.otherNights, true);
  assert.deepEqual(imp.requiresChoice(s, s.seats[0]), { type: "select-one-player" });
});

test("applyChoice kills a non-Soldier target", () => {
  const s = dealtState([{ nickname: "Alice", characterId: "imp" }, { nickname: "Bob", characterId: "washerwoman" }]);
  imp.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  assert.equal(s.seats[1].alive, false);
});

test("applyChoice does not kill an un-impaired Soldier", () => {
  const s = dealtState([{ nickname: "Alice", characterId: "imp" }, { nickname: "Bob", characterId: "soldier" }]);
  imp.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  assert.equal(s.seats[1].alive, true);
});

test("applyChoice does kill a poisoned (impaired) Soldier", () => {
  const s = dealtState([{ nickname: "Alice", characterId: "imp" }, { nickname: "Bob", characterId: "soldier" }]);
  grimoire.addReminder(s, s.seats[1], "poisoned", "poisoner", "Poisoned");
  imp.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  assert.equal(s.seats[1].alive, false);
});

test("a self-kill promotes the sole alive Minion to Imp", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "imp" },
    { nickname: "Bob", characterId: "poisoner" },
    { nickname: "Carol", characterId: "washerwoman" },
  ]);
  imp.applyChoice(s, s.seats[0], { targetSeatId: 1 }); // Alice targets herself
  assert.equal(s.seats[0].alive, false);
  assert.equal(s.seats[1].characterId, "imp", "the Poisoner becomes the new Imp");
  assert.equal(s.seats[1].alignment, "evil");
});

test("a self-kill with no alive Minion promotes nobody", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "imp" },
    { nickname: "Bob", characterId: "poisoner" },
    { nickname: "Carol", characterId: "washerwoman" },
  ]);
  s.seats[1].alive = false; // the only Minion is already dead
  imp.applyChoice(s, s.seats[0], { targetSeatId: 1 });
  assert.equal(s.seats[0].alive, false);
  assert.equal(s.seats[1].characterId, "poisoner", "no promotion when no Minion is alive");
});

test("computeCandidates and renderForPlayer are contract-complete no-ops", () => {
  const s = dealtState([{ nickname: "Alice", characterId: "imp" }, { nickname: "Bob", characterId: "soldier" }]);
  assert.deepEqual(imp.computeCandidates(s, s.seats[0]), []);
  assert.equal(imp.renderForPlayer(null), null);
});

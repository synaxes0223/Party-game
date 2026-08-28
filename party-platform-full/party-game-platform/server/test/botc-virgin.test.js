const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const virgin = require("../games/botc/virgin");

function seatWith(believedCharacterId) {
  const seat = state.createSeat(1, "t1", "V");
  seat.characterId = believedCharacterId;
  seat.believedCharacterId = believedCharacterId;
  seat.alignment = "good";
  return seat;
}

test("isUnusedVirgin is true for a fresh Virgin and false once markUsed runs", () => {
  const s = state.createInitialState();
  const seat = seatWith("virgin");
  s.seats = [seat];
  assert.equal(virgin.isUnusedVirgin(seat), true);
  virgin.markUsed(s, seat);
  assert.equal(virgin.isUnusedVirgin(seat), false);
});

test("isUnusedVirgin is false for a non-Virgin and true for a Drunk who believes they are the Virgin", () => {
  assert.equal(virgin.isUnusedVirgin(seatWith("empath")), false);
  const drunk = state.createSeat(2, "t2", "D");
  drunk.characterId = "drunk";
  drunk.believedCharacterId = "virgin";
  drunk.alignment = "good";
  assert.equal(virgin.isUnusedVirgin(drunk), true);
});

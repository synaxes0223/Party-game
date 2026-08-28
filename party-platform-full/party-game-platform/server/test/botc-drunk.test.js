const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const grimoire = require("../games/botc/grimoire");
const dealing = require("../games/botc/dealing");
const drunk = require("../games/botc/characters/drunk");

test("drunk has no night step", () => {
  assert.deepEqual(drunk.night, { firstNight: false, otherNights: false });
  assert.equal(drunk.requiresChoice(), null);
});

test("setDrunk creates the split identity and marks the seat impaired", () => {
  const seat = state.createSeat(1, "t1", "A");
  grimoire.setDrunk(seat, "empath");
  assert.equal(seat.characterId, "drunk");
  assert.equal(seat.believedCharacterId, "empath");
  assert.equal(seat.alignment, "good");
  assert.equal(grimoire.isImpaired(seat), true);
});

test("dealManual routes a drunk assignment through setDrunk using believedCharacterId", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  const res = dealing.dealManual(s, [
    { seatId: 1, characterId: "drunk", believedCharacterId: "soldier" },
    { seatId: 2, characterId: "imp" },
  ]);
  assert.equal(res.error, undefined);
  assert.equal(s.seats[0].characterId, "drunk");
  assert.equal(s.seats[0].believedCharacterId, "soldier");
});

test("dealManual rejects a drunk assignment with no believedCharacterId", () => {
  const s = state.createInitialState();
  s.seats = [state.createSeat(1, "t1", "A")];
  const res = dealing.dealManual(s, [{ seatId: 1, characterId: "drunk" }]);
  assert.match(res.error, /believed/i);
});

test("dealRandom gives a dealt Drunk a believed Townsfolk that is not in play", () => {
  const s = state.createInitialState();
  s.seats = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  // Deal all three outsiders (Butler, Drunk, Saint), so the Drunk is ALWAYS dealt.
  const res = dealing.dealRandom(s, { townsfolk: 3, outsiders: 3, minions: 1, demon: 1 });
  assert.equal(res.error, undefined);
  const drunkSeat = s.seats.find((seat) => seat.characterId === "drunk");
  assert.ok(drunkSeat, "the Drunk is always dealt when all three outsiders are");
  // believed character must be a townsfolk id, and must not be a real dealt character
  const dealtReal = new Set(s.seats.map((seat) => seat.characterId));
  assert.equal(require("../games/botc/characters").teamOf(drunkSeat.believedCharacterId), "townsfolk");
  assert.equal(dealtReal.has(drunkSeat.believedCharacterId), false);
});

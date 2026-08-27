const test = require("node:test");
const assert = require("node:assert/strict");
const soldier = require("../games/botc/characters/soldier");

test("soldier has no night step and produces no candidates", () => {
  assert.equal(soldier.night.firstNight, false);
  assert.equal(soldier.night.otherNights, false);
  assert.equal(soldier.requiresChoice(null, null), null);
  assert.deepEqual(soldier.computeCandidates(null, null), []);
  assert.equal(soldier.renderForPlayer(null), null);
});

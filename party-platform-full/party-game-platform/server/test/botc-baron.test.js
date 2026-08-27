const test = require("node:test");
const assert = require("node:assert/strict");
const baron = require("../games/botc/characters/baron");

test("baron has no night step and produces no candidates -- its effect is entirely in dealing/distribution", () => {
  assert.equal(baron.night.firstNight, false);
  assert.equal(baron.night.otherNights, false);
  assert.equal(baron.requiresChoice(null, null), null);
  assert.deepEqual(baron.computeCandidates(null, null), []);
  assert.equal(baron.renderForPlayer(null), null);
});

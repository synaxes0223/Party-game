const test = require("node:test");
const assert = require("node:assert/strict");
const distribution = require("../games/botc/distribution");

test("baseDistributionFor returns the table entry for a supported player count", () => {
  assert.deepEqual(distribution.baseDistributionFor(7), { townsfolk: 5, outsiders: 0, minions: 1, demon: 1 });
});

test("baseDistributionFor returns null outside the supported range", () => {
  assert.equal(distribution.baseDistributionFor(4), null);
  assert.equal(distribution.baseDistributionFor(16), null);
});

test("applyBaronModifier trades 2 Townsfolk for 2 Outsiders without touching minions/demon", () => {
  const base = distribution.baseDistributionFor(7); // 5/0/1/1
  const withBaron = distribution.applyBaronModifier(base);
  assert.deepEqual(withBaron, { townsfolk: 3, outsiders: 2, minions: 1, demon: 1 });
});

test("checkDistribution returns null when the dealt set matches exactly", () => {
  const result = distribution.checkDistribution(7, { townsfolk: 5, outsiders: 0, minions: 1, demon: 1 }, false);
  assert.equal(result, null);
});

test("checkDistribution reports every mismatched team", () => {
  const result = distribution.checkDistribution(7, { townsfolk: 4, outsiders: 1, minions: 1, demon: 1 }, false);
  assert.match(result, /townsfolk: expected 5, got 4/);
  assert.match(result, /outsiders: expected 0, got 1/);
});

test("checkDistribution applies the Baron modifier before comparing when baronInPlay is true", () => {
  const result = distribution.checkDistribution(7, { townsfolk: 3, outsiders: 2, minions: 1, demon: 1 }, true);
  assert.equal(result, null);
});

test("checkDistribution never blocks -- it always returns a string or null, never throws, for an out-of-range count", () => {
  const result = distribution.checkDistribution(3, { townsfolk: 1, outsiders: 0, minions: 1, demon: 1 }, false);
  assert.equal(typeof result, "string");
});

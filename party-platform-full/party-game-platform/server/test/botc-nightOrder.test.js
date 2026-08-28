const test = require("node:test");
const assert = require("node:assert/strict");
const nightOrder = require("../games/botc/nightOrder");

const ALL_STEPS = new Set([
  "minion-info", "demon-info",
  "poisoner", "washerwoman", "librarian", "investigator", "chef",
  "empath", "fortuneTeller", "butler", "monk", "imp",
]);

test("first-night order lists minion-info and demon-info before any character step", () => {
  const o = nightOrder.FIRST_NIGHT_ORDER;
  assert.equal(o[0], "minion-info");
  assert.equal(o[1], "demon-info");
  const firstCharacterIndex = o.findIndex((s) => s !== "minion-info" && s !== "demon-info");
  assert.equal(o[firstCharacterIndex], "poisoner", "the Poisoner acts before the info Townsfolk");
});

test("first-night order includes every first-night character exactly once", () => {
  const o = nightOrder.FIRST_NIGHT_ORDER;
  for (const step of ["poisoner", "washerwoman", "librarian", "investigator", "chef", "empath", "fortuneTeller", "butler"]) {
    assert.equal(o.filter((s) => s === step).length, 1, `${step} appears exactly once`);
  }
  assert.ok(!o.includes("monk"), "the Monk has no first-night action");
  assert.ok(!o.includes("imp"), "the Imp does not kill on the first night");
});

test("other-nights order runs Poisoner, then Monk, then Imp, then the recurring info characters", () => {
  const o = nightOrder.OTHER_NIGHTS_ORDER;
  assert.ok(o.indexOf("poisoner") < o.indexOf("monk"), "Poisoner before Monk");
  assert.ok(o.indexOf("monk") < o.indexOf("imp"), "Monk before the Imp's kill");
  assert.ok(o.indexOf("imp") < o.indexOf("empath"), "Imp before the Empath re-reads");
  assert.ok(o.includes("fortuneTeller"), "the Fortune Teller acts every night");
  assert.ok(!o.includes("washerwoman"), "the Washerwoman is first-night only");
});

test("every step id is a known character or pseudo-step", () => {
  for (const step of [...nightOrder.FIRST_NIGHT_ORDER, ...nightOrder.OTHER_NIGHTS_ORDER]) {
    assert.ok(ALL_STEPS.has(step), `unknown step id: ${step}`);
  }
});

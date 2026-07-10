const test = require("node:test");
const assert = require("node:assert/strict");
const { WORD_PAIRS, pickAutoPair, buildCustomPair } = require("../games/wordPairLogic");

test("WORD_PAIRS has at least 30 distinct curated pairs", () => {
  assert.ok(WORD_PAIRS.length >= 30);
  WORD_PAIRS.forEach((p) => {
    assert.ok(p.normal && p.imposter);
    assert.notEqual(p.normal.toLowerCase(), p.imposter.toLowerCase());
  });
});

test("pickAutoPair cycles through a small pool without repeats before resetting", () => {
  const pool = [
    { normal: "A", imposter: "B" },
    { normal: "C", imposter: "D" },
  ];
  let used = new Set();
  const seenIndexes = [];

  const first = pickAutoPair(pool, used);
  seenIndexes.push(first.index);
  used = first.usedIndexes;

  const second = pickAutoPair(pool, used);
  seenIndexes.push(second.index);
  used = second.usedIndexes;

  assert.deepEqual(new Set(seenIndexes), new Set([0, 1]), "both pairs should be used once before any repeat");
  assert.equal(used.size, 2);

  // Pool is now exhausted -- the next pick must reset and may reuse an index.
  const third = pickAutoPair(pool, used);
  assert.ok([0, 1].includes(third.index));
  assert.equal(third.usedIndexes.size, 1);
});

test("pickAutoPair never mutates the usedIndexes set passed in", () => {
  const pool = [{ normal: "A", imposter: "B" }, { normal: "C", imposter: "D" }];
  const used = new Set([0]);
  pickAutoPair(pool, used);
  assert.deepEqual(used, new Set([0]));
});

test("buildCustomPair rejects an empty or whitespace-only word", () => {
  assert.equal(buildCustomPair("", "Tea").error, "Both words are required.");
  assert.equal(buildCustomPair("Coffee", "   ").error, "Both words are required.");
});

test("buildCustomPair rejects identical words (case/whitespace-insensitive)", () => {
  const result = buildCustomPair("Coffee", " coffee ");
  assert.equal(result.error, "The two words must be different.");
});

test("buildCustomPair returns a trimmed normal/imposter pair for valid distinct words", () => {
  const result = buildCustomPair(" Coffee ", "Tea");
  assert.deepEqual(result, { normal: { word: "Coffee" }, imposter: { word: "Tea" } });
});

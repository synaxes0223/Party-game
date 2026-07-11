const test = require("node:test");
const assert = require("node:assert/strict");
const { pickFromPack, validateSubmission, drawNext } = require("../games/promptLogic");

const POOL = [
  { text: "chill A", spice: 1 },
  { text: "chill B", spice: 1 },
  { text: "spicy A", spice: 2 },
  { text: "extreme A", spice: 3 },
];

test("pickFromPack only returns entries at or below maxSpice", () => {
  const seen = new Set();
  let used = new Set();
  for (let i = 0; i < 20; i++) {
    const result = pickFromPack(POOL, used, 1);
    assert.ok(result.prompt.spice <= 1);
    seen.add(result.prompt.text);
    used = result.usedIndexes;
  }
  assert.deepEqual(seen, new Set(["chill A", "chill B"]));
});

test("pickFromPack cycles the eligible pool without repeats before resetting", () => {
  let used = new Set();
  const seenIndexes = [];
  const first = pickFromPack(POOL, used, 1);
  seenIndexes.push(first.index);
  used = first.usedIndexes;
  const second = pickFromPack(POOL, used, 1);
  seenIndexes.push(second.index);
  used = second.usedIndexes;

  assert.deepEqual(new Set(seenIndexes), new Set([0, 1]));
  assert.equal(used.size, 2);

  const third = pickFromPack(POOL, used, 1);
  assert.ok([0, 1].includes(third.index));
  assert.equal(third.usedIndexes.size, 1);
});

test("pickFromPack never mutates the usedIndexes set passed in", () => {
  const used = new Set([0]);
  pickFromPack(POOL, used, 3);
  assert.deepEqual(used, new Set([0]));
});

test("pickFromPack returns an error when no entry is at or below maxSpice", () => {
  const result = pickFromPack([{ text: "x", spice: 3 }], new Set(), 1);
  assert.ok(result.error);
});

test("validateSubmission rejects empty or whitespace-only text", () => {
  assert.equal(validateSubmission("").error, "Prompt text is required.");
  assert.equal(validateSubmission("   ").error, "Prompt text is required.");
});

test("validateSubmission rejects text over 200 chars", () => {
  const result = validateSubmission("a".repeat(201));
  assert.ok(result.error);
});

test("validateSubmission trims and accepts valid text", () => {
  const result = validateSubmission("  hello world  ");
  assert.deepEqual(result, { text: "hello world" });
});

test("drawNext drains the queue first, FIFO", () => {
  const queue = [
    { text: "player one", spice: 2, source: "player", authorId: "p1" },
    { text: "player two", spice: 1, source: "player", authorId: "p2" },
  ];
  const first = drawNext(queue, POOL, new Set(), 3);
  assert.equal(first.prompt.text, "player one");
  assert.equal(first.nextQueue.length, 1);

  const second = drawNext(first.nextQueue, POOL, first.usedIndexes, 3);
  assert.equal(second.prompt.text, "player two");
  assert.equal(second.nextQueue.length, 0);
});

test("drawNext falls back to the pack once the queue is empty", () => {
  const result = drawNext([], POOL, new Set(), 3);
  assert.equal(result.prompt.source, "pack");
  assert.ok(result.prompt.text);
});

test("drawNext does not mutate the queue array passed in", () => {
  const queue = [{ text: "only one", spice: 1, source: "player" }];
  drawNext(queue, POOL, new Set(), 3);
  assert.equal(queue.length, 1);
});

test("drawNext propagates a pack error when the queue is empty and no eligible prompt exists", () => {
  const result = drawNext([], [{ text: "x", spice: 3 }], new Set(), 1);
  assert.ok(result.error);
});

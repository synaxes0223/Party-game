const test = require("node:test");
const assert = require("node:assert/strict");
const { BUILTIN_ENTRIES, buildPool, dealAssignments, reassignOne } = require("../games/slipUpLogic");

test("BUILTIN_ENTRIES has at least 30 entries, each with id/type/text", () => {
  assert.ok(BUILTIN_ENTRIES.length >= 30);
  BUILTIN_ENTRIES.forEach((e) => {
    assert.equal(typeof e.id, "string");
    assert.ok(e.type === "word" || e.type === "action");
    assert.equal(typeof e.text, "string");
    assert.ok(e.text.length > 0);
  });
});

test("buildPool with no exclusions and no custom entries returns all builtins", () => {
  const result = buildPool([], []);
  assert.equal(result.pool.length, BUILTIN_ENTRIES.length);
});

test("buildPool excludes the given built-in ids", () => {
  const excludeId = BUILTIN_ENTRIES[0].id;
  const result = buildPool([excludeId], []);
  assert.equal(result.pool.length, BUILTIN_ENTRIES.length - 1);
  assert.ok(!result.pool.some((e) => e.id === excludeId));
});

test("buildPool appends valid custom entries with generated ids", () => {
  const result = buildPool([], [{ type: "action", text: "juggle three oranges" }]);
  const custom = result.pool.find((e) => e.text === "juggle three oranges");
  assert.ok(custom);
  assert.equal(custom.type, "action");
  assert.equal(typeof custom.id, "string");
  assert.notEqual(custom.id, "");
});

test("buildPool defaults a custom entry's type to word when type is missing or invalid", () => {
  const result = buildPool([], [{ text: "say the alphabet backwards" }]);
  const custom = result.pool.find((e) => e.text === "say the alphabet backwards");
  assert.equal(custom.type, "word");
});

test("buildPool errors on an empty custom entry text", () => {
  const result = buildPool([], [{ type: "word", text: "   " }]);
  assert.match(result.error, /non-empty text/);
});

test("buildPool errors on a custom entry duplicating an included built-in (case-insensitive)", () => {
  const existing = BUILTIN_ENTRIES[0];
  const result = buildPool([], [{ type: existing.type, text: existing.text.toUpperCase() }]);
  assert.match(result.error, /Duplicate entry/);
});

test("buildPool allows a custom entry that duplicates an EXCLUDED built-in's text", () => {
  const excluded = BUILTIN_ENTRIES[0];
  const result = buildPool([excluded.id], [{ type: excluded.type, text: excluded.text }]);
  assert.equal(result.error, undefined);
  assert.ok(result.pool.some((e) => e.text === excluded.text));
});

test("dealAssignments gives every player a distinct entry drawn from the pool", () => {
  const pool = BUILTIN_ENTRIES.slice(0, 5);
  const playerIds = ["p1", "p2", "p3"];
  const result = dealAssignments(pool, playerIds);
  assert.equal(result.assignments.size, 3);
  const dealtIds = playerIds.map((pid) => result.assignments.get(pid).id);
  assert.equal(new Set(dealtIds).size, 3);
  dealtIds.forEach((id) => assert.ok(pool.some((e) => e.id === id)));
});

test("dealAssignments errors when the pool is smaller than the player count", () => {
  const pool = BUILTIN_ENTRIES.slice(0, 2);
  const result = dealAssignments(pool, ["p1", "p2", "p3"]);
  assert.match(result.error, /Need at least 3 entries/);
});

test("reassignOne never returns an entry that is currently held", () => {
  const pool = BUILTIN_ENTRIES.slice(0, 3);
  const held = [pool[0], pool[1]];
  const result = reassignOne(pool, held);
  assert.equal(result.entry.id, pool[2].id);
});

test("reassignOne errors when every pool entry is currently held", () => {
  const pool = BUILTIN_ENTRIES.slice(0, 2);
  const result = reassignOne(pool, pool);
  assert.match(result.error, /No available entry/);
});

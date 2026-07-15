const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_PUNISHMENTS, makeDefaultItems, addItem, removeItem } = require("../games/wheelLogic");

test("DEFAULT_PUNISHMENTS has at least 10 non-empty string entries", () => {
  assert.ok(DEFAULT_PUNISHMENTS.length >= 10);
  DEFAULT_PUNISHMENTS.forEach((text) => {
    assert.equal(typeof text, "string");
    assert.ok(text.trim().length > 0);
  });
});

test("makeDefaultItems returns one item per DEFAULT_PUNISHMENTS entry, addedBy 'default'", () => {
  const items = makeDefaultItems();
  assert.equal(items.length, DEFAULT_PUNISHMENTS.length);
  items.forEach((item) => {
    assert.equal(typeof item.id, "string");
    assert.ok(item.id.length > 0);
    assert.equal(item.addedBy, "default");
    assert.equal(typeof item.text, "string");
  });
});

test("makeDefaultItems returns fresh distinct ids on every call", () => {
  const a = makeDefaultItems();
  const b = makeDefaultItems();
  const aIds = new Set(a.map((i) => i.id));
  const bIds = new Set(b.map((i) => i.id));
  assert.equal(aIds.size, a.length);
  a.forEach((item) => assert.ok(!bIds.has(item.id)));
});

test("addItem trims text and appends a new item with a generated id", () => {
  const result = addItem([], { text: "  Do 10 pushups  ", addedBy: "host" });
  assert.equal(result.error, undefined);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].text, "Do 10 pushups");
  assert.equal(result.items[0].addedBy, "host");
  assert.equal(typeof result.items[0].id, "string");
});

test("addItem rejects empty text", () => {
  const result = addItem([], { text: "", addedBy: "player" });
  assert.match(result.error, /required/i);
});

test("addItem rejects whitespace-only text", () => {
  const result = addItem([], { text: "   ", addedBy: "player" });
  assert.match(result.error, /required/i);
});

test("addItem rejects non-string text without throwing", () => {
  const result = addItem([], { text: 42, addedBy: "player" });
  assert.match(result.error, /required/i);
});

test("addItem does not mutate the input array", () => {
  const original = [{ id: "x", text: "existing", addedBy: "default" }];
  const result = addItem(original, { text: "new one", addedBy: "host" });
  assert.equal(original.length, 1);
  assert.equal(result.items.length, 2);
});

test("addItem includes nickname when provided and omits it when not", () => {
  const withNick = addItem([], { text: "a", addedBy: "player", nickname: "Alice" });
  assert.equal(withNick.items[0].nickname, "Alice");
  const withoutNick = addItem([], { text: "b", addedBy: "host" });
  assert.equal(withoutNick.items[0].nickname, undefined);
});

test("removeItem filters out the matching id and does not mutate the input array", () => {
  const original = [
    { id: "a", text: "one", addedBy: "default" },
    { id: "b", text: "two", addedBy: "default" },
  ];
  const result = removeItem(original, "a");
  assert.equal(original.length, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "b");
});

test("removeItem no-ops when the id is not found", () => {
  const original = [{ id: "a", text: "one", addedBy: "default" }];
  const result = removeItem(original, "does-not-exist");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, "a");
});

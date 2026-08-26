const test = require("node:test");
const assert = require("node:assert/strict");
const { isValidToken } = require("../sessionToken");

test("accepts a crypto.randomUUID-shaped token", () => {
  assert.equal(isValidToken("3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"), true);
});

test("accepts a plain hex token", () => {
  assert.equal(isValidToken("a1b2c3d4e5f60718"), true);
});

test("rejects anything too short to be unguessable", () => {
  assert.equal(isValidToken("abc123"), false);
});

test("rejects an over-long token", () => {
  assert.equal(isValidToken("a".repeat(65)), false);
});

test("rejects characters outside the allowed set", () => {
  assert.equal(isValidToken("has spaces here!!"), false);
  assert.equal(isValidToken("semi;colon;token123"), false);
});

test("rejects non-strings", () => {
  assert.equal(isValidToken(null), false);
  assert.equal(isValidToken(undefined), false);
  assert.equal(isValidToken(12345678), false);
  assert.equal(isValidToken({}), false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveRound, checkGameEnd, computeElapsedMs } = require("../games/imposterLogic");

test("resolveRound eliminates a player with strict majority", () => {
  const votes = new Map([
    ["p1", "p2"],
    ["p2", "p2"],
    ["p3", "p1"],
  ]);
  const result = resolveRound(["p1", "p2", "p3"], votes);
  assert.equal(result.eliminatedId, "p2");
  assert.deepEqual(result.tally, { p2: 2, p1: 1 });
});

test("resolveRound returns no elimination when skip wins", () => {
  const votes = new Map([
    ["p1", "skip"],
    ["p2", "skip"],
    ["p3", "p1"],
  ]);
  const result = resolveRound(["p1", "p2", "p3"], votes);
  assert.equal(result.eliminatedId, null);
});

test("resolveRound returns no elimination when no majority is reached", () => {
  const votes = new Map([
    ["p1", "p2"],
    ["p2", "p3"],
    ["p3", "p1"],
    ["p4", "p2"],
  ]);
  // threshold = floor(4/2)+1 = 3; p2 has only 2 votes, nobody reaches 3
  const result = resolveRound(["p1", "p2", "p3", "p4"], votes);
  assert.equal(result.eliminatedId, null);
});

test("checkGameEnd declares crew win when the eliminated player was the imposter", () => {
  const result = checkGameEnd(["p1", "p3"], "p2", "p2");
  assert.deepEqual(result, { gameOver: true, winner: "crew" });
});

test("checkGameEnd declares imposter win once only 2 active players remain", () => {
  const result = checkGameEnd(["p1", "p2"], "p3", "p2");
  assert.deepEqual(result, { gameOver: true, winner: "imposter" });
});

test("checkGameEnd continues the game when neither end condition is met", () => {
  const result = checkGameEnd(["p1", "p2", "p3"], "p4", "p2");
  assert.deepEqual(result, { gameOver: false, winner: null });
});

test("computeElapsedMs floors at zero", () => {
  assert.equal(computeElapsedMs(1000, 1500), 500);
  assert.equal(computeElapsedMs(1000, 500), 0);
});

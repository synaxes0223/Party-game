const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const voting = require("../games/botc/voting");

test("startDay seeds a 15s default vote timer", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  voting.startDay(s);
  assert.equal(s.day.voteTimerMs, 15000);
});

test("shouldPromptVoter is false under global verbal mode", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  voting.startDay(s);
  assert.equal(voting.shouldPromptVoter(s, 1), true);
  s.day.verbalMode = true;
  assert.equal(voting.shouldPromptVoter(s, 1), false);
});

test("shouldPromptVoter is false for a per-seat verbal voter only", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  voting.startDay(s);
  s.seats[0].verbal = true;
  assert.equal(voting.shouldPromptVoter(s, 1), false);
  assert.equal(voting.shouldPromptVoter(s, 2), true);
});

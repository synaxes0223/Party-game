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

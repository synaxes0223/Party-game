const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");

test("createInitialState returns the expected shape", () => {
  const s = state.createInitialState();
  assert.equal(s.phase, "setup");
  assert.equal(s.dayNumber, 0);
  assert.deepEqual(s.seats, []);
  assert.equal(s.nightPointer, null);
  assert.equal(s.day, null);
  assert.equal(s.ended, null);
  assert.deepEqual(s.infoLog, []);
  assert.equal(s.nextReminderId, 1);
});

test("createSeat produces a fresh, alive, unassigned seat", () => {
  const seat = state.createSeat(1, "tok-a", "Alice");
  assert.equal(seat.seatId, 1);
  assert.equal(seat.playerToken, "tok-a");
  assert.equal(seat.nickname, "Alice");
  assert.equal(seat.characterId, null);
  assert.equal(seat.believedCharacterId, null);
  assert.equal(seat.alignment, null);
  assert.equal(seat.alive, true);
  assert.equal(seat.usedDeadVote, false);
  assert.deepEqual(seat.reminders, []);
});

test("createSeat starts non-verbal", () => {
  assert.equal(state.createSeat(1, "t1", "A").verbal, false);
});

function seededState(names) {
  const s = state.createInitialState();
  s.seats = names.map((n, i) => state.createSeat(i + 1, `tok-${n}`, n));
  return s;
}

test("findSeatById and findSeatByToken locate the right seat, or null", () => {
  const s = seededState(["Alice", "Bob"]);
  assert.equal(state.findSeatById(s, 2).nickname, "Bob");
  assert.equal(state.findSeatById(s, 99), null);
  assert.equal(state.findSeatByToken(s, "tok-Alice").nickname, "Alice");
  assert.equal(state.findSeatByToken(s, "no-such-token"), null);
});

test("aliveSeats excludes dead seats", () => {
  const s = seededState(["Alice", "Bob", "Carol"]);
  s.seats[1].alive = false;
  const alive = state.aliveSeats(s);
  assert.equal(alive.length, 2);
  assert.deepEqual(alive.map((seat) => seat.nickname), ["Alice", "Carol"]);
});

test("physicalNeighborsOf wraps around the seat array", () => {
  const s = seededState(["Alice", "Bob", "Carol"]);
  const { left, right } = state.physicalNeighborsOf(s, 1); // Alice, seatId 1
  assert.equal(left.nickname, "Carol"); // wraps to the last seat
  assert.equal(right.nickname, "Bob");
});

test("aliveNeighborsOf skips dead seats to find the nearest living neighbour each way", () => {
  const s = seededState(["Alice", "Bob", "Carol", "Dave", "Eve"]);
  s.seats[1].alive = false; // Bob dead
  s.seats[3].alive = false; // Dave dead
  const { left, right } = state.aliveNeighborsOf(s, 1); // Alice, seatId 1
  assert.equal(left.nickname, "Eve");  // skips nobody to the left, Eve is seat 5, adjacent
  assert.equal(right.nickname, "Carol"); // Bob (dead) skipped, Carol is next alive
});

test("aliveNeighborsOf can return the same seat on both sides when only two are alive", () => {
  const s = seededState(["Alice", "Bob", "Carol"]);
  s.seats[1].alive = false; // Bob dead
  const { left, right } = state.aliveNeighborsOf(s, 1); // Alice
  assert.equal(left.nickname, "Carol");
  assert.equal(right.nickname, "Carol");
});

test("aliveNeighborsOf returns nulls when the seat itself is the only one alive", () => {
  const s = seededState(["Alice", "Bob"]);
  s.seats[1].alive = false;
  const { left, right } = state.aliveNeighborsOf(s, 1);
  assert.equal(left, null);
  assert.equal(right, null);
});

test("nextReminderId increments per-state, not globally", () => {
  const a = state.createInitialState();
  const b = state.createInitialState();
  assert.equal(state.nextReminderId(a), 1);
  assert.equal(state.nextReminderId(a), 2);
  assert.equal(state.nextReminderId(b), 1); // b's counter is independent of a's
});

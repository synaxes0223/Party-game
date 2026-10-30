const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const demonInfo = require("../games/botc/steps/demonInfo");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("computeCandidates lists a single minion in payload.minions", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "poisoner" },
    { nickname: "Eve", characterId: "imp" },
  ]);
  const demonSeat = s.seats.find((seat) => seat.characterId === "imp");
  const candidates = demonInfo.computeCandidates(s, demonSeat);
  assert.equal(candidates.length, 1);
  const { minions, bluffs } = candidates[0].payload;
  assert.equal(minions.length, 1);
  assert.equal(minions[0].nickname, "Bob");
  assert.equal(minions[0].characterId, "poisoner");
  assert.ok(Array.isArray(bluffs));
});

test("computeCandidates lists ALL alive minions when there are multiple", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "poisoner" },
    { nickname: "Carol", characterId: "baron" },
    { nickname: "Dave", characterId: "empath" },
    { nickname: "Eve", characterId: "imp" },
  ]);
  const demonSeat = s.seats.find((seat) => seat.characterId === "imp");
  const candidates = demonInfo.computeCandidates(s, demonSeat);
  assert.equal(candidates.length, 1);
  const { minions } = candidates[0].payload;
  assert.equal(minions.length, 2);
  const names = minions.map((m) => m.nickname).sort();
  assert.deepEqual(names, ["Bob", "Carol"]);
});

test("computeCandidates returns empty when no minions are alive", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "poisoner" },
    { nickname: "Eve", characterId: "imp" },
  ]);
  s.seats.find((seat) => seat.characterId === "poisoner").alive = false;
  const demonSeat = s.seats.find((seat) => seat.characterId === "imp");
  const candidates = demonInfo.computeCandidates(s, demonSeat);
  assert.equal(candidates.length, 0);
});

test("renderForPlayer formats a single minion correctly", () => {
  const payload = {
    minions: [{ seatId: 2, nickname: "Bob", characterId: "poisoner" }],
    bluffs: ["soldier", "chef"],
  };
  const text = demonInfo.renderForPlayer(payload);
  assert.ok(text.includes("Bob (poisoner)"), `expected 'Bob (poisoner)' in "${text}"`);
  assert.ok(text.includes("Your Minion is"), `expected singular form in "${text}"`);
});

test("renderForPlayer formats multiple minions correctly", () => {
  const payload = {
    minions: [
      { seatId: 2, nickname: "Bob", characterId: "poisoner" },
      { seatId: 3, nickname: "Carol", characterId: "baron" },
    ],
    bluffs: ["soldier", "chef"],
  };
  const text = demonInfo.renderForPlayer(payload);
  assert.ok(text.includes("Bob (poisoner)"), `expected 'Bob (poisoner)' in "${text}"`);
  assert.ok(text.includes("Carol (baron)"), `expected 'Carol (baron)' in "${text}"`);
  assert.ok(text.includes("Your Minions are"), `expected plural form in "${text}"`);
});

test("candidate label lists all minion names", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "poisoner" },
    { nickname: "Carol", characterId: "baron" },
    { nickname: "Dave", characterId: "empath" },
    { nickname: "Eve", characterId: "imp" },
  ]);
  const demonSeat = s.seats.find((seat) => seat.characterId === "imp");
  const candidates = demonInfo.computeCandidates(s, demonSeat);
  assert.ok(candidates[0].label.includes("Bob"), `expected 'Bob' in label "${candidates[0].label}"`);
  assert.ok(candidates[0].label.includes("Carol"), `expected 'Carol' in label "${candidates[0].label}"`);
});

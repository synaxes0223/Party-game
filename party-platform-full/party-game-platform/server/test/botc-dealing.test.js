const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const characters = require("../games/botc/characters");
const dealing = require("../games/botc/dealing");

function seededState(names) {
  const s = state.createInitialState();
  s.seats = names.map((n, i) => state.createSeat(i + 1, `tok-${n}`, n));
  return s;
}

test("teamOf and charactersOfTeam reflect the fourteen-character registry", () => {
  assert.equal(characters.teamOf("imp"), "demon");
  assert.equal(characters.teamOf("washerwoman"), "townsfolk");
  assert.equal(characters.teamOf("no-such-character"), null);
  assert.deepEqual(characters.charactersOfTeam("townsfolk").sort(), ["chef", "empath", "fortuneTeller", "investigator", "librarian", "monk", "soldier", "washerwoman"]);
  assert.deepEqual(characters.charactersOfTeam("outsider").sort(), ["butler", "drunk", "saint"]);
  assert.deepEqual(characters.charactersOfTeam("minion").sort(), ["baron", "poisoner"]);
});

test("dealManual assigns exact characters and derives alignment from team", () => {
  const s = seededState(["Alice", "Bob", "Carol", "Dave", "Eve"]);
  const result = dealing.dealManual(s, [
    { seatId: 1, characterId: "washerwoman" },
    { seatId: 2, characterId: "empath" },
    { seatId: 3, characterId: "soldier" },
    { seatId: 4, characterId: "poisoner" },
    { seatId: 5, characterId: "imp" },
  ]);
  assert.equal(result.error, undefined);
  assert.equal(s.seats[0].characterId, "washerwoman");
  assert.equal(s.seats[0].alignment, "good");
  assert.equal(s.seats[3].alignment, "evil");
  assert.equal(s.seats[3].characterId, "poisoner");
  assert.equal(s.seats[4].alignment, "evil");
});

test("dealManual rejects an unknown seat or character id without partially applying", () => {
  const s = seededState(["Alice", "Bob"]);
  const result = dealing.dealManual(s, [
    { seatId: 1, characterId: "washerwoman" },
    { seatId: 2, characterId: "not-a-character" },
  ]);
  assert.equal(typeof result.error, "string");
  assert.equal(s.seats[0].characterId, null, "no partial assignment on error");
});

test("teamCountsOf tallies the currently dealt seats by team", () => {
  const s = seededState(["Alice", "Bob", "Carol", "Dave", "Eve"]);
  dealing.dealManual(s, [
    { seatId: 1, characterId: "washerwoman" },
    { seatId: 2, characterId: "empath" },
    { seatId: 3, characterId: "butler" },
    { seatId: 4, characterId: "poisoner" },
    { seatId: 5, characterId: "imp" },
  ]);
  assert.deepEqual(dealing.teamCountsOf(s), { townsfolk: 2, outsiders: 1, minions: 1, demon: 1 });
});

test("dealRandom deals exactly the requested character counts, drawn from the registry, with no repeats", () => {
  const s = seededState(["p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
  const result = dealing.dealRandom(s, { townsfolk: 3, outsiders: 1, minions: 2, demon: 1 });
  assert.equal(result.error, undefined);
  const dealtIds = s.seats.map((seat) => seat.characterId);
  assert.equal(new Set(dealtIds).size, 7, "no character repeated across seats");
  assert.deepEqual(dealing.teamCountsOf(s), { townsfolk: 3, outsiders: 1, minions: 2, demon: 1 });
  // this plan has three outsiders (Butler, Drunk, Saint) and two minions
  // (Poisoner, Baron). A randomized deal must satisfy team-shape invariants,
  // never a specific id drawn from a shuffled pool.
  const outsiders = dealtIds.filter((id) => characters.teamOf(id) === "outsider");
  assert.equal(outsiders.length, 1);
  assert.ok(characters.charactersOfTeam("outsider").includes(outsiders[0]));
  const minions = dealtIds.filter((id) => characters.teamOf(id) === "minion");
  assert.equal(minions.length, 2);
  assert.deepEqual(minions.slice().sort(), characters.charactersOfTeam("minion").slice().sort());
  assert.ok(dealtIds.includes("imp"));
});

test("dealRandom errors when a requested team count exceeds this plan's character pool for that team", () => {
  const s = seededState(["p1", "p2", "p3", "p4", "p5"]);
  // only 3 Outsiders (Butler, Drunk, Saint) exist in this plan's registry; asking for 4 must fail
  const result = dealing.dealRandom(s, { townsfolk: 0, outsiders: 4, minions: 0, demon: 1 });
  assert.equal(typeof result.error, "string");
});

test("dealRandom errors when the requested total does not match the seat count", () => {
  const s = seededState(["p1", "p2", "p3"]);
  const result = dealing.dealRandom(s, { townsfolk: 3, outsiders: 0, minions: 1, demon: 1 }); // totals 5, only 3 seats
  assert.equal(typeof result.error, "string");
});

test("assignFortuneTellerRedHerring marks exactly one good non-FT seat, and is idempotent", () => {
  const s = state.createInitialState();
  s.seats = [1, 2, 3, 4].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  dealing.dealManual(s, [
    { seatId: 1, characterId: "fortuneTeller" },
    { seatId: 2, characterId: "empath" },
    { seatId: 3, characterId: "poisoner" },
    { seatId: 4, characterId: "imp" },
  ]);
  dealing.assignFortuneTellerRedHerring(s);
  const marked = s.seats.filter((seat) => seat.reminders.some((r) => r.kind === "red-herring"));
  assert.equal(marked.length, 1);
  assert.equal(marked[0].characterId, "empath", "only the sole good non-FT seat can be the herring");
  dealing.assignFortuneTellerRedHerring(s); // idempotent
  assert.equal(s.seats.filter((seat) => seat.reminders.some((r) => r.kind === "red-herring")).length, 1);
});

test("assignFortuneTellerRedHerring is a no-op when there is no Fortune Teller", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  dealing.dealManual(s, [{ seatId: 1, characterId: "empath" }, { seatId: 2, characterId: "imp" }]);
  dealing.assignFortuneTellerRedHerring(s);
  assert.equal(s.seats.some((seat) => seat.reminders.some((r) => r.kind === "red-herring")), false);
});

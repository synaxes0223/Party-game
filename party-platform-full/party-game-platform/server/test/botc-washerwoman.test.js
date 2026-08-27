const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const grimoire = require("../games/botc/grimoire");
const dealing = require("../games/botc/dealing");
const washerwoman = require("../games/botc/characters/washerwoman");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("washerwoman never requires a player-driven choice", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "empath" },
    { nickname: "Carol", characterId: "imp" },
  ]);
  assert.equal(washerwoman.requiresChoice(s, s.seats[0]), null);
});

test("computeCandidates includes at least one truthful option naming the real Townsfolk when not impaired", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "empath" },
    { nickname: "Carol", characterId: "soldier" },
    { nickname: "Dave", characterId: "poisoner" },
    { nickname: "Eve", characterId: "imp" },
  ]);
  const candidates = washerwoman.computeCandidates(s, s.seats[0]);
  const truthful = candidates.filter((c) => c.truthful);
  assert.ok(truthful.length > 0, "at least one truthful candidate must exist");
  // every truthful candidate must name a Townsfolk actually in play
  for (const c of truthful) {
    assert.ok(["empath", "soldier"].includes(c.payload.characterId));
  }
});

test("computeCandidates never shows the Washerwoman herself as one of the two revealed players", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "empath" },
    { nickname: "Carol", characterId: "imp" },
  ]);
  const candidates = washerwoman.computeCandidates(s, s.seats[0]);
  for (const c of candidates) {
    const shownSeatIds = c.payload.shown.map((p) => p.seatId);
    assert.ok(!shownSeatIds.includes(s.seats[0].seatId));
  }
});

test("computeCandidates includes false options naming Townsfolk not in this game at all", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "imp" },
    { nickname: "Carol", characterId: "poisoner" },
  ]);
  // soldier and empath aren't dealt in this 3-seat game, but their ids are
  // still legal false-option characters per the spec's Washerwoman example
  const candidates = washerwoman.computeCandidates(s, s.seats[0]);
  const falseCharacterIds = candidates.filter((c) => !c.truthful).map((c) => c.payload.characterId);
  assert.ok(falseCharacterIds.includes("soldier"));
  assert.ok(falseCharacterIds.includes("empath"));
});

test("renderForPlayer names both shown players and the revealed character from payload alone", () => {
  const payload = { characterId: "empath", shown: [{ seatId: 2, nickname: "Bob" }, { seatId: 3, nickname: "Carol" }] };
  const text = washerwoman.renderForPlayer(payload);
  assert.match(text, /Bob/);
  assert.match(text, /Carol/);
  assert.match(text, /empath/);
});

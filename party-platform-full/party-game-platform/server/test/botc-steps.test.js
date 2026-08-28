const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const minionInfo = require("../games/botc/steps/minionInfo");
const demonInfo = require("../games/botc/steps/demonInfo");
const characters = require("../games/botc/characters");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("minion-info reveals the sole Demon to the Minion seat", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "poisoner" },
    { nickname: "Bob", characterId: "imp" },
    { nickname: "Carol", characterId: "washerwoman" },
  ]);
  const candidates = minionInfo.computeCandidates(s, s.seats[0]); // running "for" the Minion's seat
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].truthful, true);
  assert.equal(candidates[0].payload.characterId, "imp");
  assert.equal(candidates[0].payload.nickname, "Bob");
  const text = minionInfo.renderForPlayer(candidates[0].payload);
  assert.match(text, /Bob/);
  assert.match(text, /imp/);
});

test("minion-info returns no candidates if somehow no Demon is dealt", () => {
  const s = dealtState([{ nickname: "Alice", characterId: "poisoner" }, { nickname: "Bob", characterId: "washerwoman" }]);
  assert.deepEqual(minionInfo.computeCandidates(s, s.seats[0]), []);
});

test("demon-info reveals the sole Minion plus exactly three not-in-play good bluff characters", () => {
  const s = dealtState([
    { nickname: "Alice", characterId: "imp" },
    { nickname: "Bob", characterId: "poisoner" },
    { nickname: "Carol", characterId: "washerwoman" },
  ]);
  const candidates = demonInfo.computeCandidates(s, s.seats[0]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].payload.minion.characterId, "poisoner");
  assert.equal(candidates[0].payload.minion.nickname, "Bob");
  assert.equal(candidates[0].payload.bluffs.length, 3);
  // bluffs must be good-team characters not currently dealt to any seat
  const dealtIds = s.seats.map((seat) => seat.characterId);
  for (const bluffId of candidates[0].payload.bluffs) {
    assert.ok(["townsfolk", "outsider"].includes(characters.teamOf(bluffId)));
    assert.ok(!dealtIds.includes(bluffId));
  }
  // no duplicate bluffs
  assert.equal(new Set(candidates[0].payload.bluffs).size, 3);
});

test("demon-info degrades safely to fewer than 3 bluffs when all implemented good characters are dealt", () => {
  // 10-player game: all 7 townsfolk + butler + poisoner minion + imp demon.
  // This vertical slice implements all 8 good characters (washerwoman, empath,
  // soldier, chef, investigator, librarian, monk, butler), so dealing all of
  // them leaves zero left over for bluffs -- an accepted limitation, not a bug.
  // This proves the shortfall is handled safely (no throw, no wraparound to
  // dealt/duplicate ids) rather than just asserting it exists.
  const s = dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "empath" },
    { nickname: "Carol", characterId: "soldier" },
    { nickname: "Dave", characterId: "chef" },
    { nickname: "Erin", characterId: "investigator" },
    { nickname: "Frank", characterId: "librarian" },
    { nickname: "Grace", characterId: "monk" },
    { nickname: "Heidi", characterId: "butler" },
    { nickname: "Henry", characterId: "poisoner" },
    { nickname: "Iris", characterId: "imp" },
  ]);
  const candidates = demonInfo.computeCandidates(s, s.seats[9]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].payload.minion.characterId, "poisoner");
  assert.ok(candidates[0].payload.bluffs.length < 3);
  assert.equal(candidates[0].payload.bluffs.length, 0);
});

test("renderForPlayer for demon-info names the minion and lists the bluffs", () => {
  const payload = { minion: { seatId: 2, nickname: "Bob", characterId: "poisoner" }, bluffs: ["empath", "soldier", "butler"] };
  const text = demonInfo.renderForPlayer(payload);
  assert.match(text, /Bob/);
  assert.match(text, /poisoner/);
  assert.match(text, /empath/);
});

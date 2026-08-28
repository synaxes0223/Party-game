const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const grimoire = require("../games/botc/grimoire");
const nightLoop = require("../games/botc/nightLoop");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

function fiveSeatGame() {
  return dealtState([
    { nickname: "Alice", characterId: "washerwoman" },
    { nickname: "Bob", characterId: "empath" },
    { nickname: "Carol", characterId: "poisoner" },
    { nickname: "Dave", characterId: "butler" },
    { nickname: "Eve", characterId: "imp" },
  ]);
}

test("startNight on the first night sets dayNumber to 1, phase to night, and clears any stale poison", () => {
  const s = fiveSeatGame();
  grimoire.addReminder(s, s.seats[0], "poisoned", "poisoner", "stale, should be cleared");
  nightLoop.startNight(s);
  assert.equal(s.dayNumber, 1);
  assert.equal(s.phase, "night");
  assert.equal(grimoire.isPoisoned(s.seats[0]), false);
});

test("the first night runs minion-info and demon-info before the Poisoner, and skips characters with no first-night step", () => {
  const s = fiveSeatGame();
  nightLoop.startNight(s);
  const stepIds = [];
  let guard = 0;
  while (!nightLoop.isNightOver(s) && guard < 20) {
    const step = nightLoop.currentStep(s);
    if (!step) break;
    stepIds.push(step.stepId);
    if (step.requiresChoice) {
      nightLoop.submitChoice(s, { targetSeatId: s.seats[0].seatId });
    } else {
      const candidates = step.candidates;
      nightLoop.submitCandidate(s, candidates[0] ? candidates[0].id : null);
    }
    guard++;
  }
  assert.ok(stepIds.indexOf("minion-info") < stepIds.indexOf("poisoner"), "minion-info runs before Poisoner");
  assert.ok(stepIds.includes("minion-info"));
  assert.ok(stepIds.includes("demon-info"));
  assert.ok(stepIds.includes("washerwoman"));
  assert.ok(stepIds.includes("empath"));
  assert.ok(stepIds.includes("butler"));
  assert.ok(!stepIds.includes("imp"), "the Imp does not act on the first night");
  assert.ok(!stepIds.includes("baron"), "the Baron never has a night step");
});

test("a dead seat's step is skipped on later nights", () => {
  const s = fiveSeatGame();
  s.seats[1].alive = false; // Bob (empath) is dead
  s.dayNumber = 1; // pretend night 1 already happened
  nightLoop.startNight(s); // starts night 2
  const stepIds = [];
  let guard = 0;
  while (!nightLoop.isNightOver(s) && guard < 20) {
    const step = nightLoop.currentStep(s);
    if (!step) break;
    stepIds.push(step.stepId);
    if (step.requiresChoice) {
      const aliveOther = s.seats.find((seat) => seat.alive && seat.seatId !== step.seat.seatId) || step.seat;
      nightLoop.submitChoice(s, { targetSeatId: aliveOther.seatId });
    } else {
      const candidates = step.candidates;
      nightLoop.submitCandidate(s, candidates[0] ? candidates[0].id : null);
    }
    guard++;
  }
  assert.ok(!stepIds.includes("empath"), "a dead Empath's step is skipped");
  assert.ok(stepIds.includes("imp"), "the Imp does act on night 2");
  assert.ok(!stepIds.includes("minion-info"), "minion-info only runs on the first night");
});

test("submitChoice on the Poisoner step applies the poison via the character module, not bespoke nightLoop logic", () => {
  const s = fiveSeatGame();
  nightLoop.startNight(s);
  let step = nightLoop.currentStep(s);
  while (step.stepId !== "poisoner") {
    if (step.requiresChoice) nightLoop.submitChoice(s, { targetSeatId: s.seats[0].seatId });
    else nightLoop.submitCandidate(s, step.candidates[0] ? step.candidates[0].id : null);
    step = nightLoop.currentStep(s);
  }
  nightLoop.submitChoice(s, { targetSeatId: s.seats[3].seatId }); // poison Dave (butler)
  assert.equal(grimoire.isPoisoned(s.seats[3]), true);
});

test("isNightOver becomes true once every schedulable step has run", () => {
  const s = fiveSeatGame();
  nightLoop.startNight(s);
  let guard = 0;
  while (!nightLoop.isNightOver(s) && guard < 20) {
    const step = nightLoop.currentStep(s);
    if (step.requiresChoice) nightLoop.submitChoice(s, { targetSeatId: s.seats[0].seatId });
    else nightLoop.submitCandidate(s, step.candidates[0] ? step.candidates[0].id : null);
    guard++;
  }
  assert.equal(nightLoop.isNightOver(s), true);
  assert.equal(nightLoop.currentStep(s), null);
});

test("submitChoice on the Fortune Teller keeps the same step active as a reveal", () => {
  const s = state.createInitialState();
  s.seats = [1, 2, 3].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  dealing.dealManual(s, [
    { seatId: 1, characterId: "fortuneTeller" },
    { seatId: 2, characterId: "imp" },
    { seatId: 3, characterId: "empath" },
  ]);
  nightLoop.startNight(s);
  // walk to the fortuneTeller step
  let guard = 0;
  while (s.phase === "night" && guard++ < 12) {
    const step = nightLoop.currentStep(s);
    if (step && step.stepId === "fortuneTeller") break;
    nightLoop.advance(s);
  }
  const before = nightLoop.currentStep(s);
  assert.equal(before.stepId, "fortuneTeller");
  assert.ok(before.requiresChoice, "starts as a choice step");

  nightLoop.submitChoice(s, { targetSeatIds: [2, 3] });

  const after = nightLoop.currentStep(s);
  assert.equal(after.stepId, "fortuneTeller", "still on the Fortune Teller after the choice");
  assert.equal(after.requiresChoice, null, "now a reveal step");
  assert.equal(after.candidates.length, 2, "yes/no candidates are ready for the Storyteller");

  nightLoop.submitCandidate(s, after.candidates[0].id);
  const next = nightLoop.currentStep(s);
  assert.ok(!next || next.stepId !== "fortuneTeller", "picking a candidate advances past the Fortune Teller");
});

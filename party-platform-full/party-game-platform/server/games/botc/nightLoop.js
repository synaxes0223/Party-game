// nightLoop.js
// Advances through nightOrder.js's tables, auto-skipping a step when nobody
// currently believes they are that character (or, for a pseudo-step,
// nobody is on the relevant team), or the relevant seat is dead. Scheduling
// looks up seats by believedCharacterId, per the spec's rule that this is
// what lets a future Drunk be scheduled correctly -- see this plan's Task 9
// note and Global Constraints.

const grimoire = require("./grimoire");
const characters = require("./characters");
const nightOrder = require("./nightOrder");

function seatForStep(state, stepId) {
  if (stepId === "minion-info") {
    return state.seats.find((s) => s.alive && characters.teamOf(s.characterId) === "minion") || null;
  }
  if (stepId === "demon-info") {
    return state.seats.find((s) => s.alive && characters.teamOf(s.characterId) === "demon") || null;
  }
  return state.seats.find((s) => s.alive && s.believedCharacterId === stepId) || null;
}

function orderFor(state) {
  return state.dayNumber <= 1 ? nightOrder.FIRST_NIGHT_ORDER : nightOrder.OTHER_NIGHTS_ORDER;
}

function startNight(state) {
  if (state.dayNumber === 0) state.dayNumber = 1;
  else state.dayNumber += 1;
  state.phase = "night";
  grimoire.removeRemindersOfKind(state, "poisoned");
  grimoire.removeRemindersOfKind(state, "protected");
  state.nightPointer = { orderIndex: 0, stepId: orderFor(state)[0] || null };
  skipToSchedulable(state);
}

function skipToSchedulable(state) {
  const order = orderFor(state);
  while (state.nightPointer && state.nightPointer.orderIndex < order.length) {
    const stepId = order[state.nightPointer.orderIndex];
    const seat = seatForStep(state, stepId);
    if (seat) {
      state.nightPointer.stepId = stepId;
      return;
    }
    state.nightPointer.orderIndex += 1;
  }
  state.nightPointer = null; // night is over
}

function isNightOver(state) {
  return state.nightPointer === null;
}

function currentStep(state) {
  if (isNightOver(state)) return null;
  const stepId = state.nightPointer.stepId;
  const seat = seatForStep(state, stepId);
  if (!seat) {
    // seat died between scheduling and now (shouldn't happen mid-step, but
    // don't hand back a step with no seat -- skip forward instead)
    advance(state);
    return currentStep(state);
  }
  const module = characters.getModuleForStep(stepId);
  const requiresChoice = module.requiresChoice(state, seat);
  return {
    stepId,
    seat,
    requiresChoice,
    candidates: requiresChoice ? [] : module.computeCandidates(state, seat),
  };
}

function advance(state) {
  if (!state.nightPointer) return;
  state.nightPointer.orderIndex += 1;
  skipToSchedulable(state);
}

function submitChoice(state, choice) {
  const step = currentStep(state);
  if (!step) return { error: "No step is currently active." };
  if (!step.requiresChoice) return { error: `Step ${step.stepId} does not take a player-driven choice.` };
  const module = characters.getModuleForStep(step.stepId);
  module.applyChoice(state, step.seat, choice);
  advance(state);
  return {};
}

function submitCandidate(state, candidateId) {
  const step = currentStep(state);
  if (!step) return { error: "No step is currently active." };
  if (step.requiresChoice) return { error: `Step ${step.stepId} requires a player-driven choice, not a candidate pick.` };
  const chosen = step.candidates.find((c) => c.id === candidateId) || null;
  advance(state);
  return { chosenCandidate: chosen };
}

module.exports = { startNight, currentStep, submitChoice, submitCandidate, advance, isNightOver };

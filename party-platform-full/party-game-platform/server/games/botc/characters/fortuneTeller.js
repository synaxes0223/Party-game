// fortuneTeller.js
// "Each night, choose 2 players: you learn if either is the Demon. There is
// a good player who registers as a Demon to you." The choice must be made
// before the yes/no can be computed, so this flips the SAME night step from
// choice-mode to reveal-mode: applyChoice stores the pair as a transient
// 'ft-pick' reminder on the FT's own seat (label = "seatIdA,seatIdB"), after
// which requiresChoice returns null and computeCandidates has something to
// read. nightLoop.submitChoice is taught (this task's Step 5) not to advance
// past a step that converted to a reveal this way; nightLoop.startNight
// clears 'ft-pick' via the same per-night cleanup as 'poisoned'/'protected'.

const stateModule = require("../state");
const grimoire = require("../grimoire");
const characters = require("./index");

function storedPick(seat) {
  const r = seat.reminders.find((x) => x.kind === "ft-pick");
  return r ? r.label.split(",").map(Number) : null;
}

function requiresChoice(state, seat) {
  return storedPick(seat) ? null : { type: "select-two-players" };
}

function applyChoice(state, seat, choice) {
  const ids = (choice && choice.targetSeatIds) || [];
  if (ids.length !== 2) return;
  seat.reminders = seat.reminders.filter((r) => r.kind !== "ft-pick");
  grimoire.addReminder(state, seat, "ft-pick", "fortuneTeller", `${ids[0]},${ids[1]}`);
}

function computeCandidates(state, seat) {
  const pick = storedPick(seat);
  if (!pick) return [];
  const picked = pick.map((id) => stateModule.findSeatById(state, id)).filter(Boolean);
  const registersAsDemon = (s) =>
    !!s && (characters.teamOf(s.characterId) === "demon" || s.reminders.some((r) => r.kind === "red-herring"));
  const trueAnswer = picked.some(registersAsDemon);
  return [true, false].map((demon) => ({
    id: `ft-${demon ? "yes" : "no"}`,
    label: `${demon === trueAnswer ? "True" : "False"}: ${demon ? "Yes" : "No"}`,
    truthful: demon === trueAnswer,
    payload: { demon },
  }));
}

function renderForPlayer(payload) {
  return payload.demon ? "Yes — one of them is the Demon." : "No — neither of them is the Demon.";
}

module.exports = {
  id: "fortuneTeller",
  team: "townsfolk",
  night: { firstNight: true, otherNights: true },
  requiresChoice,
  applyChoice,
  computeCandidates,
  renderForPlayer,
};

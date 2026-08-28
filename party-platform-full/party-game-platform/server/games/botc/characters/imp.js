// imp.js
// "Each night*, choose a player: they die. If you kill yourself this way, a
// Minion becomes the Imp." (*not the first night.) At 5-9 players there is
// exactly one Minion (a second only appears at 10+), so succession promotes
// that sole Minion if they're still alive, or nobody if they're already
// dead -- a real, tested edge case, not an error.

const stateModule = require("../state");
const grimoire = require("../grimoire");
const characters = require("./index");

function applyChoice(state, seat, choice) {
  const target = stateModule.findSeatById(state, choice.targetSeatId);
  if (!target) return;

  if (target.seatId === seat.seatId) {
    grimoire.setAlive(target, false);
    const successor = state.seats.find((s) => s.alive && characters.teamOf(s.characterId) === "minion");
    if (successor) {
      grimoire.setCharacter(successor, "imp", "evil");
    }
    return;
  }

  if (grimoire.isSafeFromDemon(target)) return;
  grimoire.setAlive(target, false);
}

module.exports = {
  id: "imp",
  team: "demon",
  night: { firstNight: false, otherNights: true },
  requiresChoice: () => ({ type: "select-one-player" }),
  applyChoice,
  computeCandidates: () => [],
  renderForPlayer: () => null,
};

// winConditions.js
// Checked after every death. This plan's character set has no Scarlet
// Woman, so Demon death always ends the game for good -- no succession
// branch exists yet; that's a character-library follow-up, along with the
// Mayor's separate "three alive, no execution" win condition. Writing
// `state.ended`/`state.phase` is the caller's job (see Task 12), matching
// how avalon.js/wordWolf.js separate "compute the verdict" from "apply it."

const stateModule = require("./state");
const characters = require("./characters");

function checkWinCondition(state) {
  const alive = stateModule.aliveSeats(state);
  const demonAlive = alive.some((seat) => characters.teamOf(seat.characterId) === "demon");
  if (!demonAlive) {
    return { winner: "good", reason: "The Demon has died." };
  }

  const evilCount = alive.filter((seat) => seat.alignment === "evil").length;
  const goodCount = alive.filter((seat) => seat.alignment === "good").length;
  if (evilCount >= goodCount) {
    return { winner: "evil", reason: "Evil has reached parity with good." };
  }

  return null;
}

module.exports = { checkWinCondition };

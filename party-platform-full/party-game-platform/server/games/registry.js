// registry.js
// Central list of games available on the platform.
// Each game module owns its own event contract (see server/index.js for the
// specific socket events wired to each game) — there is no shared onStart/
// onPlayerAction interface across games.

const findTheImposter = require("./findTheImposter");
const wordWolf = require("./wordWolf");
const whoWroteThat = require("./whoWroteThat");
const xPeople = require("./xPeople");
const passTheBomb = require("./passTheBomb");
const secretMissions = require("./secretMissions");
const slipUp = require("./slipUp");
const avalon = require("./avalon");
const botc = require("./botc");

const GAMES = {
  [findTheImposter.meta.id]: findTheImposter,
  [wordWolf.meta.id]: wordWolf,
  [whoWroteThat.meta.id]: whoWroteThat,
  [xPeople.meta.id]: xPeople,
  [passTheBomb.meta.id]: passTheBomb,
  [secretMissions.meta.id]: secretMissions,
  [slipUp.meta.id]: slipUp,
  [avalon.meta.id]: avalon,
  [botc.meta.id]: botc,
};

function listGames() {
  return Object.values(GAMES).map((g) => g.meta);
}

function getGame(gameId) {
  return GAMES[gameId];
}

module.exports = { listGames, getGame };

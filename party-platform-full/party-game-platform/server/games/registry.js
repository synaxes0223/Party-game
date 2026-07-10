// registry.js
// Central list of games available on the platform.
// Each game module owns its own event contract (see server/index.js for the
// specific socket events wired to each game) — there is no shared onStart/
// onPlayerAction interface across games.

const findTheImposter = require("./findTheImposter");
const wordWolf = require("./wordWolf");

const GAMES = {
  [findTheImposter.meta.id]: findTheImposter,
  [wordWolf.meta.id]: wordWolf,
};

function listGames() {
  return Object.values(GAMES).map((g) => g.meta);
}

function getGame(gameId) {
  return GAMES[gameId];
}

module.exports = { listGames, getGame };

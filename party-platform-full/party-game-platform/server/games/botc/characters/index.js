// characters/index.js
// The team registry for this plan's seven Trouble Brewing characters. The
// character *modules* (night behavior) are added in later tasks and
// registered here too, once they exist -- this file starts as pure team
// data so dealing can be built and tested before any night logic does.

const TEAM_OF = {
  washerwoman: "townsfolk",
  empath: "townsfolk",
  soldier: "townsfolk",
  butler: "outsider",
  poisoner: "minion",
  baron: "minion",
  imp: "demon",
};

const ALL_CHARACTER_IDS = Object.keys(TEAM_OF);

function teamOf(characterId) {
  return TEAM_OF[characterId] || null;
}

function charactersOfTeam(team) {
  return ALL_CHARACTER_IDS.filter((id) => TEAM_OF[id] === team);
}

module.exports = { TEAM_OF, ALL_CHARACTER_IDS, teamOf, charactersOfTeam };

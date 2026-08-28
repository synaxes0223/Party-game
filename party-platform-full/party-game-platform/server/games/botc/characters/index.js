// characters/index.js
// The registry: character id -> team, and (once a module has night
// behavior) character id -> module. teamOf/charactersOfTeam are pure data
// lookups every other file uses instead of hard-coding team lists.

const TEAM_OF = {
  washerwoman: "townsfolk",
  empath: "townsfolk",
  fortuneTeller: "townsfolk",
  soldier: "townsfolk",
  chef: "townsfolk",
  investigator: "townsfolk",
  librarian: "townsfolk",
  monk: "townsfolk",
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

// Populated lazily (not at module load) to avoid a require() cycle: the
// character modules themselves require this file for teamOf/charactersOfTeam.
let modulesById = null;
function getModule(characterId) {
  if (!modulesById) {
    modulesById = {
      washerwoman: require("./washerwoman"),
      empath: require("./empath"),
      fortuneTeller: require("./fortuneTeller"),
      soldier: require("./soldier"),
      chef: require("./chef"),
      investigator: require("./investigator"),
      librarian: require("./librarian"),
      monk: require("./monk"),
      poisoner: require("./poisoner"),
      butler: require("./butler"),
      imp: require("./imp"),
      baron: require("./baron"),
    };
  }
  return modulesById[characterId] || null;
}

// getModuleForStep resolves either a character id or a pseudo-step id to its
// module -- nightLoop.js only needs one lookup function for both.
let stepModulesById = null;
function getModuleForStep(stepId) {
  if (stepId === "minion-info" || stepId === "demon-info") {
    if (!stepModulesById) {
      stepModulesById = {
        "minion-info": require("../steps/minionInfo"),
        "demon-info": require("../steps/demonInfo"),
      };
    }
    return stepModulesById[stepId] || null;
  }
  return getModule(stepId);
}

module.exports = { TEAM_OF, ALL_CHARACTER_IDS, teamOf, charactersOfTeam, getModule, getModuleForStep };

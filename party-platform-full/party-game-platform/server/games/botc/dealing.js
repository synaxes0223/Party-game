// dealing.js
// Random and manual character assignment. Alignment always follows team
// (good for Townsfolk/Outsider, evil for Minion/Demon in Trouble Brewing),
// so callers never specify it separately.

const stateModule = require("./state");
const grimoire = require("./grimoire");
const characters = require("./characters");

const GOOD_TEAMS = new Set(["townsfolk", "outsider"]);

function alignmentForTeam(team) {
  return GOOD_TEAMS.has(team) ? "good" : "evil";
}

function dealManual(state, assignments) {
  // Validate everything before mutating anything, so a bad entry never
  // leaves a partially-dealt room.
  const resolved = [];
  for (const { seatId, characterId, believedCharacterId } of assignments) {
    const seat = stateModule.findSeatById(state, seatId);
    if (!seat) return { error: `Unknown seat id: ${seatId}` };
    const team = characters.teamOf(characterId);
    if (!team) return { error: `Unknown character id: ${characterId}` };
    if (characterId === "drunk") {
      if (!believedCharacterId || characters.teamOf(believedCharacterId) !== "townsfolk") {
        return { error: `The Drunk needs a believed Townsfolk (got ${believedCharacterId || "none"}).` };
      }
    }
    resolved.push({ seat, characterId, team, believedCharacterId });
  }
  for (const { seat, characterId, team, believedCharacterId } of resolved) {
    if (characterId === "drunk") grimoire.setDrunk(seat, believedCharacterId);
    else grimoire.setCharacter(seat, characterId, alignmentForTeam(team));
  }
  return {};
}

function dealRandom(state, characterCounts) {
  const requestedTotal = Object.values(characterCounts).reduce((a, b) => a + b, 0);
  if (requestedTotal !== state.seats.length) {
    return { error: `Requested ${requestedTotal} characters for ${state.seats.length} seats.` };
  }

  const teamKeyToRegistryTeam = {
    townsfolk: "townsfolk",
    outsiders: "outsider",
    minions: "minion",
    demon: "demon",
  };

  const pool = [];
  for (const [countKey, registryTeam] of Object.entries(teamKeyToRegistryTeam)) {
    const count = characterCounts[countKey] || 0;
    const available = characters.charactersOfTeam(registryTeam);
    if (count > available.length) {
      return { error: `Requested ${count} ${countKey}, but this plan only has ${available.length} implemented.` };
    }
    const shuffled = shuffle(available);
    pool.push(...shuffled.slice(0, count));
  }

  const shuffledPool = shuffle(pool);
  const dealtIds = new Set(shuffledPool);
  const townsfolkNotInPlay = characters.charactersOfTeam("townsfolk").filter((id) => !dealtIds.has(id));
  const believedPool = townsfolkNotInPlay.length ? townsfolkNotInPlay : characters.charactersOfTeam("townsfolk");
  const assignments = state.seats.map((seat, i) => {
    const characterId = shuffledPool[i];
    if (characterId !== "drunk") return { seatId: seat.seatId, characterId };
    const believedCharacterId = believedPool[Math.floor(Math.random() * believedPool.length)];
    return { seatId: seat.seatId, characterId, believedCharacterId };
  });
  return dealManual(state, assignments);
}

function teamCountsOf(state) {
  const counts = { townsfolk: 0, outsiders: 0, minions: 0, demon: 0 };
  const registryTeamToCountKey = { townsfolk: "townsfolk", outsider: "outsiders", minion: "minions", demon: "demon" };
  for (const seat of state.seats) {
    if (!seat.characterId) continue;
    const registryTeam = characters.teamOf(seat.characterId);
    const key = registryTeamToCountKey[registryTeam];
    if (key) counts[key] += 1;
  }
  return counts;
}

function assignFortuneTellerRedHerring(state) {
  const ft = state.seats.find((s) => s.characterId === "fortuneTeller");
  if (!ft) return;
  const already = state.seats.some((s) => s.reminders.some((r) => r.kind === "red-herring"));
  if (already) return;
  const eligible = state.seats.filter((s) => s.seatId !== ft.seatId && s.alignment === "good");
  if (eligible.length === 0) return;
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  grimoire.addReminder(state, pick, "red-herring", "fortuneTeller", "Red herring");
}

function shuffle(array) {
  const copy = array.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

module.exports = { dealManual, dealRandom, teamCountsOf, alignmentForTeam, assignFortuneTellerRedHerring };

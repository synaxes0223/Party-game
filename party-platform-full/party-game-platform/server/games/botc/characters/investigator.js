// investigator.js
// "You start knowing that 1 of 2 players is a particular Minion." First
// night only, no choice -- same structure as washerwoman.js, retargeted
// from the Townsfolk team to the Minion team.

const characters = require("./index");

function otherSeats(state, seat) {
  return state.seats.filter((s) => s.seatId !== seat.seatId);
}

function allPairs(seats) {
  const pairs = [];
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) pairs.push([seats[i], seats[j]]);
  }
  return pairs;
}

function toShown(pair) {
  return pair.map((s) => ({ seatId: s.seatId, nickname: s.nickname }));
}

function computeCandidates(state, seat) {
  const others = otherSeats(state, seat);
  const candidates = [];

  const inPlayMinions = others.filter((s) => characters.teamOf(s.characterId) === "minion");
  for (const truthSeat of inPlayMinions) {
    for (const decoy of others.filter((s) => s.seatId !== truthSeat.seatId)) {
      candidates.push({
        id: `true-${truthSeat.characterId}-${truthSeat.seatId}-${decoy.seatId}`,
        label: `True: reveals ${truthSeat.characterId}`,
        truthful: true,
        payload: { characterId: truthSeat.characterId, shown: toShown([truthSeat, decoy]) },
      });
    }
  }

  for (const characterId of characters.charactersOfTeam("minion")) {
    for (const pair of allPairs(others)) {
      const actuallyTrue =
        (characters.teamOf(pair[0].characterId) === "minion" && pair[0].characterId === characterId) ||
        (characters.teamOf(pair[1].characterId) === "minion" && pair[1].characterId === characterId);
      if (actuallyTrue) continue;
      candidates.push({
        id: `false-${characterId}-${pair[0].seatId}-${pair[1].seatId}`,
        label: `False: reveals ${characterId}`,
        truthful: false,
        payload: { characterId, shown: toShown(pair) },
      });
    }
  }

  return candidates;
}

function renderForPlayer(payload) {
  const [a, b] = payload.shown;
  return `One of ${a.nickname} and ${b.nickname} is the ${payload.characterId}.`;
}

module.exports = {
  id: "investigator",
  team: "townsfolk",
  night: { firstNight: true, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};

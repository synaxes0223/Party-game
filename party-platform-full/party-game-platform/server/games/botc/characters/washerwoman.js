// washerwoman.js
// "You start knowing that 1 of 2 players is a particular Townsfolk."
// First night only. The Storyteller picks directly from computeCandidates --
// there is no player-driven target choice to make first.

const characters = require("./index");

function otherSeats(state, seat) {
  return state.seats.filter((s) => s.seatId !== seat.seatId);
}

function allPairs(seats) {
  const pairs = [];
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      pairs.push([seats[i], seats[j]]);
    }
  }
  return pairs;
}

function toShown(pair) {
  return pair.map((seat) => ({ seatId: seat.seatId, nickname: seat.nickname }));
}

function computeCandidates(state, seat) {
  const others = otherSeats(state, seat);
  const candidates = [];

  const inPlayTownsfolk = state.seats.filter(
    (s) => s.seatId !== seat.seatId && characters.teamOf(s.characterId) === "townsfolk"
  );
  for (const truthSeat of inPlayTownsfolk) {
    const decoys = others.filter((s) => s.seatId !== truthSeat.seatId);
    for (const decoy of decoys) {
      candidates.push({
        id: `true-${truthSeat.characterId}-${truthSeat.seatId}-${decoy.seatId}`,
        label: `True: reveals ${truthSeat.characterId}`,
        truthful: true,
        payload: { characterId: truthSeat.characterId, shown: toShown([truthSeat, decoy]) },
      });
    }
  }

  const allTownsfolkIds = characters.charactersOfTeam("townsfolk");
  for (const characterId of allTownsfolkIds) {
    for (const pair of allPairs(others)) {
      const isActuallyTrue = characters.teamOf(pair[0].characterId) === "townsfolk" && pair[0].characterId === characterId
        || characters.teamOf(pair[1].characterId) === "townsfolk" && pair[1].characterId === characterId;
      if (isActuallyTrue) continue; // already added above as a true candidate
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
  id: "washerwoman",
  team: "townsfolk",
  night: { firstNight: true, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};

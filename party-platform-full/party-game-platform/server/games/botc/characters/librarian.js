// librarian.js
// "You start knowing that 1 of 2 players is a particular Outsider. (Or that
// zero are in play.)" First night only, no choice. Same pair-generation as
// investigator.js, plus the distinct 'no Outsiders' candidate.

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
  const outsidersInPlay = others.filter((s) => characters.teamOf(s.characterId) === "outsider");

  for (const truthSeat of outsidersInPlay) {
    for (const decoy of others.filter((s) => s.seatId !== truthSeat.seatId)) {
      candidates.push({
        id: `true-${truthSeat.characterId}-${truthSeat.seatId}-${decoy.seatId}`,
        label: `True: reveals ${truthSeat.characterId}`,
        truthful: true,
        payload: { characterId: truthSeat.characterId, shown: toShown([truthSeat, decoy]) },
      });
    }
  }

  for (const characterId of characters.charactersOfTeam("outsider")) {
    for (const pair of allPairs(others)) {
      const actuallyTrue =
        (characters.teamOf(pair[0].characterId) === "outsider" && pair[0].characterId === characterId) ||
        (characters.teamOf(pair[1].characterId) === "outsider" && pair[1].characterId === characterId);
      if (actuallyTrue) continue;
      candidates.push({
        id: `false-${characterId}-${pair[0].seatId}-${pair[1].seatId}`,
        label: `False: reveals ${characterId}`,
        truthful: false,
        payload: { characterId, shown: toShown(pair) },
      });
    }
  }

  candidates.push({
    id: "none",
    label: outsidersInPlay.length === 0 ? "True: no Outsiders in play" : "False: no Outsiders in play",
    truthful: outsidersInPlay.length === 0,
    payload: { none: true },
  });

  return candidates;
}

function renderForPlayer(payload) {
  if (payload.none) return "There are no Outsiders in play.";
  const [a, b] = payload.shown;
  return `One of ${a.nickname} and ${b.nickname} is the ${payload.characterId}.`;
}

module.exports = {
  id: "librarian",
  team: "townsfolk",
  night: { firstNight: true, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};

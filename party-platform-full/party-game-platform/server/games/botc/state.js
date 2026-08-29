// state.js
// Room state shape and pure seat/neighbor helpers for Blood on the
// Clocktower. Every other botc module reads/writes state through here (or
// through grimoire.js's reminder helpers) rather than poking fields
// directly, so seat lookups and the alive-neighbor walk stay correct in one
// place.

function createInitialState() {
  return {
    phase: "setup",
    dayNumber: 0,
    seats: [],
    nightPointer: null,
    day: null,
    ended: null,
    infoLog: [],
    nextReminderId: 1,
  };
}

function createSeat(seatId, playerToken, nickname) {
  return {
    seatId,
    playerToken,
    nickname,
    characterId: null,
    believedCharacterId: null,
    alignment: null,
    alive: true,
    usedDeadVote: false,
    verbal: false,
    reminders: [],
  };
}

function findSeatById(state, seatId) {
  return state.seats.find((s) => s.seatId === seatId) || null;
}

function findSeatByToken(state, playerToken) {
  return state.seats.find((s) => s.playerToken === playerToken) || null;
}

function aliveSeats(state) {
  return state.seats.filter((s) => s.alive);
}

function indexOfSeat(state, seatId) {
  return state.seats.findIndex((s) => s.seatId === seatId);
}

function physicalNeighborsOf(state, seatId) {
  const seats = state.seats;
  const i = indexOfSeat(state, seatId);
  if (i === -1) return { left: null, right: null };
  const n = seats.length;
  return {
    left: seats[(i - 1 + n) % n],
    right: seats[(i + 1) % n],
  };
}

// The Empath's "2 alive neighbours" are the nearest living players in each
// direction around the seating circle, skipping dead seats -- not the raw
// array-adjacent slots, which may be dead. With only two players alive
// total, left and right both resolve to that same other player.
function aliveNeighborsOf(state, seatId) {
  const seats = state.seats;
  const i = indexOfSeat(state, seatId);
  if (i === -1) return { left: null, right: null };
  const n = seats.length;

  let left = null;
  for (let step = 1; step < n; step++) {
    const candidate = seats[(i - step + n) % n];
    if (candidate.alive) {
      left = candidate;
      break;
    }
  }

  let right = null;
  for (let step = 1; step < n; step++) {
    const candidate = seats[(i + step) % n];
    if (candidate.alive) {
      right = candidate;
      break;
    }
  }

  return { left, right };
}

// A module-level counter would leak reminder ids across every room in this
// process; keeping the counter on state itself scopes it correctly per room.
function nextReminderId(state) {
  const id = state.nextReminderId;
  state.nextReminderId += 1;
  return id;
}

module.exports = {
  createInitialState,
  createSeat,
  findSeatById,
  findSeatByToken,
  aliveSeats,
  physicalNeighborsOf,
  aliveNeighborsOf,
  nextReminderId,
};

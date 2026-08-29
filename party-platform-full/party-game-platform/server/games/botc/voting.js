// voting.js
// Nomination bookkeeping and the sequential day vote. Threshold and tie
// rules per the spec's §7: required = max(ceil(alive/2), currentHighest+1);
// a tie with the current highest clears the block rather than replacing it.
// The Butler's vote-eligibility rule is applied when tallying, not while
// votes are being cast, so voting order never has to depend on whether the
// Butler's master has voted yet (see votingjs's effectiveVoteCount).

const stateModule = require("./state");
const virgin = require("./virgin");

function startDay(state) {
  state.day = {
    nominationsMade: [],
    nominationsReceived: [],
    currentNomination: null,
    onBlock: null,
    pendingVirgin: null,
    pendingSlayer: null,
    voteTimerMs: 15000,
  };
}

function votingOrderStartingLeftOf(state, nomineeSeatId) {
  const seats = state.seats;
  const n = seats.length;
  const nomineeIndex = seats.findIndex((s) => s.seatId === nomineeSeatId);
  // "the next seat clockwise from the nominee" votes first; the nominee
  // votes last. Every seat votes, alive or dead (a dead player with an
  // unspent ghost vote is still in the sequence; one already spent is
  // skipped by castVote rejecting it, not by omission from the order).
  const order = [];
  for (let step = 1; step <= n; step++) {
    order.push(seats[(nomineeIndex + step) % n].seatId);
  }
  return order;
}

function beginVoteFor(state, nominatorSeatId, nomineeSeatId) {
  state.day.currentNomination = {
    nominatorSeatId,
    nomineeSeatId,
    order: votingOrderStartingLeftOf(state, nomineeSeatId),
    currentVoterIndex: 0,
    votes: new Map(),
  };
}

function startNomination(state, nominatorSeatId, nomineeSeatId, opts = {}) {
  if (state.day.nominationsMade.includes(nominatorSeatId)) {
    return { error: "This player has already nominated today." };
  }
  if (state.day.nominationsReceived.includes(nomineeSeatId)) {
    return { error: "This player has already been nominated today." };
  }
  state.day.nominationsMade.push(nominatorSeatId);
  state.day.nominationsReceived.push(nomineeSeatId);

  const nominee = stateModule.findSeatById(state, nomineeSeatId);
  if (!opts.skipVirgin && nominee && virgin.isUnusedVirgin(nominee)) {
    state.day.pendingVirgin = { nominatorSeatId, nomineeSeatId };
    return { virginTrigger: { nominatorSeatId, nomineeSeatId } };
  }

  beginVoteFor(state, nominatorSeatId, nomineeSeatId);
  return {};
}

function requiredVotes(state) {
  const aliveCount = stateModule.aliveSeats(state).length;
  const simpleMajority = Math.ceil(aliveCount / 2);
  const currentHighest = state.day.onBlock ? state.day.onBlock.votes : 0;
  return Math.max(simpleMajority, currentHighest + 1);
}

function castVote(state, seatId, voted) {
  const seat = stateModule.findSeatById(state, seatId);
  if (!seat) return { error: `Unknown seat id: ${seatId}` };
  if (!seat.alive && seat.usedDeadVote) {
    return { error: "This player's ghost vote is already spent." };
  }
  state.day.currentNomination.votes.set(seatId, !!voted);
  if (!seat.alive) seat.usedDeadVote = true; // spent by voting at all, yes or no
  state.day.currentNomination.currentVoterIndex += 1;
  return {};
}

// Advance past the current voter without recording a vote -- for the
// Storyteller's "skip current voter" and for the auto-pass timer when the
// seat cannot vote at all (a dead player whose ghost vote is already spent,
// which castVote rejects without advancing). Every real vote still goes
// through castVote.
function forceSkipVoter(state) {
  const nom = state.day && state.day.currentNomination;
  if (!nom) return;
  nom.currentVoterIndex += 1;
}

// A Butler's yes vote only counts if their chosen master also voted yes on
// this same nomination -- checked at tally time so voting order never has
// to wait on the master's turn.
function effectiveVoteCount(state, votes) {
  let count = 0;
  for (const [seatId, voted] of votes.entries()) {
    if (!voted) continue;
    const seat = stateModule.findSeatById(state, seatId);
    const masterReminder = seat.reminders.find((r) => r.sourceCharacterId === "butler" && r.kind === "custom");
    if (masterReminder && masterReminder.targetSeatId != null) {
      if (votes.get(masterReminder.targetSeatId) !== true) continue;
    }
    count++;
  }
  return count;
}

function resolveNomination(state) {
  const nomination = state.day.currentNomination;
  const votes = effectiveVoteCount(state, nomination.votes);
  const aliveCount = stateModule.aliveSeats(state).length;
  const simpleMajority = Math.ceil(aliveCount / 2);

  let onBlock = state.day.onBlock;
  if (votes >= simpleMajority) {
    if (!onBlock || votes > onBlock.votes) {
      onBlock = { seatId: nomination.nomineeSeatId, votes };
    } else if (votes === onBlock.votes) {
      onBlock = null; // a tie with the current highest clears the block
    }
    // votes < onBlock.votes: no change, the existing block stands
  }
  state.day.onBlock = onBlock;
  state.day.currentNomination = null;

  return { onBlock: onBlock ? onBlock.seatId : null, votes };
}

module.exports = { startDay, startNomination, beginVoteFor, requiredVotes, castVote, forceSkipVoter, resolveNomination };

const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const grimoire = require("../games/botc/grimoire");
const voting = require("../games/botc/voting");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  voting.startDay(s);
  return s;
}

function sevenSeatGame() {
  return dealtState([
    { nickname: "P1", characterId: "washerwoman" },
    { nickname: "P2", characterId: "empath" },
    { nickname: "P3", characterId: "soldier" },
    { nickname: "P4", characterId: "butler" },
    { nickname: "P5", characterId: "poisoner" },
    { nickname: "P6", characterId: "baron" },
    { nickname: "P7", characterId: "imp" },
  ]);
}

test("startNomination sets up the voter order starting to the nominee's left, nominee last", () => {
  const s = sevenSeatGame();
  voting.startNomination(s, 4, 3); // seat 4 nominates seat 3 (Carol/P3)
  const order = s.day.currentNomination.order;
  // seat 3's left neighbour is seat 4 (wraps if needed); order should start at seat 4, wrap through, end at 3
  assert.equal(order[order.length - 1], 3, "the nominee votes last");
  assert.equal(order[0], 4, "voting starts to the nominee's left");
  assert.equal(order.length, 7);
});

test("startNomination rejects a second nomination by the same nominator on the same day", () => {
  const s = sevenSeatGame();
  voting.startNomination(s, 1, 2);
  voting.resolveNomination(s); // finish it so a new one can start (see resolveNomination test below for full flow)
  const result = voting.startNomination(s, 1, 3);
  assert.equal(typeof result.error, "string");
});

test("startNomination rejects nominating a player already nominated today", () => {
  const s = sevenSeatGame();
  voting.startNomination(s, 1, 2);
  voting.resolveNomination(s);
  const result = voting.startNomination(s, 3, 2);
  assert.equal(typeof result.error, "string");
});

test("requiredVotes is a simple majority of the alive count with no prior vote on the block", () => {
  const s = sevenSeatGame(); // 7 alive
  assert.equal(voting.requiredVotes(s), 4); // ceil(7/2) = 4
});

test("requiredVotes rises above the current highest vote count once someone is on the block", () => {
  const s = sevenSeatGame();
  s.day.onBlock = { seatId: 2, votes: 4 };
  assert.equal(voting.requiredVotes(s), 5); // currentHighest+1 (5) beats ceil(7/2)=4
});

test("castVote records each voter in order and spends a dead voter's ghost vote on any cast", () => {
  const s = sevenSeatGame();
  grimoire.setAlive(s.seats[0], false); // P1 dead, unspent ghost vote
  voting.startNomination(s, 3, 5); // seat 3 nominates seat 5
  const order = s.day.currentNomination.order;
  for (const seatId of order) {
    voting.castVote(s, seatId, false);
  }
  const deadVoter = s.seats.find((seat) => seat.seatId === order[0]);
  // whichever seat voted first in the order, confirm ghost-vote spending for the dead one specifically
  const p1 = s.seats[0];
  if (order.includes(1)) {
    assert.equal(p1.usedDeadVote, true);
  }
});

test("castVote rejects a vote from a dead player whose ghost vote is already spent", () => {
  const s = sevenSeatGame();
  const p1 = s.seats[0];
  grimoire.setAlive(p1, false);
  p1.usedDeadVote = true;
  voting.startNomination(s, 3, 5);
  if (s.day.currentNomination.order.includes(1)) {
    const result = voting.castVote(s, 1, true);
    assert.equal(typeof result.error, "string");
  }
});

test("resolveNomination puts the nominee on the block when votes reach the threshold", () => {
  const s = sevenSeatGame(); // 7 alive, threshold 4
  voting.startNomination(s, 1, 7); // nominate the Imp, seat 7
  for (const seatId of s.day.currentNomination.order) {
    voting.castVote(s, seatId, true); // everyone votes yes -> 7 votes, well over threshold
  }
  const result = voting.resolveNomination(s);
  assert.equal(result.onBlock, 7);
  assert.equal(result.votes, 7);
  assert.equal(s.day.onBlock.seatId, 7);
});

test("resolveNomination puts nobody on the block below threshold, and does not disturb an existing block", () => {
  const s = sevenSeatGame();
  voting.startNomination(s, 1, 2);
  for (const seatId of s.day.currentNomination.order) voting.castVote(s, seatId, true);
  voting.resolveNomination(s); // seat 2 now on the block with 7 votes

  voting.startNomination(s, 3, 4);
  for (const seatId of s.day.currentNomination.order) voting.castVote(s, seatId, false); // 0 votes, below threshold
  const result = voting.resolveNomination(s);
  assert.equal(result.onBlock, 2, "the earlier block survives an under-threshold nomination");
});

test("a tie with the current highest clears the block instead of replacing it", () => {
  const s = sevenSeatGame();
  voting.startNomination(s, 1, 2);
  for (const seatId of s.day.currentNomination.order) voting.castVote(s, seatId, true); // 7 votes, seat 2 on block
  voting.resolveNomination(s);

  voting.startNomination(s, 3, 4);
  const order = s.day.currentNomination.order;
  order.forEach((seatId, i) => voting.castVote(s, seatId, i < 7)); // also 7 yes votes -- a tie with the current highest
  const result = voting.resolveNomination(s);
  assert.equal(result.onBlock, null, "a tie removes whoever was on the block and seats nobody new");
  assert.equal(s.day.onBlock, null);
});

test("a Butler's vote does not count unless their chosen master also voted yes this same nomination", () => {
  const s = sevenSeatGame();
  const butlerSeat = s.seats.find((seat) => seat.characterId === "butler");
  const master = s.seats.find((seat) => seat.seatId !== butlerSeat.seatId);
  grimoire.addReminder(s, butlerSeat, "custom", "butler", `Master: ${master.nickname}`, master.seatId);

  voting.startNomination(s, 1, s.seats.find((seat) => seat.characterId === "imp").seatId);
  for (const seatId of s.day.currentNomination.order) {
    const isButler = seatId === butlerSeat.seatId;
    const isMaster = seatId === master.seatId;
    voting.castVote(s, seatId, isButler ? true : !isMaster ? false : false); // Butler votes yes, master votes no, everyone else no
  }
  const result = voting.resolveNomination(s);
  assert.equal(result.votes, 0, "the Butler's unbacked yes vote does not count");
});

test("a Butler's yes vote counts when their master also voted yes", () => {
  const s = sevenSeatGame();
  const butlerSeat = s.seats.find((seat) => seat.characterId === "butler");
  const master = s.seats.find((seat) => seat.seatId !== butlerSeat.seatId);
  grimoire.addReminder(s, butlerSeat, "custom", "butler", `Master: ${master.nickname}`, master.seatId);

  voting.startNomination(s, 1, s.seats.find((seat) => seat.characterId === "imp").seatId);
  for (const seatId of s.day.currentNomination.order) {
    const votesYes = seatId === butlerSeat.seatId || seatId === master.seatId;
    voting.castVote(s, seatId, votesYes);
  }
  const result = voting.resolveNomination(s);
  assert.equal(result.votes, 2, "both the Butler's and the master's yes votes count");
});

test("nominating an unused Virgin pauses: no vote starts, pendingVirgin is set, nomination is recorded", () => {
  const s = dealtState([
    { nickname: "P1", characterId: "investigator" },
    { nickname: "P2", characterId: "virgin" },
    { nickname: "P3", characterId: "imp" },
  ]);
  const result = voting.startNomination(s, 1, 2);
  assert.deepEqual(result, { virginTrigger: { nominatorSeatId: 1, nomineeSeatId: 2 } });
  assert.equal(s.day.currentNomination, null, "no vote begins");
  assert.deepEqual(s.day.pendingVirgin, { nominatorSeatId: 1, nomineeSeatId: 2 });
  assert.ok(s.day.nominationsMade.includes(1) && s.day.nominationsReceived.includes(2));
});

test("startNomination with skipVirgin begins the vote normally", () => {
  const s = dealtState([
    { nickname: "P1", characterId: "investigator" },
    { nickname: "P2", characterId: "virgin" },
    { nickname: "P3", characterId: "imp" },
  ]);
  const result = voting.startNomination(s, 1, 2, { skipVirgin: true });
  assert.deepEqual(result, {});
  assert.ok(s.day.currentNomination, "the vote started");
});

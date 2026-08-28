// e2e-botc.js
// Live integration check: runs the real server in-process and drives one
// full Blood on the Clocktower game through socket.io-client (no mocks).
// Run with: node test/e2e-botc.js

const { io } = require("socket.io-client");

const PORT = 3102;
const URL = `http://localhost:${PORT}`;

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function connect() {
  return new Promise((resolve) => {
    const s = io(URL);
    s.on("connect", () => resolve(s));
  });
}

let tokenCounter = 0;
function nextToken() {
  return `e2e-botc-token-${tokenCounter++}`;
}

async function createRoom() {
  const host = await connect();
  const hostToken = nextToken();
  const created = await new Promise((resolve) => {
    host.once("host:room-created", resolve);
    host.emit("host:create-room", { token: hostToken });
  });
  return { host, hostToken, roomCode: created.room.code };
}

async function joinPlayers(roomCode, names) {
  const players = [];
  for (const name of names) {
    const socket = await connect();
    const token = nextToken();
    await new Promise((resolve, reject) => {
      socket.once("player:joined", () => resolve());
      socket.once("player:join-error", (d) => reject(new Error(d.error)));
      socket.emit("player:join-room", { code: roomCode, nickname: name, token });
    });
    players.push({ name, socket, token });
  }
  return players;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// Advances the night one step at a time using the host's `nightStep`
// snapshot (Task 12's publicStateView) to decide, for each step, whether to
// submit a choice or a candidate pick -- and to know which seat/step is
// even active, since this plan's socket contract has no other way to find
// out. `chooseTarget(step, state)` lets a scenario control choice-based
// steps (e.g. who the Poisoner poisons); every no-choice step picks its
// first computed candidate, since this script only needs *a* legal pick,
// not a specific one, except where a scenario inspects the result after.
async function driveNightToEnd(host, roomCode, initialState, chooseTarget) {
  let state = initialState;
  let guard = 0;
  while (state.phase === "night" && guard < 20) {
    guard++;
    const step = state.nightStep;
    if (!step) throw new Error("driveNightToEnd: phase is 'night' but nightStep is null");
    const p = once(host, "host:botc-state");
    if (step.requiresChoice) {
      const targetSeatId = chooseTarget(step, state);
      host.emit("host:botc-night-choice", { code: roomCode, choice: { targetSeatId } });
    } else {
      const candidateId = step.candidates.length ? step.candidates[0].id : null;
      host.emit("host:botc-night-candidate", { code: roomCode, candidateId });
    }
    state = (await p).state;
  }
  if (state.phase === "night") throw new Error("driveNightToEnd: exceeded its step guard without the night ending");
  return state;
}

// The default target for a choice-based step this scenario doesn't care
// about: the first other alive seat, never the acting seat itself (which
// would trigger the Imp's self-kill succession or violate the Butler's
// "not yourself" rule).
function firstOtherAliveSeat(step, state) {
  const alt = state.seats.find((s) => s.alive && s.seatId !== step.seatId);
  return alt ? alt.seatId : step.seatId;
}

async function main() {
  const server = require("child_process");
  const proc = server.spawn(process.execPath, ["index.js"], {
    env: { ...process.env, PORT: String(PORT) },
  });
  await new Promise((resolve) => {
    proc.stdout.on("data", (d) => {
      if (d.toString().includes("Server running on port")) resolve();
    });
  });
  console.log(`Test server up on port ${PORT}`);

  try {
    // ---- Scenario 1: full game to a good-team win, with a poisoned Empath along the way ----
    console.log("\n[Scenario 1] Full game: setup, poisoning, night kill, execution, good wins");
    const { host, hostToken, roomCode } = await createRoom();
    const players = await joinPlayers(roomCode, ["Washerwoman", "Empath", "Soldier", "Poisoner", "Imp"]);

    host.emit("host:select-game", { code: roomCode, gameId: "botc" });

    const roleEvents = new Map();
    players.forEach((p) => {
      p.socket.once("game:botc-role", (payload) => roleEvents.set(p.name, payload));
    });
    const statePromise = once(host, "host:botc-state");
    host.emit("host:botc-manual-deal", {
      code: roomCode,
      assignments: [
        { seatId: 1, characterId: "washerwoman" },
        { seatId: 2, characterId: "empath" },
        { seatId: 3, characterId: "soldier" },
        { seatId: 4, characterId: "poisoner" },
        { seatId: 5, characterId: "imp" },
      ],
    });
    let state = (await statePromise).state;
    await new Promise((r) => setTimeout(r, 100)); // let the role emits land
    assertTrue(roleEvents.get("Poisoner").alignment === "evil", "Poisoner is dealt evil");
    assertTrue(roleEvents.get("Imp").alignment === "evil", "Imp is dealt evil");
    assertTrue(state.phase === "night", "the first night starts automatically after dealing");
    console.log("  PASS -- manual deal assigns the requested characters and starts night 1");

    // ---- Regression: a premature host:botc-vote must not crash the server ----
    // state.day is still null here (still night 1, before any nomination has
    // ever happened) -- games/botc/voting.js's castVote dereferences
    // state.day.currentNomination with no null check, so without a phase
    // guard in games/botc/index.js's host:botc-vote handler, this would throw
    // a synchronous TypeError inside the socket.on callback and take down the
    // whole Node process (every room, not just this one). There is no
    // incoming "request current state" event in this socket contract, so we
    // confirm two things instead: the guarded handler emits no host:botc-
    // state update at all (it returns before touching state or calling
    // emitState), and the host socket is still connected afterward. Night 1
    // being driven to completion normally right after this is itself further
    // proof the process is still alive and serving legitimate events.
    let prematureVoteProducedState = false;
    const prematureVoteListener = () => { prematureVoteProducedState = true; };
    host.once("host:botc-state", prematureVoteListener);
    host.emit("host:botc-vote", { code: roomCode, seatId: state.seats[0].seatId, voted: true });
    await new Promise((r) => setTimeout(r, 150)); // give a would-be crash/state-change time to manifest
    host.off("host:botc-state", prematureVoteListener);
    assertTrue(!prematureVoteProducedState, "a premature host:botc-vote (before any nomination exists) is a silent no-op, not a state change");
    assertTrue(host.connected, "the host socket is still connected -- a premature host:botc-vote did not crash the server");
    console.log("  PASS -- host:botc-vote before any nomination is open does not crash the server and is a no-op");

    // Drive the first night, sending the Poisoner's choice specifically at
    // the Empath (seat 2); every other choice-based step (Butler) and every
    // candidate-based step (minion-info, demon-info, Washerwoman, Empath)
    // takes driveNightToEnd's defaults.
    state = await driveNightToEnd(host, roomCode, state, (step, s) => {
      if (step.stepId === "poisoner") return 2; // seat 2 = Empath
      return firstOtherAliveSeat(step, s);
    });
    assertTrue(state.phase === "day-discussion", "the night ends and moves to day discussion");
    console.log("  PASS -- the first night runs to completion");

    const empathSeat = state.seats.find((s) => s.nickname === "Empath");
    assertTrue(empathSeat.reminders.some((r) => r.kind === "poisoned"), "the Empath is poisoned for tonight and tomorrow");
    console.log("  PASS -- the Poisoner's target is marked poisoned in the public state view");

    // ---- Reconnection: the poisoned Empath drops mid-game and rejoins ----
    // Regression coverage for the bug caught and fixed during Task 12's own
    // review (onPlayerRejoined used findSeatById instead of findSeatByToken):
    // a returning BotC player must get back the same character/alignment and
    // see their seat's live reminders (here, the poison just applied), not a
    // blank or mismatched re-send.
    const empathPlayer = players.find((p) => p.name === "Empath");
    const empathOriginalRole = roleEvents.get("Empath");

    empathPlayer.socket.disconnect();
    await new Promise((r) => setTimeout(r, 200));

    const returningEmpath = await connect();
    // Listeners go up before the rejoin is emitted, matching test/e2e-
    // reconnect.js's established idiom -- otherwise a fast server response
    // could fire these events before anything is listening for them.
    const roleAgainPromise = once(returningEmpath, "game:botc-role");
    const playerListAgainPromise = once(returningEmpath, "room:player-list");
    const rejoinedPromise = once(returningEmpath, "player:rejoined");
    returningEmpath.emit("player:join-room", { code: roomCode, nickname: "ignored-on-rejoin", token: empathPlayer.token });
    await rejoinedPromise;

    const roleAgain = await roleAgainPromise;
    assertTrue(roleAgain.characterId === empathOriginalRole.characterId, "reconnect resends the same characterId");
    assertTrue(roleAgain.alignment === empathOriginalRole.alignment, "reconnect resends the same alignment");

    // The player no longer receives host:botc-state on rejoin (Step 1's
    // fix) -- the same "did the reclaimed seat's state actually survive"
    // fact this check exists to prove is read from the HOST's own state
    // instead, which is legitimately entitled to it. This still exercises
    // the real Task-12-era regression class (findSeatById vs
    // findSeatByToken) this check was originally written to catch.
    const hostStateAfterRejoinPromise = once(host, "host:botc-state");
    host.emit("host:botc-request-state", { code: roomCode });
    const stateAgain = (await hostStateAfterRejoinPromise).state;
    const empathSeatAgain = stateAgain.seats.find((s) => s.nickname === "Empath");
    assertTrue(empathSeatAgain.alive === true, "the reclaimed seat is still alive");
    assertTrue(empathSeatAgain.reminders.some((r) => r.kind === "poisoned"), "the reclaimed seat still shows the poisoned reminder");

    const playerListAgain = await playerListAgainPromise;
    assertTrue(playerListAgain.players.length === 5, "the room still shows 5 seats after the reconnect (no duplicate, no drop)");
    console.log("  PASS -- a disconnected BotC player reclaims their seat with role, poison reminder and life state intact");

    empathPlayer.socket = returningEmpath; // swap in the live socket for cleanup at the end

    // ---- Nomination and execution: nominate and execute the Poisoner ----
    const poisonerSeat = state.seats.find((s) => s.nickname === "Poisoner");
    const washerwomanSeat = state.seats.find((s) => s.nickname === "Washerwoman");
    const nominatePromise = once(host, "host:botc-state");
    host.emit("host:botc-nominate", { code: roomCode, nominatorSeatId: washerwomanSeat.seatId, nomineeSeatId: poisonerSeat.seatId });
    await nominatePromise;

    for (const seat of state.seats) {
      const p = once(host, "host:botc-state");
      host.emit("host:botc-vote", { code: roomCode, seatId: seat.seatId, voted: true });
      state = (await p).state;
    }
    const resolvePromise = once(host, "host:botc-state");
    host.emit("host:botc-resolve-vote", { code: roomCode });
    state = (await resolvePromise).state;
    assertTrue(state.day.onBlock && state.day.onBlock.seatId === poisonerSeat.seatId, "the Poisoner is on the block");
    console.log("  PASS -- a unanimous vote puts the nominee on the block");

    const executePromise = once(host, "host:botc-state");
    host.emit("host:botc-execute", { code: roomCode, seatId: poisonerSeat.seatId });
    state = (await executePromise).state;
    const executedSeat = state.seats.find((s) => s.seatId === poisonerSeat.seatId);
    assertTrue(executedSeat.alive === false, "the executed player is now dead");
    console.log("  PASS -- execution kills the seat on the block");

    // ---- Night 2: the Imp targets the Soldier (safe), then the rest of the night runs ----
    // With the sole Minion (Poisoner) dead, night 2's order runs only Imp,
    // Empath and Butler. Day 1 ended in an execution, not a win -- the game
    // is still in "day-discussion" until the Storyteller explicitly begins
    // the next night (there is no automatic day-to-night transition).
    const beginNightPromise = once(host, "host:botc-state");
    host.emit("host:botc-begin-night", { code: roomCode });
    state = (await beginNightPromise).state;
    assertTrue(state.phase === "night", "the Storyteller can explicitly begin the next night");
    assertTrue(state.nightStep.stepId === "imp", "the Imp is night 2's first schedulable step, the dead Poisoner skipped");
    console.log("  PASS -- host:botc-begin-night starts night 2");

    const soldierSeat = state.seats.find((s) => s.nickname === "Soldier");
    state = await driveNightToEnd(host, roomCode, state, (step, s) => {
      if (step.stepId === "imp") return soldierSeat.seatId;
      return firstOtherAliveSeat(step, s);
    });
    const soldierAfter = state.seats.find((s) => s.seatId === soldierSeat.seatId);
    assertTrue(soldierAfter.alive === true, "an un-impaired Soldier survives the Demon's kill");
    assertTrue(state.phase === "day-discussion", "night 2 completes");
    console.log("  PASS -- the Soldier is safe from the Demon's kill, and night 2 runs to completion");

    // ---- Execute the Imp to end the game ----
    const impSeat = state.seats.find((s) => s.nickname === "Imp");
    const nom2 = once(host, "host:botc-state");
    host.emit("host:botc-nominate", { code: roomCode, nominatorSeatId: washerwomanSeat.seatId, nomineeSeatId: impSeat.seatId });
    await nom2;
    for (const seat of state.seats) {
      if (!seat.alive) continue;
      const p = once(host, "host:botc-state");
      host.emit("host:botc-vote", { code: roomCode, seatId: seat.seatId, voted: true });
      state = (await p).state;
    }
    const resolve2 = once(host, "host:botc-state");
    host.emit("host:botc-resolve-vote", { code: roomCode });
    state = (await resolve2).state;

    const endedPromise = once(host, "game:botc-ended");
    host.emit("host:botc-execute", { code: roomCode, seatId: impSeat.seatId });
    const ended = await endedPromise;
    assertTrue(ended.winner === "good", "executing the Demon ends the game with a good win");
    console.log("  PASS -- executing the Demon ends the game, good wins");

    host.disconnect();
    players.forEach((p) => p.socket.close());

    // ---- Scenario 2: player-driven night choice and vote, plus an off-turn vote is rejected ----
    console.log("\n[Scenario 2] A player acts on their own turn via player:botc-night-choice and player:botc-vote");
    const room2 = await createRoom();
    const players2 = await joinPlayers(room2.roomCode, ["Poisoner2", "Empath2", "Soldier2", "Butler2", "Imp2"]);

    // Registered before dealing even happens -- this deal includes both a
    // Minion and a Demon, so minion-info and demon-info both run BEFORE the
    // Poisoner (see nightOrder.js's FIRST_NIGHT_ORDER), and neither is a
    // choice step, so no prompt fires for them. Registering the listener
    // this early means it can't be missed no matter how many non-choice
    // steps precede the Poisoner's actual turn.
    const yourTurnPromise = once(players2[0].socket, "game:botc-your-turn"); // Poisoner2, seat 1
    const dealStatePromise = once(room2.host, "host:botc-state");
    room2.host.emit("host:botc-manual-deal", {
      code: room2.roomCode,
      assignments: [
        { seatId: 1, characterId: "poisoner" },
        { seatId: 2, characterId: "empath" },
        { seatId: 3, characterId: "soldier" },
        { seatId: 4, characterId: "butler" },
        { seatId: 5, characterId: "imp" },
      ],
    });
    let state2 = (await dealStatePromise).state;

    // Drive past minion-info and demon-info (candidate-based, no
    // player-turn prompt) via the host, until nightStep reaches the
    // Poisoner -- exactly like driveNightToEnd would, but done manually
    // here since this scenario needs to stop partway through the night
    // rather than drive it to completion in one call.
    let pseudoStepGuard = 0;
    while (state2.nightStep && state2.nightStep.stepId !== "poisoner" && pseudoStepGuard < 5) {
      pseudoStepGuard++;
      const p = once(room2.host, "host:botc-state");
      const candidates = state2.nightStep.candidates;
      room2.host.emit("host:botc-night-candidate", { code: room2.roomCode, candidateId: candidates.length ? candidates[0].id : null });
      state2 = (await p).state;
    }
    assertTrue(state2.nightStep && state2.nightStep.stepId === "poisoner", "the Poisoner's turn comes right after the pseudo-steps in this deal");

    const yourTurn = await yourTurnPromise;
    assertTrue(yourTurn.choiceType === "select-one-player", "the prompt names the correct choice type");
    assertTrue(yourTurn.targets.length === 5, "the prompt lists every seat as a potential target");
    console.log("  PASS -- the Poisoner's phone receives a targeted game:botc-your-turn prompt");

    const empathSeat2Id = state2.seats.find((s) => s.nickname === "Empath2").seatId;
    const afterChoicePromise = once(room2.host, "host:botc-state");
    players2[0].socket.emit("player:botc-night-choice", { code: room2.roomCode, choice: { targetSeatId: empathSeat2Id } });
    state2 = (await afterChoicePromise).state;
    const empathAfter = state2.seats.find((s) => s.seatId === empathSeat2Id);
    assertTrue(empathAfter.reminders.some((r) => r.kind === "poisoned"), "the player-submitted choice applied the poison, same as a host-submitted one would");
    console.log("  PASS -- player:botc-night-choice has the same effect as the host-entered equivalent");

    state2 = await driveNightToEnd(room2.host, room2.roomCode, state2, (step, s) => firstOtherAliveSeat(step, s));
    assertTrue(state2.phase === "day-discussion", "the first night completes normally after the player-submitted step");

    const impSeat2 = state2.seats.find((s) => s.nickname === "Imp2");
    const poisonerSeat2 = state2.seats.find((s) => s.nickname === "Poisoner2");
    const voteTurnPromise = once(players2[0].socket, "game:botc-your-turn-to-vote"); // Poisoner2 votes first per seating order from seat 5 (Imp) as nominee -> starts at seat 1
    const nominatePromise2 = once(room2.host, "host:botc-state");
    room2.host.emit("host:botc-nominate", { code: room2.roomCode, nominatorSeatId: empathSeat2Id, nomineeSeatId: impSeat2.seatId });
    const voteTurn = await voteTurnPromise;
    state2 = (await nominatePromise2).state;
    assertTrue(voteTurn.nomineeSeatId === impSeat2.seatId, "the vote-turn prompt names the correct nominee");
    console.log("  PASS -- the first voter's phone receives a targeted game:botc-your-turn-to-vote prompt");

    // An off-turn player (Butler2, not the current voter) tries to vote --
    // must be silently ignored, not accepted.
    const butlerSeat2 = state2.seats.find((s) => s.nickname === "Butler2");
    const butlerSocket2 = players2.find((p) => p.name === "Butler2").socket;
    butlerSocket2.emit("player:botc-vote", { code: room2.roomCode, voted: true });
    await new Promise((r) => setTimeout(r, 150)); // give a wrongly-accepted vote time to land before we check
    const stateAfterOffTurnAttempt = await new Promise((resolve) => {
      room2.host.once("host:botc-state", resolve);
      room2.host.emit("host:botc-vote", { code: room2.roomCode, seatId: poisonerSeat2.seatId, voted: true }); // the real current voter votes, forcing a fresh state emit to inspect
    });
    const votesSoFar = stateAfterOffTurnAttempt.state.day.currentNomination.votes;
    assertTrue(!votesSoFar.some((v) => v.seatId === butlerSeat2.seatId), "the off-turn player's vote was rejected, not recorded");
    assertTrue(votesSoFar.some((v) => v.seatId === poisonerSeat2.seatId), "the genuine current voter's vote (submitted via host:botc-vote here) was recorded");
    console.log("  PASS -- an off-turn player:botc-vote attempt is silently rejected");

    room2.host.disconnect();
    players2.forEach((p) => p.socket.close());

    // ---- Scenario 3: host-truth state view, safe rejoin, on-demand state request ----
    console.log("\n[Scenario 3] The host sees true character/alignment; a rejoining player never does; a fresh host connection can pull current state");
    const room3 = await createRoom();
    const players3 = await joinPlayers(room3.roomCode, ["Alice3", "Bob3", "Carol3", "Dave3", "Eve3"]);

    const dealtPromise3 = once(room3.host, "host:botc-state");
    room3.host.emit("host:botc-manual-deal", {
      code: room3.roomCode,
      assignments: [
        { seatId: 1, characterId: "washerwoman" },
        { seatId: 2, characterId: "empath" },
        { seatId: 3, characterId: "soldier" },
        { seatId: 4, characterId: "butler" },
        { seatId: 5, characterId: "imp" },
      ],
    });
    const state3 = (await dealtPromise3).state;

    // The host's own state view must carry the truth for every seat -- this
    // is what makes a real grimoire renderable at all.
    const impSeat3 = state3.seats.find((s) => s.nickname === "Eve3");
    assertTrue(impSeat3.characterId === "imp", "the host's state view includes each seat's true characterId");
    assertTrue(impSeat3.believedCharacterId === "imp", "the host's state view includes each seat's believedCharacterId");
    assertTrue(impSeat3.alignment === "evil", "the host's state view includes each seat's true alignment");

    // A player reconnecting must NEVER receive that same truth. Rather than
    // asserting the negative on a fixed timer (flaky either way), disconnect
    // and reclaim the Imp's own seat, capture every event that arrives on
    // their socket for a bounded window, and confirm characterId/alignment
    // never appear anywhere in it -- including inside a re-sent role event,
    // which is expected to carry the player's BELIEVED character only (an
    // Imp's own role reveal legitimately includes their own characterId,
    // which is not a leak of anyone ELSE's identity -- so this checks no
    // OTHER seat's identity ever appears, and that host:botc-state itself
    // never arrives on this socket at all).
    const impPlayer3 = players3.find((p) => p.name === "Eve3");
    impPlayer3.socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    const reconnectedImp3 = await connect();
    const receivedEvents3 = [];
    reconnectedImp3.onAny((event, payload) => receivedEvents3.push({ event, payload }));
    reconnectedImp3.emit("player:join-room", { code: room3.roomCode, nickname: "Eve3", token: impPlayer3.token });
    await new Promise((r) => setTimeout(r, 150)); // let every event onPlayerRejoined fires actually arrive
    assertTrue(
      !receivedEvents3.some((e) => e.event === "host:botc-state"),
      "a reconnecting player's socket never receives host:botc-state at all"
    );
    // No payload delivered to this socket may contain a
    // "believedCharacterId" field at all -- that field only ever appears
    // inside a seat object in the host's publicStateView, so its presence
    // anywhere in what this socket received is the specific fingerprint of
    // the removed host:botc-state leak (and the "host:botc-state" check
    // above already covers the event-name half of the same fact).
    const serialized3 = JSON.stringify(receivedEvents3);
    assertTrue(
      !serialized3.includes("believedCharacterId"),
      "no event delivered to a reconnecting player carries any seat's believedCharacterId"
    );
    reconnectedImp3.close();
    console.log("  PASS -- the host's state view carries true character/alignment, and a rejoining player never receives it");

    // A fresh host connection (simulating a reload/reconnect) can pull the
    // current snapshot on demand instead of waiting for the next mutation.
    const freshHostConn3 = await connect();
    const reclaimedPromise3 = once(freshHostConn3, "host:room-reclaimed");
    freshHostConn3.emit("host:reclaim-room", { code: room3.roomCode, token: room3.hostToken });
    await reclaimedPromise3;
    const requestedStatePromise3 = once(freshHostConn3, "host:botc-state");
    freshHostConn3.emit("host:botc-request-state", { code: room3.roomCode });
    const requestedState3 = (await requestedStatePromise3).state;
    assertTrue(requestedState3.phase === "night", "host:botc-request-state returns the actual current snapshot, not a stale one");
    console.log("  PASS -- a fresh host connection can pull the current state on demand via host:botc-request-state");

    freshHostConn3.close();
    room3.host.disconnect();
    players3.forEach((p) => p.socket.close());

    // ---- Scenario 4: seat reordering and manual overrides ----
    console.log("\n[Scenario 4] Post-deal seat reordering and every manual-override event");
    const room4 = await createRoom();
    const players4 = await joinPlayers(room4.roomCode, ["Alice4", "Bob4", "Carol4", "Dave4", "Eve4"]);

    const dealtPromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-manual-deal", {
      code: room4.roomCode,
      assignments: [
        { seatId: 1, characterId: "washerwoman" },
        { seatId: 2, characterId: "empath" },
        { seatId: 3, characterId: "soldier" },
        { seatId: 4, characterId: "butler" },
        { seatId: 5, characterId: "imp" },
      ],
    });
    let state4 = (await dealtPromise4).state;
    const originalOrder4 = state4.seats.map((s) => s.nickname);
    assertTrue(originalOrder4.join(",") === "Alice4,Bob4,Carol4,Dave4,Eve4", "the deal seated players in join order by default");

    const reorderPromise4 = once(room4.host, "host:botc-state");
    const reversedSeatIds4 = state4.seats.map((s) => s.seatId).reverse();
    room4.host.emit("host:botc-reorder-seats", { code: room4.roomCode, seatIds: reversedSeatIds4 });
    state4 = (await reorderPromise4).state;
    assertTrue(
      state4.seats.map((s) => s.nickname).join(",") === "Eve4,Dave4,Carol4,Bob4,Alice4",
      "host:botc-reorder-seats re-orders the seat array to the given seatId order"
    );

    const aliceSeat4 = state4.seats.find((s) => s.nickname === "Alice4");
    const setCharPromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-set-character", { code: room4.roomCode, seatId: aliceSeat4.seatId, characterId: "poisoner" });
    state4 = (await setCharPromise4).state;
    const aliceAfter4 = state4.seats.find((s) => s.seatId === aliceSeat4.seatId);
    assertTrue(aliceAfter4.characterId === "poisoner", "host:botc-set-character overrides the seat's true character");
    assertTrue(aliceAfter4.believedCharacterId === "poisoner", "host:botc-set-character also updates believedCharacterId");
    assertTrue(aliceAfter4.alignment === "evil", "host:botc-set-character derives alignment from the character's team, not a client-supplied value");

    const setAlivePromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-set-alive", { code: room4.roomCode, seatId: aliceSeat4.seatId, alive: false });
    state4 = (await setAlivePromise4).state;
    assertTrue(state4.seats.find((s) => s.seatId === aliceSeat4.seatId).alive === false, "host:botc-set-alive overrides life state directly");

    const addReminderPromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-add-reminder", { code: room4.roomCode, seatId: aliceSeat4.seatId, label: "Drunk (test)" });
    state4 = (await addReminderPromise4).state;
    const addedReminder4 = state4.seats.find((s) => s.seatId === aliceSeat4.seatId).reminders.find((r) => r.label === "Drunk (test)");
    assertTrue(!!addedReminder4, "host:botc-add-reminder attaches a free-text custom reminder");
    assertTrue(addedReminder4.kind === "custom", "a manually-added reminder is kind 'custom'");

    const removeReminderPromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-remove-reminder", { code: room4.roomCode, seatId: aliceSeat4.seatId, reminderId: addedReminder4.id });
    state4 = (await removeReminderPromise4).state;
    assertTrue(
      !state4.seats.find((s) => s.seatId === aliceSeat4.seatId).reminders.some((r) => r.id === addedReminder4.id),
      "host:botc-remove-reminder removes the reminder by id"
    );
    console.log("  PASS -- seat reordering, character/alignment override, alive override, and add/remove reminder all work");

    room4.host.disconnect();
    players4.forEach((p) => p.socket.close());

    console.log("\nALL BOTC E2E SCENARIOS PASSED");
    proc.kill();
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

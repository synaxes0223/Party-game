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
    const stateAgainPromise = once(returningEmpath, "host:botc-state");
    const playerListAgainPromise = once(returningEmpath, "room:player-list");
    const rejoinedPromise = once(returningEmpath, "player:rejoined");
    returningEmpath.emit("player:join-room", { code: roomCode, nickname: "ignored-on-rejoin", token: empathPlayer.token });
    await rejoinedPromise;

    const roleAgain = await roleAgainPromise;
    assertTrue(roleAgain.characterId === empathOriginalRole.characterId, "reconnect resends the same characterId");
    assertTrue(roleAgain.alignment === empathOriginalRole.alignment, "reconnect resends the same alignment");

    const stateAgain = (await stateAgainPromise).state;
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

    console.log("\nALL BOTC E2E SCENARIOS PASSED");
    proc.kill();
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

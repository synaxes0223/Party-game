// index.js (games/botc)
// Socket wiring for Blood on the Clocktower.

const stateModule = require("./state");
const grimoire = require("./grimoire");
const dealing = require("./dealing");
const distribution = require("./distribution");
const characters = require("./characters");
const nightLoop = require("./nightLoop");
const voting = require("./voting");
const winConditions = require("./winConditions");

const meta = {
  id: "botc",
  name: "Blood on the Clocktower",
  description: "A human Storyteller runs a game of hidden roles, night information, and sequential day voting.",
  minPlayers: 5,
  maxPlayers: 15,
  supportedModes: ["multiplayer"],
  // Sent to every client via the existing gameRegistry.listGames() ->
  // host:room-created/host:room-reclaimed payload, with zero new wiring --
  // the host UI's setup screen needs this table to warn (never block, per
  // spec's governing principle) when a deal doesn't match expectations,
  // and duplicating these 11 rows client-side would risk silently drifting
  // from distribution.js's own copy.
  distributionTable: distribution.BASE_TABLE,
};

// state.day.currentNomination.votes is a Map (voting.js's internal
// representation) -- a Map does not survive socket.io's JSON serialization
// (it silently arrives client-side as `{}`), so it must be converted to a
// plain array before this view is emitted.
function publicNomination(nomination) {
  if (!nomination) return null;
  return {
    nominatorSeatId: nomination.nominatorSeatId,
    nomineeSeatId: nomination.nomineeSeatId,
    order: nomination.order,
    currentVoterIndex: nomination.currentVoterIndex,
    votes: Array.from(nomination.votes.entries()).map(([seatId, voted]) => ({ seatId, voted })),
  };
}

// Without this, the Storyteller (and this task's e2e test) has no way to
// know whether the currently-active night step needs a player-driven
// choice (host:botc-night-choice) or a candidate pick (host:botc-night-
// candidate) -- or who it's currently running for. This is the one piece
// of "what do I do next" state a real grimoire UI absolutely needs, so it
// belongs in this plan's snapshot even though the rest of the UI does not.
function publicNightStep(state) {
  if (state.phase !== "night") return null;
  const step = nightLoop.currentStep(state);
  if (!step) return null;
  return {
    stepId: step.stepId,
    seatId: step.seat.seatId,
    nickname: step.seat.nickname,
    requiresChoice: step.requiresChoice,
    candidates: step.candidates,
  };
}

// The host is the Storyteller: the one party in the whole game entitled to
// every seat's TRUE character, believed character, and alignment. This is
// the grimoire itself -- withholding it here (as the earlier backend-only
// snapshot did, since it only needed phase/day/nightStep for its own e2e
// test) makes a real grimoire UI impossible to build. onPlayerRejoined
// below is what makes sure this richer view never reaches an actual player.
function publicStateView(state) {
  return {
    phase: state.phase,
    dayNumber: state.dayNumber,
    seats: state.seats.map((seat) => ({
      seatId: seat.seatId,
      nickname: seat.nickname,
      characterId: seat.characterId,
      believedCharacterId: seat.believedCharacterId,
      alignment: seat.alignment,
      alive: seat.alive,
      usedDeadVote: seat.usedDeadVote,
      reminders: seat.reminders.map((r) => ({ id: r.id, kind: r.kind, label: r.label })),
    })),
    day: state.day
      ? {
          nominationsMade: state.day.nominationsMade,
          nominationsReceived: state.day.nominationsReceived,
          currentNomination: publicNomination(state.day.currentNomination),
          onBlock: state.day.onBlock,
        }
      : null,
    nightStep: publicNightStep(state),
    ended: state.ended,
  };
}

function emitState(room, io) {
  io.to(room.hostId).emit("host:botc-state", { state: publicStateView(room.gameState) });
}

function applyWinCheckAndMaybeEnd(room, io) {
  const verdict = winConditions.checkWinCondition(room.gameState);
  if (verdict) {
    room.gameState.ended = verdict;
    room.gameState.phase = "ended";
    room.state = "results";
    io.in(room.code).emit("game:botc-ended", verdict);
  }
}

// Hoisted to module scope (see this task's description) so onPlayerRejoined
// can call them too -- none of the three ever referenced socket/ctx, only
// their own (room, io) parameters, so this is a pure relocation.
function maybeEndNight(room) {
  if (room.gameState.phase === "night" && nightLoop.isNightOver(room.gameState)) {
    room.gameState.phase = "day-discussion";
    voting.startDay(room.gameState);
  }
}

// Fires whenever the current night step needs a player-driven choice, so
// that player's phone gets a targeted, minimal prompt -- matching the
// spec's own framing ("the app lights up one phone at a time") rather
// than a general state broadcast, which would also leak grimoire-only
// information (reminders, other players' alignment) to every player.
// Pseudo-steps (minion-info/demon-info) never require a choice, so this
// never fires for them.
function maybePromptNightChoice(room, io) {
  if (room.gameState.phase !== "night") return;
  const step = nightLoop.currentStep(room.gameState);
  if (!step || !step.requiresChoice) return;
  io.to(step.seat.playerToken).emit("game:botc-your-turn", {
    choiceType: step.requiresChoice.type,
    targets: room.gameState.seats.map((s) => ({ seatId: s.seatId, nickname: s.nickname, alive: s.alive })),
  });
}

// Fires whenever it's a specific seat's turn to vote on the current
// nomination, targeting just that player's phone with the minimal
// context needed to decide (who's nominated) -- matching
// maybePromptNightChoice's same "lights up one phone" design.
// nomination.currentVoterIndex is voting.js's own single source of truth
// for whose turn it is; this only reads it, never advances it.
function maybePromptVoteTurn(room, io) {
  const nomination = room.gameState.day && room.gameState.day.currentNomination;
  if (!nomination) return;
  const voterSeatId = nomination.order[nomination.currentVoterIndex];
  if (voterSeatId === undefined) return; // every seat in this nomination has already voted
  const voterSeat = stateModule.findSeatById(room.gameState, voterSeatId);
  if (!voterSeat) return;
  const nomineeSeat = stateModule.findSeatById(room.gameState, nomination.nomineeSeatId);
  io.to(voterSeat.playerToken).emit("game:botc-your-turn-to-vote", {
    nomineeSeatId: nomination.nomineeSeatId,
    nomineeNickname: nomineeSeat ? nomineeSeat.nickname : null,
  });
}

// Seat order is normally just room.players' Map insertion (join) order, but
// spec §6 requires the Storyteller to be able to arrange seat order BEFORE
// the first night (physical seating rarely matches join order), and both
// host:botc-start/host:botc-manual-deal assign seatId 1..N in one shot at
// deal time with no later opportunity to change it before night 1 begins.
// seatOrder (an array of player tokens) is optional and purely additive --
// every existing caller (including test/e2e-botc.js's Scenario 1/2) omits
// it and gets today's exact behavior back via the fallback.
function orderedPlayerEntries(room, seatOrder) {
  const all = Array.from(room.players.values());
  if (!Array.isArray(seatOrder) || seatOrder.length !== all.length) return all;
  const byToken = new Map(all.map((p) => [p.id, p]));
  const ordered = seatOrder.map((token) => byToken.get(token)).filter(Boolean);
  // A seatOrder containing a duplicate token (e.g. [A, A, C] for players
  // A/B/C) would resolve to the right LENGTH (3) while silently dropping B
  // and seating A twice -- checking the count of UNIQUE tokens too catches
  // that, alongside the already-covered "unknown token" case.
  const uniqueTokenCount = new Set(seatOrder).size;
  return ordered.length === all.length && uniqueTokenCount === all.length ? ordered : all;
}

function attach(io, socket, ctx) {
  const { roomService } = ctx;

  function withHostRoom(code, fn) {
    const room = roomService.getRoom(code);
    if (!room || room.hostId !== socket.data.token) return;
    if (!room.gameState) return;
    fn(room);
  }

  socket.on("host:botc-start", ({ code, seatOrder }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostId !== socket.data.token) return;

    const state = stateModule.createInitialState();
    const playerEntries = orderedPlayerEntries(room, seatOrder);
    state.seats = playerEntries.map((p, i) => stateModule.createSeat(i + 1, p.id, p.nickname));

    const base = distribution.baseDistributionFor(state.seats.length);
    if (!base) {
      socket.emit("host:botc-error", { error: `Blood on the Clocktower needs 5-15 players (got ${state.seats.length}).` });
      return;
    }
    const dealResult = dealing.dealRandom(state, base);
    if (dealResult.error) {
      socket.emit("host:botc-error", { error: dealResult.error });
      return;
    }

    room.gameId = meta.id;
    room.gameState = state;
    room.state = "in-progress";

    for (const seat of state.seats) {
      io.to(seat.playerToken).emit("game:botc-role", { characterId: seat.believedCharacterId, alignment: seat.alignment });
    }

    nightLoop.startNight(state);
    maybePromptNightChoice(room, io);
    emitState(room, io);
  });

  socket.on("host:botc-manual-deal", ({ code, assignments, seatOrder }) => {
    // Not routed through withHostRoom -- gameState doesn't exist yet at this
    // point, and withHostRoom's own guard requires it to already be set.
    const room = roomService.getRoom(code);
    if (!room || room.hostId !== socket.data.token) return;

    const state = stateModule.createInitialState();
    const playerEntries = orderedPlayerEntries(room, seatOrder);
    state.seats = playerEntries.map((p, i) => stateModule.createSeat(i + 1, p.id, p.nickname));

    const dealResult = dealing.dealManual(state, assignments);
    if (dealResult.error) {
      socket.emit("host:botc-error", { error: dealResult.error });
      return;
    }

    room.gameId = meta.id;
    room.gameState = state;
    room.state = "in-progress";

    for (const seat of state.seats) {
      io.to(seat.playerToken).emit("game:botc-role", { characterId: seat.believedCharacterId, alignment: seat.alignment });
    }

    nightLoop.startNight(state);
    maybePromptNightChoice(room, io);
    emitState(room, io);
  });

  // Lets a (re)connecting host pull the current snapshot on demand --
  // host:room-reclaimed carries no botc state at all today, so without this
  // a host who refreshes or reconnects mid-game sees nothing until the next
  // mutation happens to fire emitState naturally.
  socket.on("host:botc-request-state", ({ code }) => {
    withHostRoom(code, (room) => {
      emitState(room, io);
    });
  });

  socket.on("host:botc-night-choice", ({ code, choice }) => {
    withHostRoom(code, (room) => {
      nightLoop.submitChoice(room.gameState, choice);
      applyWinCheckAndMaybeEnd(room, io);
      maybeEndNight(room);
      maybePromptNightChoice(room, io);
      emitState(room, io);
    });
  });

  // The player-driven counterpart to host:botc-night-choice. A "your turn"
  // prompt is not proof of anything by itself -- this independently
  // re-derives whose turn it currently is and rejects anyone else, exactly
  // as if the prompt had never been sent.
  socket.on("player:botc-night-choice", ({ code, choice }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameState || room.gameId !== meta.id) return;
    const step = nightLoop.currentStep(room.gameState);
    if (!step || !step.requiresChoice) return;
    if (step.seat.playerToken !== socket.data.token) return;
    nightLoop.submitChoice(room.gameState, choice);
    applyWinCheckAndMaybeEnd(room, io);
    maybeEndNight(room);
    maybePromptNightChoice(room, io);
    emitState(room, io);
  });

  socket.on("host:botc-night-candidate", ({ code, candidateId }) => {
    withHostRoom(code, (room) => {
      const step = nightLoop.currentStep(room.gameState);
      const result = nightLoop.submitCandidate(room.gameState, candidateId);
      if (step && result.chosenCandidate) {
        const module = characters.getModuleForStep(step.stepId);
        const text = module.renderForPlayer(result.chosenCandidate.payload);
        if (text) io.to(step.seat.playerToken).emit("game:botc-info", { text });
      }
      maybeEndNight(room);
      maybePromptNightChoice(room, io);
      emitState(room, io);
    });
  });

  socket.on("host:botc-nominate", ({ code, nominatorSeatId, nomineeSeatId }) => {
    withHostRoom(code, (room) => {
      if (room.gameState.phase !== "day-discussion" || !room.gameState.day) return;
      voting.startNomination(room.gameState, nominatorSeatId, nomineeSeatId);
      maybePromptVoteTurn(room, io);
      emitState(room, io);
    });
  });

  socket.on("host:botc-vote", ({ code, seatId, voted }) => {
    withHostRoom(code, (room) => {
      if (!room.gameState.day || !room.gameState.day.currentNomination) return;
      voting.castVote(room.gameState, seatId, voted);
      maybePromptVoteTurn(room, io);
      emitState(room, io);
    });
  });

  // The player-driven counterpart to host:botc-vote. Re-derives whose turn
  // it is directly from state.day.currentNomination -- the one source of
  // truth voting.js itself uses -- rather than trusting the client's claim
  // about which seat they are, so a stale or spoofed request from the wrong
  // player is silently ignored exactly like an out-of-turn host:botc-vote
  // targeting the wrong seatId would be.
  socket.on("player:botc-vote", ({ code, voted }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameState || room.gameId !== meta.id) return;
    if (!room.gameState.day || !room.gameState.day.currentNomination) return;
    const nomination = room.gameState.day.currentNomination;
    const currentSeatId = nomination.order[nomination.currentVoterIndex];
    const seat = stateModule.findSeatByToken(room.gameState, socket.data.token);
    if (!seat || seat.seatId !== currentSeatId) return;
    voting.castVote(room.gameState, seat.seatId, voted);
    maybePromptVoteTurn(room, io);
    emitState(room, io);
  });

  socket.on("host:botc-resolve-vote", ({ code }) => {
    withHostRoom(code, (room) => {
      if (!room.gameState.day || !room.gameState.day.currentNomination) return;
      voting.resolveNomination(room.gameState);
      emitState(room, io);
    });
  });

  socket.on("host:botc-execute", ({ code, seatId }) => {
    withHostRoom(code, (room) => {
      const seat = stateModule.findSeatById(room.gameState, seatId);
      if (seat) grimoire.setAlive(seat, false);
      applyWinCheckAndMaybeEnd(room, io);
      emitState(room, io);
    });
  });

  // The Storyteller calls this once dusk/execution is done and the game
  // hasn't ended, to move into the next night. nightLoop.startNight is only
  // otherwise called at game start (host:botc-start/host:botc-manual-deal),
  // so without this event the game would be stuck in "day-discussion"
  // forever after day 1 -- there is no automatic day-to-night transition.
  socket.on("host:botc-begin-night", ({ code }) => {
    withHostRoom(code, (room) => {
      if (room.gameState.phase === "ended") return;
      nightLoop.startNight(room.gameState);
      maybePromptNightChoice(room, io);
      emitState(room, io);
    });
  });
}

function onPlayerLeft(room, io, playerId) {
  // Seats are stable board positions; nothing to clean up on a lobby-only
  // departure (which is the only case index.js ever calls this for -- a
  // mid-game disconnect keeps the seat, per the durable-sessions plan).
}

// A returning player has lost every private message the game sent them.
// They get their own role again -- and, if it's genuinely their turn right
// now, a fresh copy of whichever prompt they would have otherwise missed.
// They do NOT get a state snapshot: publicStateView is the host's grimoire
// view (true characterId/believedCharacterId/alignment for every seat,
// including other players' evil identities) and must never reach a player.
// Calling the same maybePromptNightChoice/maybePromptVoteTurn the
// Storyteller's own actions use (rather than writing seat-scoped variants)
// means a harmless, occasional duplicate prompt to whichever OTHER seat
// currently holds the turn if a different player is the one reconnecting --
// accepted as simpler and safer than a second, parallel prompt-computation
// path that could drift from these two's logic over time.
function onPlayerRejoined(room, io, playerId) {
  const state = room.gameState;
  if (!state) return;
  const seat = stateModule.findSeatByToken(state, playerId);
  if (!seat) return;
  io.to(playerId).emit("game:botc-role", { characterId: seat.believedCharacterId, alignment: seat.alignment });
  maybePromptNightChoice(room, io);
  maybePromptVoteTurn(room, io);
}

module.exports = { meta, attach, onPlayerLeft, onPlayerRejoined };

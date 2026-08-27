// index.js (games/botc)
// Socket wiring for Blood on the Clocktower. Deliberately minimal: enough
// events to drive a full game from socket.io-client (test/e2e-botc.js),
// with no grimoire or player UI -- that's a follow-up plan (spec §3/§9).

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

function publicStateView(state) {
  return {
    phase: state.phase,
    dayNumber: state.dayNumber,
    seats: state.seats.map((seat) => ({
      seatId: seat.seatId,
      nickname: seat.nickname,
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

function attach(io, socket, ctx) {
  const { roomService } = ctx;

  function withHostRoom(code, fn) {
    const room = roomService.getRoom(code);
    if (!room || room.hostId !== socket.data.token) return;
    if (!room.gameState) return;
    fn(room);
  }

  socket.on("host:botc-start", ({ code }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostId !== socket.data.token) return;

    const state = stateModule.createInitialState();
    const playerEntries = Array.from(room.players.values());
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

  socket.on("host:botc-manual-deal", ({ code, assignments }) => {
    // Not routed through withHostRoom -- gameState doesn't exist yet at this
    // point, and withHostRoom's own guard requires it to already be set.
    const room = roomService.getRoom(code);
    if (!room || room.hostId !== socket.data.token) return;

    const state = stateModule.createInitialState();
    const playerEntries = Array.from(room.players.values());
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

  // Shared by both night-ending handlers below: flips phase and initializes
  // state.day via voting.startDay -- without this, state.day stays null and
  // the first host:botc-nominate of the day throws.
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
  // prompt (Task 1) is not proof of anything by itself -- this independently
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
      emitState(room, io);
    });
  });

  socket.on("host:botc-vote", ({ code, seatId, voted }) => {
    withHostRoom(code, (room) => {
      if (!room.gameState.day || !room.gameState.day.currentNomination) return;
      voting.castVote(room.gameState, seatId, voted);
      emitState(room, io);
    });
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

function onPlayerRejoined(room, io, playerId) {
  const state = room.gameState;
  if (!state) return;
  const seat = stateModule.findSeatByToken(state, playerId);
  if (!seat) return;
  io.to(playerId).emit("game:botc-role", { characterId: seat.believedCharacterId, alignment: seat.alignment });
  io.to(playerId).emit("host:botc-state", { state: publicStateView(state) }); // reuse the host's snapshot shape; the follow-up UI plan can split a player-scoped view out if needed
}

module.exports = { meta, attach, onPlayerLeft, onPlayerRejoined };

// wordWolf.js
// Game module: everyone gets the same secret word except one player (the
// "wolf"), who gets a different-but-related word. Runs as repeated
// elimination rounds, reusing the exact same generic voting/win-condition
// rules as Find the Imposter (imposterLogic.js), until the wolf is voted out
// (crew wins) or only 2 active players remain (wolf wins). Unlike Find the
// Imposter there is no ready-check and no playback -- nothing here needs
// preloading on a player's device, so a round starts the instant the host
// picks a word pair.

const { resolveRound, checkGameEnd } = require("./imposterLogic");
const { WORD_PAIRS, pickAutoPair, buildCustomPair } = require("./wordPairLogic");

const meta = {
  id: "word-wolf",
  name: "Word Wolf",
  description:
    "Everyone gets the same secret word — except one player, the wolf, who gets a related-but-different word. Discuss out loud without saying your word, then vote out who you think the wolf is over multiple rounds.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
};

function getActivePlayerIds(room) {
  const eliminated = room.gameState ? room.gameState.eliminated : new Set();
  return Array.from(room.players.keys()).filter((id) => {
    if (eliminated.has(id)) return false;
    const player = room.players.get(id);
    return !player || player.connected !== false;
  });
}

function getWordForPlayer(gs, pid) {
  return pid === gs.imposterId ? gs.wordPair.imposter.word : gs.wordPair.normal.word;
}

function freshRoundState(gameState) {
  gameState.wordPair = null;
  gameState.votes = new Map();
}

// Shared by both word-source paths: assigns the wolf on round 1, advances
// the round counter on later rounds, stores the resolved word pair, and
// sends the host their game:started signal (players get nothing yet --
// words are only sent once the host explicitly reveals).
function startRound(room, io, wordPair) {
  if (!room.gameState) {
    const playerIds = Array.from(room.players.keys());
    if (playerIds.length < meta.minPlayers) {
      return { error: `Need at least ${meta.minPlayers} players to start.` };
    }
    const imposterId = playerIds[Math.floor(Math.random() * playerIds.length)];
    room.gameState = {
      phase: "loading",
      round: 1,
      imposterId,
      eliminated: new Set(),
      usedPairIndexes: new Set(),
      lastRoundResult: null,
      winner: null,
    };
    freshRoundState(room.gameState);
  } else {
    room.gameState.round += 1;
    room.gameState.phase = "loading";
    freshRoundState(room.gameState);
  }

  const gs = room.gameState;
  gs.wordPair = wordPair;
  room.state = "in-progress";

  const activeIds = getActivePlayerIds(room);
  io.to(room.hostId).emit("game:started", {
    round: gs.round,
    playerCount: activeIds.length,
  });

  return {};
}

// Called when the host picks "Start Round with Random Pair".
function onSelectAutoPair(room, io) {
  const usedIndexes = room.gameState ? room.gameState.usedPairIndexes : new Set();
  const { pair, usedIndexes: nextUsed } = pickAutoPair(WORD_PAIRS, usedIndexes);
  const result = startRound(room, io, {
    normal: { sourceType: "auto", word: pair.normal },
    imposter: { sourceType: "auto", word: pair.imposter },
  });
  if (result.error) return result;
  room.gameState.usedPairIndexes = nextUsed;
  return {};
}

// Called when the host submits a custom normal/wolf word pair.
function onSelectCustomPair(room, io, { normalWord, imposterWord }) {
  const result = buildCustomPair(normalWord, imposterWord);
  if (result.error) return { error: result.error };
  return startRound(room, io, {
    normal: { sourceType: "custom", word: result.normal.word },
    imposter: { sourceType: "custom", word: result.imposter.word },
  });
}

// Host clicks "Reveal Words" -- only valid before any reveal has happened
// this round. Broadcasts each active player's own word.
function onHostReveal(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "loading") return { error: "Nothing to reveal yet." };
  gs.phase = "revealed";

  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    io.to(pid).emit("game:reveal-word", { gameId: meta.id, word: getWordForPlayer(gs, pid) });
  }
  return {};
}

// Called when a player submits their vote (or "skip") for this round.
function onVote(room, io, socketId, votedForId) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "revealed" && gs.phase !== "voting")) return {};

  const activeIds = getActivePlayerIds(room);
  if (!activeIds.includes(socketId)) return {};
  if (votedForId !== "skip" && (votedForId === socketId || !activeIds.includes(votedForId))) {
    io.to(socketId).emit("player:vote-rejected", {
      reason: "That player is no longer available to vote for. Pick again.",
    });
    return {};
  }

  gs.phase = "voting";
  gs.votes.set(socketId, votedForId);

  io.to(room.hostId).emit("game:vote-progress", {
    voted: gs.votes.size,
    total: activeIds.length,
  });

  if (activeIds.every((id) => gs.votes.has(id))) {
    resolveRoundAndAdvance(room, io);
  }
  return {};
}

function resolveRoundAndAdvance(room, io) {
  const gs = room.gameState;
  const activeIds = getActivePlayerIds(room);
  const { eliminatedId, tally } = resolveRound(activeIds, gs.votes);

  if (eliminatedId) gs.eliminated.add(eliminatedId);
  const remainingActive = getActivePlayerIds(room);
  const { gameOver, winner } = checkGameEnd(remainingActive, eliminatedId, gs.imposterId);

  const eliminatedPlayer = eliminatedId ? room.players.get(eliminatedId) : null;
  const wasImposter = eliminatedId !== null && eliminatedId === gs.imposterId;

  gs.lastRoundResult = { round: gs.round, eliminatedId, wasImposter, tally, remainingActive: remainingActive.length };
  gs.phase = gameOver ? "game-over" : "round-results";

  io.in(room.code).emit("game:round-results", {
    round: gs.round,
    eliminated: eliminatedPlayer ? { id: eliminatedPlayer.id, nickname: eliminatedPlayer.nickname } : null,
    wasImposter,
    voteTally: tally,
    remainingActive: remainingActive.length,
  });

  if (gameOver) {
    gs.winner = winner;
    revealFinalResults(room, io, winner);
  }
}

function revealFinalResults(room, io, winner) {
  const gs = room.gameState;
  room.state = "results";
  const imposterPlayer = room.players.get(gs.imposterId);

  const results = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    wasImposter: p.id === gs.imposterId,
    eliminated: gs.eliminated.has(p.id),
  }));

  io.in(room.code).emit("game:results", {
    imposter: imposterPlayer ? { id: imposterPlayer.id, nickname: imposterPlayer.nickname } : null,
    winner,
    results,
  });
}

// Host advances from round-results back to word-select for the next round.
// Unlike Find the Imposter's game:track-pairs, there's no list to send --
// the host UI's Auto/Custom controls need no server data to render.
function onNextRound(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "round-results") return { error: "No round result to advance from." };
  gs.phase = "word-select";
  io.to(room.hostId).emit("game:word-select-ready", {});
  return {};
}

// Called from index.js's disconnect handler, AFTER roomService has already
// removed the player from room.players. Re-checks whether the round can now
// resolve with one fewer active player, and independently ends the game if
// attrition alone has dropped the active roster to 2 or fewer (that check
// otherwise only runs inside resolveRoundAndAdvance, so a disconnect-driven
// drop to 2 players would never end the game on its own). Does not specially
// detect the wolf themselves disconnecting -- matches the existing platform
// limitation of no reconnect/session-recovery support, not fixed here.
function onPlayerLeft(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase === "game-over") return {};

  gs.votes.delete(socketId);
  const activeIds = getActivePlayerIds(room);
  if (activeIds.length === 0) return {};

  if (activeIds.length <= 2) {
    gs.phase = "game-over";
    gs.winner = "imposter";
    revealFinalResults(room, io, "imposter");
    return {};
  }

  if (
    (gs.phase === "revealed" || gs.phase === "voting") &&
    activeIds.every((id) => gs.votes.has(id))
  ) {
    resolveRoundAndAdvance(room, io);
  }
  return {};
}

// A reconnecting player lost the private word we sent to their old socket.
// Only re-send if the word has actually been revealed this round -- before
// that, nothing was sent yet, and the normal reveal broadcast will cover them.
function onPlayerRejoined(room, io, playerId) {
  const gs = room.gameState;
  if (!gs) return;
  if (gs.phase === "game-over") {
    revealFinalResults(room, io, gs.winner);
    return;
  }
  if (gs.phase !== "revealed" && gs.phase !== "voting") return;
  io.to(playerId).emit("game:reveal-word", { gameId: meta.id, word: getWordForPlayer(gs, playerId) });
}

module.exports = {
  meta,
  onSelectAutoPair,
  onSelectCustomPair,
  onHostReveal,
  onVote,
  onNextRound,
  onPlayerLeft,
  onPlayerRejoined,
};

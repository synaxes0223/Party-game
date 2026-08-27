// findTheImposter.js
// Game module: one player secretly gets a slightly different audio track.
// Runs as repeated elimination rounds (Mafia/Werewolf-style) until either the
// imposter is voted out (crew wins) or only 2 active players remain (imposter wins).
//
// A round's track pair can come from three sources: the built-in SONG_PAIRS
// list, a host-pasted YouTube URL pair, or a pair picked from the host's
// uploaded-file pool. All three converge on startRound() once resolved into
// a common { normal, imposter } TrackRef shape.

const { resolveRound, checkGameEnd, computeElapsedMs, SYNC_BUFFER_MS } = require("./imposterLogic");
const { buildYoutubePair, pickUploadPair, computePlayerPosition } = require("./audioSourceLogic");
const uploadStore = require("./uploadStore");

const SONG_PAIRS = [
  {
    id: "pair1",
    label: "Track 1",
    normalUrl: "/audio/normal-song1.mp3",
    imposterUrl: "/audio/imposter-song1.mp3",
  },
];

const meta = {
  id: "find-the-imposter",
  name: "Find the Imposter",
  description:
    "Everyone hears the same song through their own earphones — except one player. Vote them out over multiple rounds before only two of you remain.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
};

function getTrackPairs() {
  return SONG_PAIRS.map((p) => ({ id: p.id, label: p.label }));
}

function getUploadedFiles() {
  return uploadStore.listFiles().map((f) => ({ id: f.id, originalName: f.originalName, uploadedAt: f.uploadedAt }));
}

function getActivePlayerIds(room) {
  const eliminated = room.gameState ? room.gameState.eliminated : new Set();
  return Array.from(room.players.keys()).filter((id) => {
    if (eliminated.has(id)) return false;
    const player = room.players.get(id);
    return !player || player.connected !== false;
  });
}

function getTrackForPlayer(gs, pid) {
  return pid === gs.imposterId ? gs.songPair.imposter : gs.songPair.normal;
}

function freshRoundState(gameState) {
  gameState.songPair = null;
  gameState.readyToPlay = new Set();
  gameState.votes = new Map();
  gameState.playback = { segmentStartedAt: null, segmentStartPosition: 0, isPaused: false };
}

// Shared by all three track-source paths: assigns the imposter on round 1,
// advances the round counter on later rounds, stores the resolved song pair,
// and sends each active player their own track plus the host their
// game:started signal.
function startRound(room, io, songPair) {
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
  gs.songPair = songPair;
  room.state = "in-progress";

  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    const track = getTrackForPlayer(gs, pid);
    io.to(pid).emit("game:load-audio", { gameId: meta.id, ...track });
  }

  io.to(room.hostId).emit("game:started", {
    round: gs.round,
    playerCount: activeIds.length,
  });

  return {};
}

// Called when the host picks a built-in track pair — this both selects the
// audio AND starts the round.
function onSelectTrackPair(room, io, pairId) {
  const pair = SONG_PAIRS.find((p) => p.id === pairId);
  if (!pair) return { error: "Unknown track pair." };

  return startRound(room, io, {
    normal: { sourceType: "builtin", audioUrl: pair.normalUrl, startSeconds: 0 },
    imposter: { sourceType: "builtin", audioUrl: pair.imposterUrl, startSeconds: 0 },
  });
}

// Called when the host submits a YouTube URL pair for this round.
function onSelectYoutubePair(room, io, { normal, imposter }) {
  const result = buildYoutubePair(normal, imposter);
  if (result.error) return { error: result.error };
  return startRound(room, io, { normal: result.normal, imposter: result.imposter });
}

// Called when the host picks (or partially picks, with random-fill) a pair
// from the uploaded-file pool for this round.
function onSelectUploadPair(room, io, { normalFileId, imposterFileId }) {
  const pool = uploadStore.listFiles();
  const result = pickUploadPair(pool, normalFileId, imposterFileId);
  if (result.error) return { error: result.error };
  return startRound(room, io, { normal: result.normal, imposter: result.imposter });
}

// Called when a player's client confirms audio is preloaded and ready.
function onPlayerReady(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "loading") return {};
  gs.readyToPlay.add(socketId);

  const activeIds = getActivePlayerIds(room);
  io.to(room.hostId).emit("game:ready-progress", {
    ready: gs.readyToPlay.size,
    total: activeIds.length,
  });

  if (activeIds.every((id) => gs.readyToPlay.has(id))) {
    io.to(room.hostId).emit("game:all-ready");
  }
  return {};
}

// Broadcasts a synced play instant to every active player, computing each
// player's own position (their track's start-second + the shared elapsed
// time) rather than one shared position — see audioSourceLogic.computePlayerPosition.
function broadcastPlayAt(room, io, startAt, elapsedMs) {
  const gs = room.gameState;
  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    const track = getTrackForPlayer(gs, pid);
    const position = computePlayerPosition(track, elapsedMs);
    io.to(pid).emit("game:play-at", { startAt, position });
  }
}

// Host clicks Play — only valid once every active player has confirmed ready,
// and only before the round has moved into voting.
function onHostPlay(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "loading") return { error: "Not ready to play." };
  const activeIds = getActivePlayerIds(room);
  if (!activeIds.every((id) => gs.readyToPlay.has(id))) return { error: "Not all players are ready yet." };

  const startAt = Date.now() + SYNC_BUFFER_MS;
  gs.phase = "playing";
  gs.playback = { segmentStartedAt: startAt, segmentStartPosition: 0, isPaused: false };
  broadcastPlayAt(room, io, startAt, 0);
  return {};
}

function onHostPause(room, io) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "playing" && gs.phase !== "voting") || gs.playback.isPaused) {
    return { error: "Nothing is playing right now." };
  }
  const pauseAt = Date.now() + SYNC_BUFFER_MS;
  const elapsedMs = gs.playback.segmentStartPosition + computeElapsedMs(gs.playback.segmentStartedAt, pauseAt);
  gs.playback.isPaused = true;
  gs.playback.pausedPosition = elapsedMs;

  const activeIds = getActivePlayerIds(room);
  for (const pid of activeIds) {
    io.to(pid).emit("game:pause-at", { pauseAt });
  }
  return {};
}

function onHostResume(room, io) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "playing" && gs.phase !== "voting") || !gs.playback.isPaused) {
    return { error: "Nothing is paused right now." };
  }
  const startAt = Date.now() + SYNC_BUFFER_MS;
  const resumeElapsedMs = gs.playback.pausedPosition;
  gs.playback = { segmentStartedAt: startAt, segmentStartPosition: resumeElapsedMs, isPaused: false };
  broadcastPlayAt(room, io, startAt, resumeElapsedMs);
  return {};
}

function onHostRestart(room, io) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "playing" && gs.phase !== "voting")) return { error: "Round isn't playing." };
  const startAt = Date.now() + SYNC_BUFFER_MS;
  gs.playback = { segmentStartedAt: startAt, segmentStartPosition: 0, isPaused: false };
  broadcastPlayAt(room, io, startAt, 0);
  return {};
}

// Called when a player submits their vote (or "skip") for this round.
function onVote(room, io, socketId, votedForId) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "playing" && gs.phase !== "voting")) return {};

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

// Host advances from round-results back to track-select for the next round.
function onNextRound(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "round-results") return { error: "No round result to advance from." };
  gs.phase = "track-select";
  io.to(room.hostId).emit("game:track-pairs", { pairs: getTrackPairs() });
  return {};
}

// Called from index.js's disconnect handler, AFTER roomService has already
// removed the player from room.players. Re-checks whether the round can now
// resolve with one fewer active player, and independently ends the game if
// attrition alone has dropped the active roster to 2 or fewer (matching the
// same threshold checkGameEnd uses after a normal elimination) — that check
// otherwise only runs inside resolveRoundAndAdvance, so a disconnect-driven
// drop to 2 players would never end the game on its own. Does not specially
// detect the imposter themselves disconnecting — matches the existing
// platform limitation of no reconnect/session-recovery support, not fixed
// here.
function onPlayerLeft(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase === "game-over") return {};

  gs.votes.delete(socketId);
  gs.readyToPlay.delete(socketId);
  const activeIds = getActivePlayerIds(room);
  if (activeIds.length === 0) return {};

  if (activeIds.length <= 2) {
    gs.phase = "game-over";
    gs.winner = "imposter";
    revealFinalResults(room, io, "imposter");
    return {};
  }

  if (gs.phase === "loading" && activeIds.every((id) => gs.readyToPlay.has(id))) {
    io.to(room.hostId).emit("game:all-ready");
  } else if (
    (gs.phase === "playing" || gs.phase === "voting") &&
    activeIds.every((id) => gs.votes.has(id))
  ) {
    resolveRoundAndAdvance(room, io);
  }
  return {};
}

// A reconnecting player lost their audio track assignment. Per the plan's
// stated limitation, this does not resynchronise playback position -- the
// player rejoins ready for the next game:play-at.
function onPlayerRejoined(room, io, playerId) {
  const gs = room.gameState;
  if (!gs) return;
  const track = getTrackForPlayer(gs, playerId);
  if (!track) return;
  io.to(playerId).emit("game:load-audio", { gameId: meta.id, ...track });
}

module.exports = {
  meta,
  getTrackPairs,
  getUploadedFiles,
  onSelectTrackPair,
  onSelectYoutubePair,
  onSelectUploadPair,
  onPlayerReady,
  onHostPlay,
  onHostPause,
  onHostResume,
  onHostRestart,
  onVote,
  onNextRound,
  onPlayerLeft,
  onPlayerRejoined,
};

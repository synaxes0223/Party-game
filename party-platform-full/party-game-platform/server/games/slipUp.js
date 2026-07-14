// slipUp.js
// Game module: each player is secretly assigned a word to avoid saying or an
// action to avoid doing. Every other player (but not the owner) can see it.
// The host referees continuously — no rounds, no voting, no elimination.
// Marking a player "caught" costs them a point and immediately deals them a
// fresh entry; the host ends the session manually whenever they choose.

const slipUpLogic = require("./slipUpLogic");

const meta = {
  id: "slip-up",
  name: "Slip-Up",
  description:
    "Everyone but you can see your secret word or action to avoid. Slip up and the host will catch you — fewest catches wins.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
};

function getEntryPool() {
  return slipUpLogic.BUILTIN_ENTRIES;
}

function getActivePlayerIds(room) {
  return Array.from(room.players.keys());
}

function broadcastYourView(room, io) {
  const gs = room.gameState;
  const players = Array.from(room.players.values());
  players.forEach((player) => {
    const others = players
      .filter((p) => p.id !== player.id)
      .map((p) => ({ id: p.id, nickname: p.nickname, entry: gs.assignments.get(p.id) }));
    io.to(player.id).emit("game:your-view", { others });
  });
}

function broadcastRefereeView(room, io) {
  const gs = room.gameState;
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    entry: gs.assignments.get(p.id),
  }));
  io.to(room.hostSocketId).emit("game:referee-view", { players });
}

function broadcastScore(room, io) {
  const gs = room.gameState;
  const scores = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    nickname: p.nickname,
    catchCount: gs.catchCounts.get(p.id) || 0,
  }));
  io.in(room.code).emit("game:score-update", { scores });
}

function onStartGame(room, io, { excludedIds, customEntries }) {
  if (room.gameState && room.gameState.phase === "active") {
    return { error: "Game already in progress." };
  }

  const playerIds = getActivePlayerIds(room);
  if (playerIds.length < meta.minPlayers) {
    return { error: `Need at least ${meta.minPlayers} players to start.` };
  }

  const poolResult = slipUpLogic.buildPool(excludedIds, customEntries);
  if (poolResult.error) return { error: poolResult.error };

  const dealResult = slipUpLogic.dealAssignments(poolResult.pool, playerIds);
  if (dealResult.error) return { error: dealResult.error };

  const catchCounts = new Map();
  playerIds.forEach((pid) => catchCounts.set(pid, 0));

  room.gameState = {
    phase: "active",
    pool: poolResult.pool,
    assignments: dealResult.assignments,
    catchCounts,
  };

  broadcastYourView(room, io);
  broadcastRefereeView(room, io);
  broadcastScore(room, io);
  return {};
}

function onMarkCaught(room, io, { targetPlayerId }) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "active") return { error: "Game is not active." };
  if (!room.players.has(targetPlayerId)) return { error: "Player not found." };

  gs.catchCounts.set(targetPlayerId, (gs.catchCounts.get(targetPlayerId) || 0) + 1);

  const currentlyHeld = Array.from(gs.assignments.entries())
    .filter(([pid]) => pid !== targetPlayerId)
    .map(([, entry]) => entry);

  const reassignResult = slipUpLogic.reassignOne(gs.pool, currentlyHeld);
  if (reassignResult.error) return { error: reassignResult.error };

  gs.assignments.set(targetPlayerId, reassignResult.entry);

  io.to(targetPlayerId).emit("game:you-were-caught", {});
  broadcastYourView(room, io);
  broadcastRefereeView(room, io);
  broadcastScore(room, io);
  return {};
}

function onEndGame(room, io) {
  const gs = room.gameState;
  if (!gs) return { error: "Game has not started." };
  gs.phase = "ended";

  const results = Array.from(room.players.values())
    .map((p) => ({ id: p.id, nickname: p.nickname, catchCount: gs.catchCounts.get(p.id) || 0 }))
    .sort((a, b) => a.catchCount - b.catchCount);

  io.in(room.code).emit("game:final-results", { results });
  return {};
}

function onPlayerLeft(room, io, socketId) {
  const gs = room.gameState;
  if (!gs) return;
  gs.assignments.delete(socketId);
  gs.catchCounts.delete(socketId);
  if (gs.phase === "active") {
    broadcastYourView(room, io);
    broadcastRefereeView(room, io);
    broadcastScore(room, io);
  }
}

module.exports = { meta, getEntryPool, onStartGame, onMarkCaught, onEndGame, onPlayerLeft };

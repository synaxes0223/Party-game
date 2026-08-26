// roomService.js
// Core platform service: room creation, joining, and player tracking.
// This is game-agnostic — any game module plugs into a room's `game` slot.

const wheelLogic = require("./games/wheelLogic");

const rooms = new Map(); // roomCode -> room object

function generateRoomCode() {
  // 4-letter code, avoids ambiguous chars (0/O, 1/I)
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function createRoom(hostId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostId,                 // the host's session token, stable across reconnects
    hostConnected: true,
    hostDisconnectedAt: null,
    state: "lobby", // lobby -> in-progress -> results
    players: new Map(), // playerToken -> { id, nickname, ready, connected, disconnectedAt }
    gameId: null,       // which game is selected, e.g. "find-the-imposter"
    gameState: null,    // opaque state owned by the game module
    punishmentWheel: { items: wheelLogic.makeDefaultItems() },
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get((code || "").toUpperCase());
}

function joinRoom(code, playerToken, nickname) {
  const room = getRoom(code);
  if (!room) return { error: "Room not found" };

  // A known token is a returning player: reclaim the seat whatever the room
  // state, because refusing here is what used to lose someone their game.
  const existing = room.players.get(playerToken);
  if (existing) {
    existing.connected = true;
    existing.disconnectedAt = null;
    return { room, rejoined: true };
  }

  if (room.state !== "lobby") return { error: "Game already in progress" };

  const trimmed = (nickname || "").trim().slice(0, 20);
  if (!trimmed) return { error: "Nickname required" };

  const nameTaken = Array.from(room.players.values()).some(
    (p) => p.nickname.toLowerCase() === trimmed.toLowerCase()
  );
  if (nameTaken) return { error: "Nickname already taken in this room" };

  room.players.set(playerToken, {
    id: playerToken,
    nickname: trimmed,
    ready: false,
    connected: true,
    disconnectedAt: null,
  });
  return { room, rejoined: false };
}

// In the lobby a departure is just a departure. Once a game is running the
// seat is load-bearing — game state is indexed by player id — so the player
// is kept and merely flagged, ready to be reclaimed by the same token.
function markPlayerDisconnected(playerToken) {
  for (const room of rooms.values()) {
    const player = room.players.get(playerToken);
    if (!player) continue;

    if (room.state === "lobby") {
      room.players.delete(playerToken);
      return { room, removed: true };
    }

    player.connected = false;
    player.disconnectedAt = Date.now();
    return { room, removed: false };
  }
  return null;
}

function removeRoomIfEmpty(code) {
  const room = getRoom(code);
  if (room && room.players.size === 0) {
    rooms.delete(code);
    return true;
  }
  return false;
}

function deleteRoom(code) {
  rooms.delete((code || "").toUpperCase());
}

function findRoomByHost(hostId) {
  for (const room of rooms.values()) {
    if (room.hostId === hostId) return room;
  }
  return null;
}

function publicRoomView(room) {
  return {
    code: room.code,
    state: room.state,
    gameId: room.gameId,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      nickname: p.nickname,
      ready: p.ready,
      connected: p.connected,
    })),
  };
}

module.exports = {
  createRoom,
  getRoom,
  joinRoom,
  markPlayerDisconnected,
  removeRoomIfEmpty,
  deleteRoom,
  findRoomByHost,
  publicRoomView,
};

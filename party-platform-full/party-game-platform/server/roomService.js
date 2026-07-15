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

function createRoom(hostSocketId) {
  const code = generateRoomCode();
  const room = {
    code,
    hostSocketId,
    state: "lobby", // lobby -> in-progress -> results
    players: new Map(), // socketId -> { id, nickname, ready }
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

function joinRoom(code, socketId, nickname) {
  const room = getRoom(code);
  if (!room) return { error: "Room not found" };
  if (room.state !== "lobby") return { error: "Game already in progress" };

  const trimmed = (nickname || "").trim().slice(0, 20);
  if (!trimmed) return { error: "Nickname required" };

  const nameTaken = Array.from(room.players.values()).some(
    (p) => p.nickname.toLowerCase() === trimmed.toLowerCase()
  );
  if (nameTaken) return { error: "Nickname already taken in this room" };

  room.players.set(socketId, { id: socketId, nickname: trimmed, ready: false });
  return { room };
}

function removePlayer(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) {
      room.players.delete(socketId);
      return room;
    }
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

function findRoomByHost(hostSocketId) {
  for (const room of rooms.values()) {
    if (room.hostSocketId === hostSocketId) return room;
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
    })),
  };
}

module.exports = {
  createRoom,
  getRoom,
  joinRoom,
  removePlayer,
  removeRoomIfEmpty,
  deleteRoom,
  findRoomByHost,
  publicRoomView,
};

// index.js
// Party Game Platform - server entry point.
// Serves host/player web pages and coordinates rooms via Socket.io.

const path = require("path");
const os = require("os");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const roomService = require("./roomService");
const gameRegistry = require("./games/registry");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "audio")));

app.get("/api/games", (req, res) => {
  res.json(gameRegistry.listGames());
});

function printLanUrl() {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) addrs.push(net.address);
    }
  }
  console.log(`\nServer running on port ${PORT}`);
  console.log(`Local:  http://localhost:${PORT}`);
  addrs.forEach((a) => console.log(`Network: http://${a}:${PORT}  <-- use this on phones (same WiFi)`));
  console.log("");
}

// Shared guard for every host-only, in-game action below: confirms the room
// exists, the caller is its host, and a game module is selected, then hands
// off to `handler`. Cuts six near-identical blocks down to one.
function withHostGame(socket, code, handler) {
  const room = roomService.getRoom(code);
  if (!room || room.hostSocketId !== socket.id) return;
  const game = gameRegistry.getGame(room.gameId);
  if (!game) return;
  const result = handler(room, game);
  if (result && result.error) socket.emit("host:error", { error: result.error });
}

io.on("connection", (socket) => {
  // ---- HOST: create room ----
  socket.on("host:create-room", () => {
    const room = roomService.createRoom(socket.id);
    socket.join(room.code);
    socket.emit("host:room-created", {
      room: roomService.publicRoomView(room),
      games: gameRegistry.listGames(),
    });
  });

  // ---- PLAYER: join room ----
  socket.on("player:join-room", ({ code, nickname }) => {
    const result = roomService.joinRoom(code, socket.id, nickname);
    if (result.error) {
      socket.emit("player:join-error", { error: result.error });
      return;
    }
    const room = result.room;
    socket.join(room.code);
    socket.emit("player:joined", { room: roomService.publicRoomView(room) });
    io.to(room.hostSocketId).emit("host:room-updated", {
      room: roomService.publicRoomView(room),
    });
    io.in(room.code).emit("room:player-list", {
      players: roomService.publicRoomView(room).players,
    });
  });

  // ---- HOST: select a game ----
  socket.on("host:select-game", ({ code, gameId }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;
    const game = gameRegistry.getGame(gameId);
    if (!game) return;

    room.gameId = gameId;
    io.in(room.code).emit("room:game-selected", {
      gameId,
      meta: game.meta,
    });
    if (game.getTrackPairs) {
      socket.emit("game:track-pairs", { pairs: game.getTrackPairs() });
    }
  });

  // ---- HOST: pick a track pair (this also starts the round) ----
  socket.on("host:select-track-pair", ({ code, pairId }) => {
    withHostGame(socket, code, (room, game) => game.onSelectTrackPair(room, io, pairId));
  });

  // ---- HOST: playback control ----
  socket.on("host:play-audio", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onHostPlay(room, io));
  });

  socket.on("host:pause-audio", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onHostPause(room, io));
  });

  socket.on("host:resume-audio", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onHostResume(room, io));
  });

  socket.on("host:restart-audio", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onHostRestart(room, io));
  });

  // ---- HOST: advance to the next round ----
  socket.on("host:next-round", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onNextRound(room, io));
  });

  // ---- PLAYER: confirms audio preloaded ----
  socket.on("player:audio-ready", ({ code }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameId) return;
    const game = gameRegistry.getGame(room.gameId);
    if (game.onPlayerReady) game.onPlayerReady(room, io, socket.id);
  });

  // ---- PLAYER: casts vote ----
  socket.on("player:vote", ({ code, votedForId }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameId) return;
    const game = gameRegistry.getGame(room.gameId);
    if (game.onVote) game.onVote(room, io, socket.id, votedForId);
  });

  // ---- HOST: return to lobby / play again ----
  socket.on("host:reset-room", ({ code }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;
    room.state = "lobby";
    room.gameId = null;
    room.gameState = null;
    for (const p of room.players.values()) p.ready = false;
    io.in(room.code).emit("room:reset", {
      room: roomService.publicRoomView(room),
    });
  });

  // ---- Disconnect handling ----
  socket.on("disconnect", () => {
    const room = roomService.removePlayer(socket.id);
    if (room) {
      if (room.gameId && room.gameState) {
        const game = gameRegistry.getGame(room.gameId);
        if (game.onPlayerLeft) game.onPlayerLeft(room, io, socket.id);
      }
      io.to(room.hostSocketId).emit("host:room-updated", {
        room: roomService.publicRoomView(room),
      });
      io.in(room.code).emit("room:player-list", {
        players: roomService.publicRoomView(room).players,
      });
      roomService.removeRoomIfEmpty(room.code);
    }

    const hostedRoom = roomService.findRoomByHost(socket.id);
    if (hostedRoom) {
      io.in(hostedRoom.code).emit("room:host-disconnected");
    }
  });
});

server.listen(PORT, "0.0.0.0", printLanUrl);

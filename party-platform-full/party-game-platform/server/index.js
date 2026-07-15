// index.js
// Party Game Platform - server entry point.
// Serves host/player web pages and coordinates rooms via Socket.io.

const path = require("path");
const os = require("os");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");

const roomService = require("./roomService");
const gameRegistry = require("./games/registry");
const uploadStore = require("./games/uploadStore");
const wheelLogic = require("./games/wheelLogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, "public")));
app.use("/audio", express.static(path.join(__dirname, "audio")));
app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/api/games", (req, res) => {
  res.json(gameRegistry.listGames());
});

const uploadStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp3|mp4)$/i.test(file.originalname);
    cb(ok ? null : new Error("Only .mp3 and .mp4 files are allowed."), ok);
  },
});

app.post("/api/upload-audio", (req, res) => {
  upload.single("audio")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    const file = uploadStore.addFile({
      originalName: req.file.originalname,
      storedFilename: req.file.filename,
    });
    res.json({ id: file.id, originalName: file.originalName, url: file.url });
  });
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
// off to `handler`.
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
    socket.emit("wheel:list-updated", { items: room.punishmentWheel.items });
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
    socket.emit("wheel:list-updated", { items: room.punishmentWheel.items });
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
    if (game.getEntryPool) {
      socket.emit("game:entry-pool", { entries: game.getEntryPool() });
    }
  });

  // ---- HOST: pick a track pair (also starts the round) ----
  socket.on("host:select-track-pair", ({ code, pairId }) => {
    withHostGame(socket, code, (room, game) => game.onSelectTrackPair(room, io, pairId));
  });

  // ---- HOST: pick a YouTube URL pair (also starts the round) ----
  socket.on("host:select-youtube-pair", ({ code, normal, imposter }) => {
    withHostGame(socket, code, (room, game) => game.onSelectYoutubePair(room, io, { normal, imposter }));
  });

  // ---- HOST: pick an uploaded-file pair (also starts the round) ----
  socket.on("host:select-upload-pair", ({ code, normalFileId, imposterFileId }) => {
    withHostGame(socket, code, (room, game) => game.onSelectUploadPair(room, io, { normalFileId, imposterFileId }));
  });

  // ---- HOST: list the uploaded-file pool ----
  socket.on("host:list-uploaded-files", ({ code }) => {
    withHostGame(socket, code, (room, game) => {
      socket.emit("game:uploaded-files", { files: game.getUploadedFiles ? game.getUploadedFiles() : [] });
      return {};
    });
  });

  // ---- HOST: Word Wolf word selection ----
  socket.on("host:select-auto-pair", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onSelectAutoPair(room, io));
  });

  socket.on("host:select-custom-pair", ({ code, normalWord, imposterWord }) => {
    withHostGame(socket, code, (room, game) => game.onSelectCustomPair(room, io, { normalWord, imposterWord }));
  });

  socket.on("host:reveal-words", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onHostReveal(room, io));
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

  // ---- HOST: start a Slip-Up session ----
  socket.on("host:start-game", ({ code, excludedIds, customEntries }) => {
    withHostGame(socket, code, (room, game) => game.onStartGame(room, io, { excludedIds, customEntries }));
  });

  // ---- HOST: mark a player as caught (Slip-Up) ----
  socket.on("host:mark-caught", ({ code, targetPlayerId }) => {
    withHostGame(socket, code, (room, game) => game.onMarkCaught(room, io, { targetPlayerId }));
  });

  // ---- HOST: end a Slip-Up session ----
  socket.on("host:end-game", ({ code }) => {
    withHostGame(socket, code, (room, game) => game.onEndGame(room, io));
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

  // ---- WHEEL: add a punishment (host or any player; room-level, works
  // regardless of which game, if any, is currently selected) ----
  // Note: wheel:list-updated is intentionally broadcast to the whole room,
  // not host-only. Players' UI has no list view (host.js/player.js keep the
  // spin a soft surprise), but the underlying data reaching player sockets
  // is accepted as low-stakes for a same-WiFi party game — don't "fix" this
  // into a host-only emit without revisiting that call.
  socket.on("wheel:add-punishment", ({ code, text }) => {
    const room = roomService.getRoom(code);
    if (!room) return;

    let addedBy = "player";
    let nickname;
    if (socket.id === room.hostSocketId) {
      addedBy = "host";
    } else {
      const player = room.players.get(socket.id);
      if (player) nickname = player.nickname;
    }

    const result = wheelLogic.addItem(room.punishmentWheel.items, { text, addedBy, nickname });
    if (result.error) {
      socket.emit("wheel:add-error", { error: result.error });
      return;
    }
    room.punishmentWheel.items = result.items;
    io.in(room.code).emit("wheel:list-updated", { items: room.punishmentWheel.items });
  });

  // ---- WHEEL: remove a punishment (host only) ----
  socket.on("wheel:remove-punishment", ({ code, id }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;

    const result = wheelLogic.removeItem(room.punishmentWheel.items, id);
    room.punishmentWheel.items = result.items;
    io.in(room.code).emit("wheel:list-updated", { items: room.punishmentWheel.items });
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
      roomService.deleteRoom(hostedRoom.code);
    }
  });
});

server.listen(PORT, "0.0.0.0", printLanUrl);

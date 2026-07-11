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
const promptLogic = require("./games/promptLogic");
const aiPromptService = require("./games/aiPromptService");

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
    if (game.meta.usesPromptPipeline) {
      if (game.initGameState) game.initGameState(room);
      socket.emit("game:prompt-sources", { aiAvailable: aiPromptService.isAvailable() });
    }
  });

  // ---- HOST: prompt pipeline -- spice level, drawing, custom prompts ----
  socket.on("host:set-spice", ({ code, spice }) => {
    withHostGame(socket, code, (room, game) => (game.onSetSpice ? game.onSetSpice(room, io, Number(spice)) : {}));
  });

  socket.on("host:draw-prompt", ({ code }) => {
    withHostGame(socket, code, (room, game) => (game.onDrawPrompt ? game.onDrawPrompt(room, io) : {}));
  });

  socket.on("host:custom-prompt", ({ code, text }) => {
    withHostGame(socket, code, (room, game) => (game.onCustomPrompt ? game.onCustomPrompt(room, io, text) : {}));
  });

  // ---- PLAYER: secretly submit a prompt for future rounds ----
  socket.on("player:submit-prompt", ({ code, text }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameId) return;
    const game = gameRegistry.getGame(room.gameId);
    if (!game || !game.meta.usesPromptPipeline || !game.onPromptSubmitted) return;
    const result = game.onPromptSubmitted(room, io, socket.id, text);
    if (result && result.error) socket.emit("player:prompt-rejected", { error: result.error });
    else socket.emit("player:prompt-accepted", {});
  });

  // ---- HOST: AI prompt generation (topic -> batch -> host approves) ----
  socket.on("host:generate-prompts", async ({ code, topic, spice, count }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;
    const game = gameRegistry.getGame(room.gameId);
    if (!game || !game.meta.usesPromptPipeline) return;

    const result = await aiPromptService.generatePrompts({
      gameId: game.meta.id,
      topic,
      spice: Number(spice),
      count: Number(count),
    });
    if (result.error) socket.emit("host:error", { error: result.error });
    else socket.emit("game:generated-prompts", { prompts: result.prompts });
  });

  socket.on("host:approve-prompts", ({ code, prompts }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostSocketId !== socket.id) return;
    const game = gameRegistry.getGame(room.gameId);
    if (!game || !game.meta.usesPromptPipeline || !room.gameState) return;

    const ps = room.gameState.promptState;
    (prompts || []).forEach((p) => {
      const validated = promptLogic.validateSubmission(p.text);
      if (validated.error) return;
      const insertAt = Math.floor(Math.random() * (ps.queue.length + 1));
      ps.queue.splice(insertAt, 0, { text: validated.text, spice: p.spice, source: "ai" });
    });
    socket.emit("game:submission-count", { count: ps.queue.length });
  });

  // ---- Who Wrote That?: answering, guessing, round/game flow ----
  socket.on("player:submit-answer", ({ code, text }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameId) return;
    const game = gameRegistry.getGame(room.gameId);
    if (!game || !game.onSubmitAnswer) return;
    const result = game.onSubmitAnswer(room, io, socket.id, text);
    if (result && result.error) socket.emit("player:answer-rejected", { error: result.error });
  });

  socket.on("host:force-answers", ({ code }) => {
    withHostGame(socket, code, (room, game) => (game.onForceAnswers ? game.onForceAnswers(room, io) : {}));
  });

  socket.on("player:vote-author", ({ code, votedForId }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameId) return;
    const game = gameRegistry.getGame(room.gameId);
    if (game && game.onVoteAuthor) game.onVoteAuthor(room, io, socket.id, votedForId);
  });

  socket.on("host:next-answer", ({ code }) => {
    withHostGame(socket, code, (room, game) => (game.onNextAnswer ? game.onNextAnswer(room, io) : {}));
  });

  // ---- X People In This Room: private yes/no + prediction responses ----
  socket.on("player:submit-response", ({ code, answer, prediction }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameId) return;
    const game = gameRegistry.getGame(room.gameId);
    if (game && game.onSubmitResponse) game.onSubmitResponse(room, io, socket.id, answer, prediction);
  });

  socket.on("host:end-game", ({ code }) => {
    withHostGame(socket, code, (room, game) => (game.onEndGame ? game.onEndGame(room, io) : {}));
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
      roomService.deleteRoom(hostedRoom.code);
    }
  });
});

server.listen(PORT, "0.0.0.0", printLanUrl);

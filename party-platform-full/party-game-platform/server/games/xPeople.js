// xPeople.js
// Game module: anonymous yes/no icebreaker. Every round, a yes/no statement
// goes to all players; each answers privately and predicts how many players
// total will say yes; only the aggregate count is ever revealed -- no
// per-player answer leaves the server. Points reward accurate predictions.
// Built on the shared prompt pipeline, same as whoWroteThat.js.

const promptLogic = require("./promptLogic");
const promptPacks = require("./promptPacks");

const meta = {
  id: "x-people",
  name: "X People In This Room",
  description:
    "Answer spicy yes/no questions anonymously — the screen shows only HOW MANY said yes, never who. Predict the count to score points. Then interrogate each other.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
  usesPromptPipeline: true,
};

const POOL = promptPacks[meta.id];

function activePlayerIds(room) {
  return Array.from(room.players.keys());
}

function initGameState(room) {
  room.gameState = {
    phase: "prompt-select", // prompt-select -> answering -> reveal (loop) -> game-over
    round: 0,
    scores: new Map(), // playerId -> {nickname, score}
    promptState: { maxSpice: 2, usedIndexes: new Set(), queue: [] },
    currentPrompt: null,
    responses: new Map(), // playerId -> {answer: boolean, prediction: number}
  };
}

function ensureScoreEntry(gs, room, playerId) {
  if (!gs.scores.has(playerId)) {
    const player = room.players.get(playerId);
    gs.scores.set(playerId, { nickname: player ? player.nickname : "Unknown", score: 0 });
  }
  return gs.scores.get(playerId);
}

function scoreboard(gs) {
  return Array.from(gs.scores.entries())
    .map(([id, s]) => ({ id, nickname: s.nickname, score: s.score }))
    .sort((a, b) => b.score - a.score);
}

function onSetSpice(room, io, spice) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "prompt-select") return { error: "Can't change spice mid-round." };
  const safeSpice = [1, 2, 3].includes(spice) ? spice : gs.promptState.maxSpice;
  gs.promptState.maxSpice = safeSpice;
  return {};
}

function startRoundWithPrompt(room, io, prompt) {
  const gs = room.gameState;
  gs.round += 1;
  gs.currentPrompt = prompt;
  gs.responses = new Map();
  gs.phase = "answering";
  room.state = "in-progress";

  const playerCount = activePlayerIds(room).length;
  io.in(room.code).emit("game:prompt", { round: gs.round, text: prompt.text, playerCount });
  io.to(room.hostId).emit("game:answer-progress", { answered: 0, total: playerCount });
  return {};
}

function onDrawPrompt(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "prompt-select") return { error: "Can't draw a prompt right now." };

  const draw = promptLogic.drawNext(gs.promptState.queue, POOL, gs.promptState.usedIndexes, gs.promptState.maxSpice);
  if (draw.error) return { error: draw.error };

  gs.promptState.queue = draw.nextQueue;
  gs.promptState.usedIndexes = draw.usedIndexes;
  return startRoundWithPrompt(room, io, draw.prompt);
}

function onCustomPrompt(room, io, text) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "prompt-select") return { error: "Can't set a prompt right now." };
  const validated = promptLogic.validateSubmission(text);
  if (validated.error) return { error: validated.error };
  return startRoundWithPrompt(room, io, { text: validated.text, spice: gs.promptState.maxSpice, source: "custom" });
}

function onPromptSubmitted(room, io, socketId, text) {
  const gs = room.gameState;
  if (!gs || gs.phase === "game-over") return { error: "Game isn't accepting prompts right now." };

  const validated = promptLogic.validateSubmission(text);
  if (validated.error) return { error: validated.error };

  const pendingFromAuthor = gs.promptState.queue.filter((p) => p.authorId === socketId).length;
  if (pendingFromAuthor >= 5) return { error: "You already have 5 prompts waiting to be used." };

  const entry = { text: validated.text, spice: gs.promptState.maxSpice, source: "player", authorId: socketId };
  const insertAt = Math.floor(Math.random() * (gs.promptState.queue.length + 1));
  gs.promptState.queue.splice(insertAt, 0, entry);

  io.to(room.hostId).emit("game:submission-count", { count: gs.promptState.queue.length });
  return {};
}

function onSubmitResponse(room, io, socketId, answer, prediction) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "answering") return {};

  const activeIds = activePlayerIds(room);
  if (!activeIds.includes(socketId)) return {};

  const total = activeIds.length;
  const safePrediction = Math.max(0, Math.min(total, Number(prediction) || 0));
  gs.responses.set(socketId, { answer: Boolean(answer), prediction: safePrediction });

  io.to(room.hostId).emit("game:answer-progress", { answered: gs.responses.size, total });

  if (gs.responses.size >= total) resolveReveal(room, io);
  return {};
}

function onForceAnswers(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "answering") return { error: "Not currently collecting responses." };
  if (gs.responses.size < 2) return { error: "Need at least 2 responses to proceed." };
  resolveReveal(room, io);
  return {};
}

function resolveReveal(room, io) {
  const gs = room.gameState;
  const responders = Array.from(gs.responses.entries());
  const yesCount = responders.filter(([, r]) => r.answer).length;

  const results = responders.map(([playerId, r]) => {
    const diff = Math.abs(r.prediction - yesCount);
    let points = 0;
    if (diff === 0) points = 100;
    else if (diff === 1) points = 50;

    const entry = ensureScoreEntry(gs, room, playerId);
    entry.score += points;

    return { id: playerId, nickname: entry.nickname, prediction: r.prediction, points };
  });

  gs.phase = "reveal";
  io.in(room.code).emit("game:count-reveal", {
    round: gs.round,
    text: gs.currentPrompt.text,
    yesCount,
    playerCount: responders.length,
    results,
    scores: scoreboard(gs),
  });
}

function onNextRound(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "reveal") return { error: "No reveal to advance from." };
  gs.phase = "prompt-select";
  io.to(room.hostId).emit("game:prompt-select-ready", {});
  return {};
}

function onEndGame(room, io) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "reveal" && gs.phase !== "prompt-select")) {
    return { error: "Can't end the game right now." };
  }
  gs.phase = "game-over";
  room.state = "results";
  const scores = scoreboard(gs);
  const topScore = scores.length ? scores[0].score : 0;
  const winners = scores.filter((s) => s.score === topScore);
  io.in(room.code).emit("game:results", { winners, scores });
  return {};
}

function onPlayerLeft(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase === "game-over") return {};

  if (gs.phase === "answering") {
    gs.responses.delete(socketId);
    const total = activePlayerIds(room).length;
    if (total === 0) return {};
    if (gs.responses.size >= total) resolveReveal(room, io);
    return {};
  }

  if (activePlayerIds(room).length <= 1 && gs.phase !== "prompt-select" && gs.phase !== "reveal") {
    return onEndGame(room, io);
  }
  return {};
}

module.exports = {
  meta,
  initGameState,
  onSetSpice,
  onDrawPrompt,
  onCustomPrompt,
  onPromptSubmitted,
  onSubmitResponse,
  onForceAnswers,
  onNextRound,
  onEndGame,
  onPlayerLeft,
};

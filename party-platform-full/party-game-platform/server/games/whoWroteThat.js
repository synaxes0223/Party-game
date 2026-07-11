// whoWroteThat.js
// Game module: anonymous-answer guessing game. Every round, a prompt goes to
// all players; everyone answers anonymously; the shuffled answers are
// revealed one at a time and the room votes on who wrote each one. No
// elimination -- a running points game. Built on the shared prompt pipeline
// (promptLogic.js / promptPacks.js) for prompt sourcing (packs, player
// submissions, AI-approved prompts all share one FIFO-before-pack queue).

const promptLogic = require("./promptLogic");
const promptPacks = require("./promptPacks");

const meta = {
  id: "who-wrote-that",
  name: "Who Wrote That?",
  description:
    "Everyone answers a prompt anonymously. Answers appear on the big screen one by one — guess who wrote each. Fool your friends for bonus points.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
  usesPromptPipeline: true,
};

const MAX_PENDING_SUBMISSIONS_PER_PLAYER = 5;
const MAX_ANSWER_LENGTH = 140;
const POOL = promptPacks[meta.id];

function activePlayerIds(room) {
  return Array.from(room.players.keys());
}

// Called by index.js when the host selects this game -- sets up the room's
// game-agnostic-shaped prompt pipeline state immediately (not lazily on
// first round), because prompt submission/generation must work from the
// moment the game is selected, even before the host has drawn round 1.
function initGameState(room) {
  room.gameState = {
    phase: "prompt-select",
    round: 0,
    scores: new Map(), // playerId -> {nickname, score}
    promptState: { maxSpice: 2, usedIndexes: new Set(), queue: [] },
    currentPrompt: null,
    answers: [], // [{playerId, nickname, text}] -- nickname captured at submission time so it survives a later disconnect
    answerIndex: -1,
    votes: new Map(),
    pendingAnswers: new Map(), // playerId -> text, cleared once shuffled into `answers`
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

function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Host sets the max spice level for prompts drawn from here on. Only valid
// while choosing the next prompt.
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
  gs.answers = [];
  gs.pendingAnswers = new Map();
  gs.answerIndex = -1;
  gs.votes = new Map();
  gs.phase = "answering";
  room.state = "in-progress";

  io.in(room.code).emit("game:prompt", { round: gs.round, text: prompt.text });
  io.to(room.hostSocketId).emit("game:answer-progress", { answered: 0, total: activePlayerIds(room).length });
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

// Player secretly submits a prompt for future rounds -- works any time this
// game is selected (lobby included), not gated to the prompt-select phase.
function onPromptSubmitted(room, io, socketId, text) {
  const gs = room.gameState;
  if (!gs || gs.phase === "game-over") return { error: "Game isn't accepting prompts right now." };

  const validated = promptLogic.validateSubmission(text);
  if (validated.error) return { error: validated.error };

  const pendingFromAuthor = gs.promptState.queue.filter((p) => p.authorId === socketId).length;
  if (pendingFromAuthor >= MAX_PENDING_SUBMISSIONS_PER_PLAYER) {
    return { error: "You already have 5 prompts waiting to be used." };
  }

  const entry = { text: validated.text, spice: gs.promptState.maxSpice, source: "player", authorId: socketId };
  const insertAt = Math.floor(Math.random() * (gs.promptState.queue.length + 1));
  gs.promptState.queue.splice(insertAt, 0, entry);

  io.to(room.hostSocketId).emit("game:submission-count", { count: gs.promptState.queue.length });
  return {};
}

function onSubmitAnswer(room, io, socketId, text) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "answering") return {};
  const trimmed = (text || "").trim();
  if (!trimmed || trimmed.length > MAX_ANSWER_LENGTH) return { error: "Answer must be 1-140 characters." };

  gs.pendingAnswers.set(socketId, trimmed);
  const total = activePlayerIds(room).length;
  io.to(room.hostSocketId).emit("game:answer-progress", { answered: gs.pendingAnswers.size, total });

  if (gs.pendingAnswers.size >= total) advanceToGuessing(room, io);
  return {};
}

function onForceAnswers(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "answering") return { error: "Not currently collecting answers." };
  if (gs.pendingAnswers.size < 2) return { error: "Need at least 2 answers to proceed." };
  advanceToGuessing(room, io);
  return {};
}

function advanceToGuessing(room, io) {
  const gs = room.gameState;
  gs.answers = shuffle(
    Array.from(gs.pendingAnswers.entries()).map(([playerId, text]) => {
      const player = room.players.get(playerId);
      return { playerId, nickname: player ? player.nickname : "Unknown", text };
    })
  );
  gs.answerIndex = 0;
  gs.phase = "guessing";
  gs.votes = new Map();
  emitCurrentAnswer(room, io);
}

function emitCurrentAnswer(room, io) {
  const gs = room.gameState;
  const current = gs.answers[gs.answerIndex];
  io.in(room.code).emit("game:show-answer", {
    answerNumber: gs.answerIndex + 1,
    totalAnswers: gs.answers.length,
    text: current.text,
  });
}

function onVoteAuthor(room, io, socketId, votedForId) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "guessing") return {};

  const voterIds = activePlayerIds(room);
  if (!voterIds.includes(socketId)) return {};
  const candidateIds = gs.answers.map((a) => a.playerId);
  if (votedForId === socketId || !candidateIds.includes(votedForId)) {
    io.to(socketId).emit("player:vote-rejected", { reason: "Pick one of the answer authors — not yourself." });
    return {};
  }

  gs.votes.set(socketId, votedForId);
  io.to(room.hostSocketId).emit("game:vote-progress", { voted: gs.votes.size, total: voterIds.length });

  if (gs.votes.size >= voterIds.length) resolveAnswerReveal(room, io);
  return {};
}

function resolveAnswerReveal(room, io) {
  const gs = room.gameState;
  const current = gs.answers[gs.answerIndex];
  const authorId = current.playerId;

  const correctGuessers = [];
  let fooledCount = 0;
  for (const [voterId, votedForId] of gs.votes.entries()) {
    if (voterId === authorId) continue; // camouflage vote, excluded from both counts
    if (votedForId === authorId) {
      const entry = ensureScoreEntry(gs, room, voterId);
      entry.score += 100;
      correctGuessers.push({ id: voterId, nickname: entry.nickname });
    } else {
      fooledCount += 1;
    }
  }

  const authorBonus = fooledCount * 50;
  const authorEntry = ensureScoreEntry(gs, room, authorId);
  authorEntry.nickname = current.nickname; // keep the snapshot in sync in case of later disconnect
  authorEntry.score += authorBonus;

  gs.phase = "answer-reveal";
  io.in(room.code).emit("game:answer-reveal", {
    authorId,
    authorNickname: current.nickname,
    text: current.text,
    correctGuessers,
    fooledCount,
    authorBonus,
    voided: false,
  });
}

function onNextAnswer(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "answer-reveal") return { error: "No answer reveal to advance from." };

  if (gs.answerIndex + 1 < gs.answers.length) {
    gs.answerIndex += 1;
    gs.votes = new Map();
    gs.phase = "guessing";
    emitCurrentAnswer(room, io);
    return {};
  }

  gs.phase = "round-results";
  io.in(room.code).emit("game:round-results", { round: gs.round, scores: scoreboard(gs) });
  return {};
}

function onNextRound(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "round-results") return { error: "No round result to advance from." };
  gs.phase = "prompt-select";
  io.to(room.hostSocketId).emit("game:prompt-select-ready", {});
  return {};
}

function onEndGame(room, io) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "round-results" && gs.phase !== "prompt-select")) {
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
    gs.pendingAnswers.delete(socketId);
    const total = activePlayerIds(room).length;
    if (total === 0) return {};
    if (gs.pendingAnswers.size >= total) advanceToGuessing(room, io);
    return {};
  }

  if (gs.phase === "guessing") {
    gs.votes.delete(socketId);
    const current = gs.answers[gs.answerIndex];
    if (current && current.playerId === socketId) {
      gs.phase = "answer-reveal";
      io.in(room.code).emit("game:answer-reveal", {
        authorId: socketId,
        authorNickname: current.nickname,
        text: current.text,
        correctGuessers: [],
        fooledCount: 0,
        authorBonus: 0,
        voided: true,
      });
      return {};
    }
    const voterIds = activePlayerIds(room);
    if (voterIds.length > 0 && gs.votes.size >= voterIds.length) resolveAnswerReveal(room, io);
    return {};
  }

  if (activePlayerIds(room).length <= 1 && gs.phase !== "prompt-select" && gs.phase !== "round-results") {
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
  onSubmitAnswer,
  onForceAnswers,
  onVoteAuthor,
  onNextAnswer,
  onNextRound,
  onEndGame,
  onPlayerLeft,
};

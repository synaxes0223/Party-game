// passTheBomb.js
// Game module: a hot-potato bomb with a HIDDEN fuse circulates a shuffled
// player ring. The holder must say something from the category out loud (an
// honor-system rule enforced by the room, not the server) then tap PASS.
// Whoever holds the bomb when the fuse expires takes a boom. Fewest booms
// wins. This is the platform's first game with a server-side timer -- the
// fuse duration is deliberately never sent to any client (the whole point is
// not knowing). Categories are sourced from the shared prompt pipeline.

const promptLogic = require("./promptLogic");
const promptPacks = require("./promptPacks");

const meta = {
  id: "pass-the-bomb",
  name: "Pass The Bomb",
  description:
    "A bomb with a hidden fuse circles the group. Say something from the category out loud, tap PASS fast. Holding it when it blows = boom. Fewest booms wins.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
  usesPromptPipeline: true,
};

const POOL = promptPacks[meta.id];
const DEFAULT_FUSE_RANGE_MS = [20000, 50000];

// Test-only escape hatch: BOMB_FUSE_MS_RANGE="min,max" lets the E2E suite use
// a short fuse instead of sleeping 20-50s per round. Never referenced by
// game logic other than this one function.
function getFuseRangeMs() {
  const override = process.env.BOMB_FUSE_MS_RANGE;
  if (!override) return DEFAULT_FUSE_RANGE_MS;
  const [min, max] = override.split(",").map(Number);
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min) return [min, max];
  return DEFAULT_FUSE_RANGE_MS;
}

function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function activeRingIds(room) {
  const gs = room.gameState;
  return gs.ring.filter((id) => room.players.has(id));
}

function nextActiveIndex(ring, room, fromIndex) {
  for (let step = 1; step <= ring.length; step++) {
    const idx = (fromIndex + step) % ring.length;
    if (room.players.has(ring[idx])) return idx;
  }
  return fromIndex;
}

function initGameState(room) {
  room.gameState = {
    phase: "category-select", // category-select -> ticking -> boom (loop) -> game-over
    round: 0,
    ring: [],
    holderIndex: null,
    booms: new Map(), // playerId -> {nickname, count}
    promptState: { maxSpice: 1, usedIndexes: new Set(), queue: [] },
    currentCategory: null,
    fuseTimeout: null,
    fuseExpiresAt: null, // server-side only, never sent to clients
  };
}

function onSetSpice(room, io, spice) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "category-select") return { error: "Can't change spice mid-round." };
  const safeSpice = [1, 2, 3].includes(spice) ? spice : gs.promptState.maxSpice;
  gs.promptState.maxSpice = safeSpice;
  return {};
}

function ringInfo(room) {
  const gs = room.gameState;
  return gs.ring
    .filter((id) => room.players.has(id))
    .map((id) => ({ id, nickname: room.players.get(id).nickname }));
}

function startBombRound(room, io, category) {
  const gs = room.gameState;

  if (gs.ring.length === 0) {
    gs.ring = shuffle(Array.from(room.players.keys()));
    gs.booms = new Map(gs.ring.map((id) => [id, { nickname: room.players.get(id).nickname, count: 0 }]));
  }

  gs.round += 1;
  gs.currentCategory = category;
  const activeIds = activeRingIds(room);
  const holderId = activeIds[Math.floor(Math.random() * activeIds.length)];
  gs.holderIndex = gs.ring.indexOf(holderId);

  const [min, max] = getFuseRangeMs();
  const fuseMs = min + Math.floor(Math.random() * (max - min + 1));
  gs.fuseExpiresAt = Date.now() + fuseMs;
  if (gs.fuseTimeout) clearTimeout(gs.fuseTimeout);
  gs.fuseTimeout = setTimeout(() => explode(room, io), fuseMs);

  gs.phase = "ticking";
  room.state = "in-progress";

  io.in(room.code).emit("game:bomb-started", {
    round: gs.round,
    category: category.text,
    ring: ringInfo(room),
    holderId,
  });
  return {};
}

function onDrawPrompt(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "category-select") return { error: "Can't draw a category right now." };

  const draw = promptLogic.drawNext(gs.promptState.queue, POOL, gs.promptState.usedIndexes, gs.promptState.maxSpice);
  if (draw.error) return { error: draw.error };

  gs.promptState.queue = draw.nextQueue;
  gs.promptState.usedIndexes = draw.usedIndexes;
  return startBombRound(room, io, draw.prompt);
}

function onCustomPrompt(room, io, text) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "category-select") return { error: "Can't set a category right now." };
  const validated = promptLogic.validateSubmission(text);
  if (validated.error) return { error: validated.error };
  return startBombRound(room, io, { text: validated.text, spice: gs.promptState.maxSpice, source: "custom" });
}

function onPromptSubmitted(room, io, socketId, text) {
  const gs = room.gameState;
  if (!gs || gs.phase === "game-over") return { error: "Game isn't accepting categories right now." };

  const validated = promptLogic.validateSubmission(text);
  if (validated.error) return { error: validated.error };

  const pendingFromAuthor = gs.promptState.queue.filter((p) => p.authorId === socketId).length;
  if (pendingFromAuthor >= 5) return { error: "You already have 5 categories waiting to be used." };

  const entry = { text: validated.text, spice: gs.promptState.maxSpice, source: "player", authorId: socketId };
  const insertAt = Math.floor(Math.random() * (gs.promptState.queue.length + 1));
  gs.promptState.queue.splice(insertAt, 0, entry);

  io.to(room.hostSocketId).emit("game:submission-count", { count: gs.promptState.queue.length });
  return {};
}

function onPassBomb(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "ticking") return {};
  const currentHolderId = gs.ring[gs.holderIndex];
  if (socketId !== currentHolderId) return {};

  gs.holderIndex = nextActiveIndex(gs.ring, room, gs.holderIndex);
  io.in(room.code).emit("game:bomb-passed", { holderId: gs.ring[gs.holderIndex] });
  return {};
}

function explode(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "ticking") return; // room may have reset/ended already
  gs.fuseTimeout = null;

  const holderId = gs.ring[gs.holderIndex];
  const boom = gs.booms.get(holderId) || { nickname: "Unknown", count: 0 };
  boom.count += 1;
  gs.booms.set(holderId, boom);
  gs.phase = "boom";

  io.in(room.code).emit("game:bomb-exploded", {
    holderId,
    holderNickname: boom.nickname,
    booms: boomsArray(gs),
  });
}

function boomsArray(gs) {
  return Array.from(gs.booms.entries()).map(([id, b]) => ({ id, nickname: b.nickname, count: b.count }));
}

function onNextRound(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "boom") return { error: "No boom result to advance from." };
  gs.phase = "category-select";
  io.to(room.hostSocketId).emit("game:prompt-select-ready", {});
  return {};
}

function finishGame(room, io) {
  const gs = room.gameState;
  if (gs.fuseTimeout) {
    clearTimeout(gs.fuseTimeout);
    gs.fuseTimeout = null;
  }
  gs.phase = "game-over";
  room.state = "results";
  const booms = boomsArray(gs);
  const minCount = booms.length ? Math.min(...booms.map((b) => b.count)) : 0;
  const winners = booms.filter((b) => b.count === minCount);
  io.in(room.code).emit("game:results", { winners, booms });
}

function onEndGame(room, io) {
  const gs = room.gameState;
  if (!gs || (gs.phase !== "boom" && gs.phase !== "category-select")) {
    return { error: "Can't end the game right now." };
  }
  finishGame(room, io);
  return {};
}

// Called generically from index.js's host:reset-room handler, before
// gameState is nulled -- clears any pending fuse timer so a stray
// setTimeout callback never fires against a room whose gameState is gone.
function onReset(room) {
  const gs = room.gameState;
  if (gs && gs.fuseTimeout) clearTimeout(gs.fuseTimeout);
}

function onPlayerLeft(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase === "game-over" || gs.ring.length === 0) return {};

  if (gs.phase === "ticking" && gs.ring[gs.holderIndex] === socketId) {
    gs.holderIndex = nextActiveIndex(gs.ring, room, gs.holderIndex);
    io.in(room.code).emit("game:bomb-passed", { holderId: gs.ring[gs.holderIndex] });
  }

  if (activeRingIds(room).length < 2) {
    finishGame(room, io);
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
  onPassBomb,
  onNextRound,
  onEndGame,
  onReset,
  onPlayerLeft,
  getFuseRangeMs,
};

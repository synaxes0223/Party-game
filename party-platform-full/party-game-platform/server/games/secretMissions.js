// secretMissions.js
// Game module: a slow-burn background game that runs across a whole party.
// Every player secretly gets 3 real-life missions; the host screen shows
// the full anonymous mission board (text only, never whose); players claim
// completed missions and can accuse each other to bust missions and steal
// points. Because this runs for hours while phones lock and reconnect,
// this is the platform's first (and so far only) reconnect-capable game --
// see roomService.js's markDisconnected/joinRoom reclaim path and
// index.js's disconnect/join-room wiring, both gated on meta.supportsReconnect.
// Categories/missions are sourced from the shared prompt pipeline, but
// player submissions are deliberately rejected here (see onPromptSubmitted).

const promptLogic = require("./promptLogic");
const promptPacks = require("./promptPacks");

const meta = {
  id: "secret-missions",
  name: "Secret Mission Bingo",
  description:
    "Everyone gets 3 secret real-life missions for the night. The big screen shows every mission in play — but not whose. Complete yours sneakily, catch your friends doing theirs.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
  usesPromptPipeline: true,
  supportsReconnect: true,
};

const POOL = promptPacks[meta.id];
const MISSIONS_PER_PLAYER = 3;
const STARTING_ACCUSATIONS = 3;
const CLAIM_POINTS = 100;

function activePlayerIds(room) {
  return Array.from(room.players.keys());
}

function initGameState(room) {
  room.gameState = {
    phase: "setup", // setup -> in-play -> game-over
    missions: [], // [{id, text, ownerId, status: "open"|"claimed"|"busted"}]
    scores: new Map(), // playerId -> {nickname, score}
    accusationsLeft: new Map(), // playerId -> int
    promptState: { maxSpice: 1, usedIndexes: new Set(), queue: [] },
  };
}

function onSetSpice(room, io, spice) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "setup") return { error: "Can't change spice after the night has started." };
  const safeSpice = [1, 2, 3].includes(spice) ? spice : gs.promptState.maxSpice;
  gs.promptState.maxSpice = safeSpice;
  return {};
}

// Player-submitted missions are rejected: a player who wrote a mission would
// recognize their own text on the public board and could deduce who has it
// by elimination once missions are assigned. AI-approved missions still flow
// in via host:approve-prompts (same generic pipeline handler in index.js),
// since the host -- not the players -- reviews those before they're used.
function onPromptSubmitted() {
  return { error: "Mission submissions aren't accepted for this game." };
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

function publicBoard(gs) {
  return gs.missions.map((m) => ({ id: m.id, text: m.text, status: m.status }));
}

function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function missionsForPlayer(gs, playerId) {
  return gs.missions
    .filter((m) => m.ownerId === playerId)
    .map((m) => ({ id: m.id, text: m.text, status: m.status }));
}

function broadcastBoard(room, io) {
  const gs = room.gameState;
  io.in(room.code).emit("game:mission-board", {
    missions: publicBoard(gs),
    scores: scoreboard(gs),
    accusationsLeft: Array.from(gs.accusationsLeft.entries()).map(([id, left]) => ({ id, left })),
  });
}

// Draws MISSIONS_PER_PLAYER x playerCount missions from the pipeline,
// allowing pack repeats across different players (but never two identical
// texts for the same player) once the eligible pool runs short.
function drawMissionPool(gs, count) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    const draw = promptLogic.drawNext(gs.promptState.queue, POOL, gs.promptState.usedIndexes, gs.promptState.maxSpice);
    if (draw.error) return { error: draw.error };
    gs.promptState.queue = draw.nextQueue;
    gs.promptState.usedIndexes = draw.usedIndexes;
    drawn.push(draw.prompt);
  }
  return { drawn };
}

function onStartMissions(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "setup") return { error: "The night has already started." };

  const playerIds = activePlayerIds(room);
  if (playerIds.length < meta.minPlayers) return { error: `Need at least ${meta.minPlayers} players to start.` };

  const needed = playerIds.length * MISSIONS_PER_PLAYER;
  const draw = drawMissionPool(gs, needed);
  if (draw.error) return { error: draw.error };

  // Deal MISSIONS_PER_PLAYER unique-per-player texts to each player, never
  // repeating a text for the SAME player even if the underlying pack had to
  // repeat across the whole batch.
  const remaining = draw.drawn.slice();
  const assignments = [];
  for (const playerId of playerIds) {
    const givenTexts = new Set();
    let missionsGiven = 0;
    let scanIndex = 0;
    while (missionsGiven < MISSIONS_PER_PLAYER && remaining.length > 0) {
      if (scanIndex >= remaining.length) scanIndex = 0;
      const candidate = remaining[scanIndex];
      if (!givenTexts.has(candidate.text)) {
        givenTexts.add(candidate.text);
        assignments.push({ ownerId: playerId, prompt: candidate });
        remaining.splice(scanIndex, 1);
        missionsGiven += 1;
      } else {
        scanIndex += 1;
      }
    }
  }

  gs.missions = shuffle(assignments).map((a, i) => ({
    id: `mission-${i}-${Math.random().toString(36).slice(2, 8)}`,
    text: a.prompt.text,
    ownerId: a.ownerId,
    status: "open",
  }));
  gs.accusationsLeft = new Map(playerIds.map((id) => [id, STARTING_ACCUSATIONS]));
  gs.phase = "in-play";
  room.state = "in-progress";

  for (const playerId of playerIds) {
    ensureScoreEntry(gs, room, playerId);
    io.to(playerId).emit("game:your-missions", { missions: missionsForPlayer(gs, playerId) });
  }
  broadcastBoard(room, io);
  return {};
}

function onClaimMission(room, io, socketId, missionId) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "in-play") return {};

  const mission = gs.missions.find((m) => m.id === missionId);
  if (!mission || mission.ownerId !== socketId || mission.status !== "open") {
    return { error: "That mission can't be claimed right now." };
  }

  mission.status = "claimed";
  const entry = ensureScoreEntry(gs, room, socketId);
  entry.score += CLAIM_POINTS;

  io.to(socketId).emit("game:your-missions", { missions: missionsForPlayer(gs, socketId) });
  broadcastBoard(room, io);
  return {};
}

function onAccuse(room, io, socketId, targetPlayerId, missionId) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "in-play") return {};

  const accusationsLeft = gs.accusationsLeft.get(socketId) || 0;
  if (accusationsLeft <= 0) return { error: "No accusations left." };
  if (targetPlayerId === socketId) return { error: "Can't accuse yourself." };

  const mission = gs.missions.find((m) => m.id === missionId);
  if (!mission || mission.status === "busted") return { error: "That mission can't be accused right now." };

  gs.accusationsLeft.set(socketId, accusationsLeft - 1);

  const targetPlayer = room.players.get(targetPlayerId);
  const accuserEntry = ensureScoreEntry(gs, room, socketId);
  const hit = mission.ownerId === targetPlayerId;

  if (hit) {
    const wasClaimed = mission.status === "claimed";
    mission.status = "busted";
    if (wasClaimed) {
      const ownerEntry = ensureScoreEntry(gs, room, mission.ownerId);
      ownerEntry.score -= CLAIM_POINTS;
    }
    accuserEntry.score += CLAIM_POINTS;
    io.to(mission.ownerId).emit("game:your-missions", { missions: missionsForPlayer(gs, mission.ownerId) });
  } else {
    accuserEntry.score -= 50;
  }

  io.in(room.code).emit("game:accusation-result", {
    accuserNickname: accuserEntry.nickname,
    targetNickname: targetPlayer ? targetPlayer.nickname : "Unknown",
    missionText: mission.text,
    hit,
  });
  broadcastBoard(room, io);
  return {};
}

function onEndGame(room, io) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "in-play") return { error: "Can't end the game right now." };
  gs.phase = "game-over";
  room.state = "results";

  const ownerNicknames = new Map();
  for (const m of gs.missions) {
    if (!ownerNicknames.has(m.ownerId)) {
      const entry = ensureScoreEntry(gs, room, m.ownerId);
      ownerNicknames.set(m.ownerId, entry.nickname);
    }
  }

  const scores = scoreboard(gs);
  const topScore = scores.length ? scores[0].score : 0;
  const winners = scores.filter((s) => s.score === topScore);
  const reveal = gs.missions.map((m) => ({
    text: m.text,
    ownerNickname: ownerNicknames.get(m.ownerId),
    status: m.status,
  }));

  io.in(room.code).emit("game:results", { winners, reveal, scores });
  return {};
}

// Player tab-switch/reconnect: re-send private missions + the public board.
function onPlayerSync(room, io, socketId) {
  const gs = room.gameState;
  if (!gs || gs.phase !== "in-play") return;
  io.to(socketId).emit("game:your-missions", { missions: missionsForPlayer(gs, socketId) });
  io.to(socketId).emit("game:mission-board", {
    missions: publicBoard(gs),
    scores: scoreboard(gs),
    accusationsLeft: Array.from(gs.accusationsLeft.entries()).map(([id, left]) => ({ id, left })),
  });
}

// Re-keys every reference to the old socketId (mission ownership, score
// entry, accusation budget) onto the new one, then re-sends private state --
// this is what makes a locked-then-unlocked phone survive the whole night.
function onPlayerReconnected(room, io, oldSocketId, newSocketId) {
  const gs = room.gameState;
  if (!gs) return;

  gs.missions.forEach((m) => {
    if (m.ownerId === oldSocketId) m.ownerId = newSocketId;
  });

  if (gs.scores.has(oldSocketId)) {
    gs.scores.set(newSocketId, gs.scores.get(oldSocketId));
    gs.scores.delete(oldSocketId);
  }
  if (gs.accusationsLeft.has(oldSocketId)) {
    gs.accusationsLeft.set(newSocketId, gs.accusationsLeft.get(oldSocketId));
    gs.accusationsLeft.delete(oldSocketId);
  }

  onPlayerSync(room, io, newSocketId);
  broadcastBoard(room, io);
}

module.exports = {
  meta,
  initGameState,
  onSetSpice,
  onPromptSubmitted,
  onStartMissions,
  onClaimMission,
  onAccuse,
  onEndGame,
  onPlayerSync,
  onPlayerReconnected,
};

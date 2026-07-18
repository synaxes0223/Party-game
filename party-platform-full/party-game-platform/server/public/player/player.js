const socket = io();

let roomCode = null;
let myId = null;
let currentPlayers = [];
let selectedVoteTarget = null;
let iAmEliminated = false;
// room:player-list only reflects join/disconnect, never in-game elimination
// (the server's publicRoomView has no notion of it) — so the vote candidate
// list must track eliminations itself from game:round-results, accumulated
// across every round, or a voter could target an already-eliminated player.
// The server silently drops such a vote (no error emitted back), and since
// voting has no timer, that would hang the round forever with no recovery.
let eliminatedPlayerIds = new Set();
let currentGameId = null;
let myAvalonRole = null;

const screens = {
  join: document.getElementById("screen-join"),
  waiting: document.getElementById("screen-waiting"),
  audioReady: document.getElementById("screen-audio-ready"),
  wordReveal: document.getElementById("screen-word-reveal"),
  playing: document.getElementById("screen-playing"),
  slipUpPlay: document.getElementById("screen-slipup-play"),
  roundResults: document.getElementById("screen-round-results"),
  spectator: document.getElementById("screen-spectator"),
  results: document.getElementById("screen-results"),
  avalonRoleReveal: document.getElementById("screen-avalon-role-reveal"),
  avalonTeamProposal: document.getElementById("screen-avalon-team-proposal"),
  avalonTeamVote: document.getElementById("screen-avalon-team-vote"),
  avalonQuest: document.getElementById("screen-avalon-quest"),
  avalonAssassin: document.getElementById("screen-avalon-assassin"),
  avalonResults: document.getElementById("screen-avalon-results"),
};

// Only Word Wolf uses "wolf" wording in the shared round-results/final-
// results screens; every other game (today, just Find the Imposter) keeps
// the original "imposter" wording unchanged.
function roleLabel() {
  return currentGameId === "word-wolf" ? "wolf" : "imposter";
}

socket.on("room:game-selected", ({ gameId }) => {
  currentGameId = gameId;
});

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

socket.on("connect", () => {
  myId = socket.id;
});

// ---- Join flow ----
document.getElementById("btn-join").addEventListener("click", attemptJoin);
document.getElementById("input-nickname").addEventListener("keydown", (e) => {
  if (e.key === "Enter") attemptJoin();
});

function attemptJoin() {
  const code = document.getElementById("input-code").value.trim().toUpperCase();
  const nickname = document.getElementById("input-nickname").value.trim();
  document.getElementById("join-error").textContent = "";

  if (!code || !nickname) {
    document.getElementById("join-error").textContent = "Enter both room code and your name.";
    return;
  }
  socket.emit("player:join-room", { code, nickname });
}

socket.on("player:join-error", ({ error }) => {
  document.getElementById("join-error").textContent = error;
});

socket.on("player:joined", ({ room }) => {
  roomCode = room.code;
  renderPlayerList(room.players);
  showScreen("waiting");
});

socket.on("room:player-list", ({ players }) => {
  currentPlayers = players;
  renderPlayerList(players);
});

// ---- Word Wolf: word reveal ----
socket.on("game:reveal-word", ({ word }) => {
  document.getElementById("word-reveal-text").textContent = word;
  showScreen("wordReveal");
});

// ---- Avalon: role reveal + phase routing ----
socket.on("game:avalon-role", (role) => {
  myAvalonRole = role;
  const teamLabel = role.team === "good" ? "🛡️ Good" : "🗡️ Evil";
  document.getElementById("avalon-role-team").textContent = `${teamLabel} — ${role.role}`;

  let detail = "";
  if (role.role === "merlin") {
    detail = `You see Evil: ${role.evilPlayers.map((p) => p.nickname).join(", ")}`;
  } else if (role.role === "percival") {
    detail = `Merlin and Morgana (in some order): ${role.percivalPair.map((p) => p.nickname).join(", ")}`;
  } else if (role.evilPlayers.length > 0) {
    detail = `Your fellow Evil players: ${role.evilPlayers.map((p) => p.nickname).join(", ")}`;
  } else {
    detail = "You have no special knowledge this game.";
  }
  document.getElementById("avalon-role-detail").textContent = detail;
});

const AVALON_PHASE_SCREEN = {
  "role-reveal": "avalonRoleReveal",
  "team-proposal": "avalonTeamProposal",
  "team-vote": "avalonTeamVote",
  quest: "avalonQuest",
  "quest-result": "avalonTeamProposal", // Task 15 renders a distinct wait message for this phase on the same screen
  assassin: "avalonAssassin",
};

socket.on("game:avalon-state", (state) => {
  if (state.phase === "game-over") return; // handled by game:avalon-results
  const screenName = AVALON_PHASE_SCREEN[state.phase];
  if (screenName) showScreen(screenName);
});

document.getElementById("btn-start-voting").addEventListener("click", () => {
  selectedVoteTarget = null;
  renderVoteOptions(currentPlayers);
  showScreen("playing");
  document.getElementById("vote-status").textContent = "";
});

function renderPlayerList(players) {
  const list = document.getElementById("player-list");
  if (!list) return;
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.nickname + (p.id === myId ? " (you)" : "");
    list.appendChild(li);
  });
}

// ---- Game: audio loading (built-in/upload use <audio>, YouTube uses a
// hidden IFrame Player -- both are dispatched from the same handler based
// on the track's sourceType) ----
const audioEl = document.getElementById("audio-player");
let currentTrack = null;
let ytPlayer = null;
let ytApiReadyPromise = null;

function ensureYouTubeApiLoaded() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiReadyPromise) return ytApiReadyPromise;
  ytApiReadyPromise = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiReadyPromise;
}

function ensureYtPlayer() {
  return ensureYouTubeApiLoaded().then(() => {
    if (ytPlayer) return ytPlayer;
    return new Promise((resolve) => {
      ytPlayer = new YT.Player("youtube-player-container", {
        height: "1",
        width: "1",
        events: {
          onReady: () => resolve(ytPlayer),
          onError: () => {
            document.getElementById("ready-status").textContent =
              "This video couldn't be loaded — ask the host to pick a different link.";
            document.getElementById("btn-ready").disabled = true;
          },
        },
      });
    });
  });
}

socket.on("game:load-audio", (track) => {
  currentTrack = track;
  document.getElementById("ready-status").textContent = "";
  document.getElementById("btn-ready").disabled = false;

  if (track.sourceType === "youtube") {
    ensureYtPlayer().then((player) => {
      player.cueVideoById({ videoId: track.videoId, startSeconds: track.startSeconds || 0 });
    });
  } else {
    audioEl.src = track.audioUrl;
    audioEl.load();
  }
  showScreen("audioReady");
});

document.getElementById("btn-ready").addEventListener("click", () => {
  // iOS/Android require a user gesture before audio can be played later —
  // this tap counts as that gesture. We prime playback here (play+immediately
  // pause) so the later synced play() call succeeds without another prompt.
  const markReady = () => {
    socket.emit("player:audio-ready", { code: roomCode });
    document.getElementById("ready-status").textContent = "Waiting for the host to start playback…";
    document.getElementById("btn-ready").disabled = true;
  };

  if (currentTrack && currentTrack.sourceType === "youtube") {
    ensureYtPlayer().then((player) => {
      player.playVideo();
      setTimeout(() => player.pauseVideo(), 50);
      markReady();
    });
    return;
  }

  audioEl.play().then(() => {
    audioEl.pause();
    audioEl.currentTime = 0;
    markReady();
  }).catch(() => {
    // Some browsers block silent priming; still tell server we're ready —
    // playback will be attempted directly at sync time.
    markReady();
  });
});

// ---- Game: host-controlled synced playback ----
socket.on("game:play-at", ({ startAt, position }) => {
  const delay = Math.max(0, startAt - Date.now());
  if (currentTrack && currentTrack.sourceType === "youtube") {
    setTimeout(() => {
      ytPlayer.seekTo((position || 0) / 1000, true);
      ytPlayer.playVideo();
    }, delay);
  } else {
    setTimeout(() => {
      audioEl.currentTime = (position || 0) / 1000;
      audioEl.play().catch((err) => console.warn("Playback failed:", err));
    }, delay);
  }

  selectedVoteTarget = null;
  renderVoteOptions(currentPlayers);
  showScreen("playing");
  document.getElementById("vote-status").textContent = "";
});

socket.on("game:pause-at", ({ pauseAt }) => {
  const delay = Math.max(0, pauseAt - Date.now());
  if (currentTrack && currentTrack.sourceType === "youtube") {
    setTimeout(() => ytPlayer.pauseVideo(), delay);
  } else {
    setTimeout(() => audioEl.pause(), delay);
  }
});

// ---- Voting: select a target, then a separate confirm step ----
function renderVoteOptions(players) {
  const container = document.getElementById("vote-list");
  container.innerHTML = "";
  const confirmBtn = document.getElementById("btn-confirm-vote");
  confirmBtn.disabled = true;

  const candidates = players.filter((p) => p.id !== myId && !eliminatedPlayerIds.has(p.id));
  candidates.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "vote-btn";
    btn.textContent = p.nickname;
    btn.addEventListener("click", () => selectVoteTarget(p.id, btn));
    container.appendChild(btn);
  });

  const skipBtn = document.createElement("button");
  skipBtn.className = "vote-btn";
  skipBtn.textContent = "Skip — no vote this round";
  skipBtn.addEventListener("click", () => selectVoteTarget("skip", skipBtn));
  container.appendChild(skipBtn);
}

function selectVoteTarget(targetId, btnEl) {
  selectedVoteTarget = targetId;
  document.querySelectorAll(".vote-btn").forEach((b) => b.classList.remove("selected"));
  btnEl.classList.add("selected");
  document.getElementById("btn-confirm-vote").disabled = false;
}

document.getElementById("btn-confirm-vote").addEventListener("click", () => {
  if (!selectedVoteTarget) return;
  document.querySelectorAll(".vote-btn").forEach((b) => (b.disabled = true));
  document.getElementById("btn-confirm-vote").disabled = true;
  socket.emit("player:vote", { code: roomCode, votedForId: selectedVoteTarget });
  document.getElementById("vote-status").textContent = "Vote submitted — waiting for others…";
});

socket.on("player:vote-rejected", ({ reason }) => {
  selectedVoteTarget = null;
  renderVoteOptions(currentPlayers);
  document.getElementById("vote-status").textContent = reason || "That vote couldn't be submitted — pick again.";
});

// ---- Round results ----
socket.on("game:round-results", ({ eliminated, wasImposter, remainingActive }) => {
  const role = roleLabel();
  const text = eliminated
    ? `${eliminated.nickname}${eliminated.id === myId ? " (you)" : ""} was voted out — ${wasImposter ? "they were" : "they were NOT"} the ${role}. ${remainingActive} players remain.`
    : `No one was eliminated this round. ${remainingActive} players remain.`;

  if (eliminated) {
    eliminatedPlayerIds.add(eliminated.id);
    if (eliminated.id === myId) {
      iAmEliminated = true;
    }
  }

  if (iAmEliminated) {
    document.getElementById("spectator-round-text").textContent = text;
    showScreen("spectator");
  } else {
    document.getElementById("round-elimination-text").textContent = text;
    showScreen("roundResults");
  }
});

// ---- Final results ----
socket.on("game:results", ({ imposter, winner, results }) => {
  const role = roleLabel();
  const emoji = role === "wolf" ? "🐺" : "🎭";
  const winnerText = winner === "crew"
    ? `🕵️ The crew caught the ${role}!`
    : `${emoji} The ${role} got away with it!`;
  document.getElementById("imposter-reveal").textContent = imposter
    ? `${winnerText} It was ${imposter.nickname}.`
    : winnerText;

  const list = document.getElementById("results-list");
  list.innerHTML = "";
  results.forEach((r) => {
    const li = document.createElement("li");
    if (r.wasImposter) li.classList.add("was-imposter");
    const youTag = r.id === myId ? " (you)" : "";
    const status = r.eliminated ? "eliminated" : "survived";
    li.innerHTML = `<span>${r.nickname}${youTag}${r.wasImposter ? ` ${emoji}` : ""}</span><span>${status}</span>`;
    list.appendChild(li);
  });

  showScreen("results");
});

socket.on("room:reset", ({ room }) => {
  iAmEliminated = false;
  eliminatedPlayerIds = new Set();
  currentGameId = null;
  renderPlayerList(room.players);
  document.getElementById("btn-ready").disabled = false;
  showScreen("waiting");
});

socket.on("room:host-disconnected", () => {
  alert("Host disconnected. The room has closed.");
});

// ---- Slip-Up ----
socket.on("game:your-view", ({ others }) => {
  const container = document.getElementById("slipup-others-list");
  container.innerHTML = "";
  others.forEach((o) => {
    const row = document.createElement("div");
    row.className = "slipup-entry-row";
    const icon = o.entry.type === "action" ? "🤸" : "🗣️";
    row.innerHTML = `<span>${o.nickname}</span><span>${icon} ${o.entry.text}</span>`;
    container.appendChild(row);
  });
  showScreen("slipUpPlay");
});

socket.on("game:score-update", ({ scores }) => {
  const list = document.getElementById("slipup-scoreboard-player");
  if (!list) return;
  list.innerHTML = "";
  scores
    .slice()
    .sort((a, b) => a.catchCount - b.catchCount)
    .forEach((s) => {
      const li = document.createElement("li");
      const youTag = s.id === myId ? " (you)" : "";
      li.innerHTML = `<span>${s.nickname}${youTag}</span><span>${s.catchCount} caught</span>`;
      list.appendChild(li);
    });
});

socket.on("game:you-were-caught", () => {
  const toast = document.getElementById("slipup-caught-toast");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
});

socket.on("game:final-results", ({ results }) => {
  document.getElementById("imposter-reveal").textContent =
    results.length > 0
      ? `🏆 ${results[0].nickname} wins with the fewest catches!`
      : "No players left to rank.";
  const list = document.getElementById("results-list");
  list.innerHTML = "";
  results.forEach((r) => {
    const li = document.createElement("li");
    const youTag = r.id === myId ? " (you)" : "";
    li.innerHTML = `<span>${r.nickname}${youTag}</span><span>${r.catchCount} caught</span>`;
    list.appendChild(li);
  });
  showScreen("results");
});

// ---- Punishment Wheel submission (room-level, independent of any game) ----
const wheelSubmitPanel = document.getElementById("wheel-submit-panel");

document.getElementById("btn-wheel-submit-toggle").addEventListener("click", () => {
  wheelSubmitPanel.classList.toggle("hidden");
});
document.getElementById("btn-wheel-submit-close").addEventListener("click", () => {
  wheelSubmitPanel.classList.add("hidden");
});

document.getElementById("btn-wheel-submit").addEventListener("click", submitPunishment);
document.getElementById("wheel-submit-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitPunishment();
});

function submitPunishment() {
  const input = document.getElementById("wheel-submit-input");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("wheel:add-punishment", { code: roomCode, text });
  input.value = "";
  const status = document.getElementById("wheel-submit-status");
  status.textContent = "Added!";
  setTimeout(() => { status.textContent = ""; }, 2000);
}

socket.on("wheel:add-error", ({ error }) => {
  document.getElementById("wheel-submit-status").textContent = error;
});

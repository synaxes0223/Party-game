const socket = io();

let roomCode = null;
let myId = null;
let currentPlayers = [];
let selectedVoteTarget = null;
let iAmEliminated = false;

const screens = {
  join: document.getElementById("screen-join"),
  waiting: document.getElementById("screen-waiting"),
  audioReady: document.getElementById("screen-audio-ready"),
  playing: document.getElementById("screen-playing"),
  roundResults: document.getElementById("screen-round-results"),
  spectator: document.getElementById("screen-spectator"),
  results: document.getElementById("screen-results"),
};

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

// ---- Game: audio loading ----
const audioEl = document.getElementById("audio-player");

socket.on("game:load-audio", ({ audioUrl }) => {
  audioEl.src = audioUrl;
  audioEl.load();
  document.getElementById("ready-status").textContent = "";
  document.getElementById("btn-ready").disabled = false;
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
  setTimeout(() => {
    audioEl.currentTime = (position || 0) / 1000;
    audioEl.play().catch((err) => console.warn("Playback failed:", err));
  }, delay);

  selectedVoteTarget = null;
  renderVoteOptions(currentPlayers);
  showScreen("playing");
  document.getElementById("vote-status").textContent = "";
});

socket.on("game:pause-at", ({ pauseAt }) => {
  const delay = Math.max(0, pauseAt - Date.now());
  setTimeout(() => audioEl.pause(), delay);
});

// ---- Voting: select a target, then a separate confirm step ----
function renderVoteOptions(players) {
  const container = document.getElementById("vote-list");
  container.innerHTML = "";
  const confirmBtn = document.getElementById("btn-confirm-vote");
  confirmBtn.disabled = true;

  const candidates = players.filter((p) => p.id !== myId);
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

// ---- Round results ----
socket.on("game:round-results", ({ eliminated, wasImposter, remainingActive }) => {
  const text = eliminated
    ? `${eliminated.nickname}${eliminated.id === myId ? " (you)" : ""} was voted out — ${wasImposter ? "they were" : "they were NOT"} the imposter. ${remainingActive} players remain.`
    : `No one was eliminated this round. ${remainingActive} players remain.`;

  if (eliminated && eliminated.id === myId) {
    iAmEliminated = true;
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
  const winnerText = winner === "crew"
    ? "🕵️ The crew caught the imposter!"
    : "🎭 The imposter got away with it!";
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
    li.innerHTML = `<span>${r.nickname}${youTag}${r.wasImposter ? " 🎭" : ""}</span><span>${status}</span>`;
    list.appendChild(li);
  });

  showScreen("results");
});

socket.on("room:reset", ({ room }) => {
  iAmEliminated = false;
  renderPlayerList(room.players);
  document.getElementById("btn-ready").disabled = false;
  showScreen("waiting");
});

socket.on("room:host-disconnected", () => {
  alert("Host disconnected. The room has closed.");
});

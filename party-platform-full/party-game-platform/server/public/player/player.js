const socket = io();

let roomCode = null;
let myId = null;
let hasVoted = false;

const screens = {
  join: document.getElementById("screen-join"),
  waiting: document.getElementById("screen-waiting"),
  audioReady: document.getElementById("screen-audio-ready"),
  playing: document.getElementById("screen-playing"),
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
let currentPlayers = [];

socket.on("game:load-audio", ({ audioUrl }) => {
  audioEl.src = audioUrl;
  audioEl.load();
  document.getElementById("ready-status").textContent = "";
  showScreen("audioReady");
});

document.getElementById("btn-ready").addEventListener("click", () => {
  // iOS/Android require a user gesture before audio can be played later —
  // this tap counts as that gesture. We prime playback here (play+immediately
  // pause) so the later synced play() call succeeds without another prompt.
  audioEl.play().then(() => {
    audioEl.pause();
    audioEl.currentTime = 0;
    socket.emit("player:audio-ready", { code: roomCode });
    document.getElementById("ready-status").textContent = "Waiting for other players…";
    document.getElementById("btn-ready").disabled = true;
  }).catch(() => {
    // Some browsers block silent priming; still tell server we're ready —
    // playback will be attempted directly at sync time.
    socket.emit("player:audio-ready", { code: roomCode });
    document.getElementById("ready-status").textContent = "Waiting for other players…";
    document.getElementById("btn-ready").disabled = true;
  });
});

// ---- Game: synced playback ----
socket.on("game:play-at", ({ startAt }) => {
  const delay = Math.max(0, startAt - Date.now());
  setTimeout(() => {
    audioEl.currentTime = 0;
    audioEl.play().catch((err) => console.warn("Playback failed:", err));
  }, delay);

  hasVoted = false;
  renderVoteOptions(currentPlayers);
  showScreen("playing");
  document.getElementById("vote-status").textContent = "";
});

socket.on("room:player-list", ({ players }) => {
  currentPlayers = players;
});

function renderVoteOptions(players) {
  const container = document.getElementById("vote-list");
  container.innerHTML = "";
  players.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "vote-btn";
    btn.textContent = p.nickname + (p.id === myId ? " (you)" : "");
    btn.addEventListener("click", () => {
      if (hasVoted) return;
      hasVoted = true;
      document.querySelectorAll(".vote-btn").forEach((b) => (b.disabled = true));
      btn.classList.add("voted");
      socket.emit("player:vote", { code: roomCode, votedForId: p.id });
      document.getElementById("vote-status").textContent = "Vote submitted — waiting for others…";
    });
    container.appendChild(btn);
  });
}

// ---- Results ----
socket.on("game:results", ({ imposter, results }) => {
  document.getElementById("imposter-reveal").textContent = imposter
    ? `🎭 The imposter was ${imposter.nickname}!`
    : "No imposter data.";

  const list = document.getElementById("results-list");
  list.innerHTML = "";
  results
    .sort((a, b) => b.votesReceived - a.votesReceived)
    .forEach((r) => {
      const li = document.createElement("li");
      if (r.wasImposter) li.classList.add("was-imposter");
      const youTag = r.id === myId ? " (you)" : "";
      li.innerHTML = `<span>${r.nickname}${youTag}${r.wasImposter ? " 🎭" : ""}</span><span>${r.votesReceived} votes</span>`;
      list.appendChild(li);
    });

  showScreen("results");
});

socket.on("room:reset", ({ room }) => {
  renderPlayerList(room.players);
  document.getElementById("btn-ready").disabled = false;
  showScreen("waiting");
});

socket.on("room:host-disconnected", () => {
  alert("Host disconnected. The room has closed.");
});

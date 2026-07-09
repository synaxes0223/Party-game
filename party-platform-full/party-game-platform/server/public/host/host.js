const socket = io();

let roomCode = null;
let selectedGameId = null;

const screens = {
  start: document.getElementById("screen-start"),
  lobby: document.getElementById("screen-lobby"),
  trackSelect: document.getElementById("screen-track-select"),
  game: document.getElementById("screen-game"),
  roundResults: document.getElementById("screen-round-results"),
  results: document.getElementById("screen-results"),
};

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

document.getElementById("btn-create-room").addEventListener("click", () => {
  socket.emit("host:create-room");
});

socket.on("host:room-created", ({ room, games }) => {
  roomCode = room.code;
  document.getElementById("room-code").textContent = room.code;
  document.getElementById("join-url").textContent =
    `${window.location.protocol}//${window.location.host}/player`;
  renderGameList(games);
  showScreen("lobby");
});

socket.on("host:room-updated", ({ room }) => {
  renderPlayers(room.players);
});

function renderPlayers(players) {
  const list = document.getElementById("player-list");
  const countEl = document.getElementById("player-count");
  const emptyHint = document.getElementById("player-empty-hint");

  countEl.textContent = players.length;
  list.innerHTML = "";
  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.nickname;
    list.appendChild(li);
  });
  emptyHint.style.display = players.length === 0 ? "block" : "none";
  updateStartButton();
}

function renderGameList(games) {
  const container = document.getElementById("game-list");
  container.innerHTML = "";
  games.forEach((g) => {
    const card = document.createElement("div");
    card.className = "game-card";
    card.dataset.gameId = g.id;
    card.innerHTML = `
      <div class="name">${g.name}</div>
      <div class="desc">${g.description}</div>
      <div class="players-req">${g.minPlayers}-${g.maxPlayers} players</div>
    `;
    card.addEventListener("click", () => {
      selectedGameId = g.id;
      document.querySelectorAll(".game-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
      socket.emit("host:select-game", { code: roomCode, gameId: g.id });
      updateStartButton();
    });
    container.appendChild(card);
  });
}

function updateStartButton() {
  const btn = document.getElementById("btn-start-game");
  const playerCount = document.querySelectorAll("#player-list li").length;
  btn.disabled = !(selectedGameId && playerCount >= 3);
}

document.getElementById("btn-start-game").addEventListener("click", () => {
  document.getElementById("lobby-error").textContent = "";
  showScreen("trackSelect");
});

socket.on("host:error", ({ error }) => {
  document.getElementById("lobby-error").textContent = error;
  document.getElementById("track-select-error").textContent = error;
});

// ---- Track selection ----
socket.on("game:track-pairs", ({ pairs }) => {
  renderPairList(pairs);
  showScreen("trackSelect");
});

function renderPairList(pairs) {
  const container = document.getElementById("pair-list");
  container.innerHTML = "";
  pairs.forEach((pair) => {
    const card = document.createElement("div");
    card.className = "game-card";
    card.innerHTML = `<div class="name">${pair.label}</div>`;
    card.addEventListener("click", () => {
      document.getElementById("track-select-error").textContent = "";
      socket.emit("host:select-track-pair", { code: roomCode, pairId: pair.id });
    });
    container.appendChild(card);
  });
}

// ---- Round start / playback ----
socket.on("game:started", ({ round, playerCount }) => {
  document.getElementById("round-title").textContent = `Round ${round}`;
  document.getElementById("game-title-active").textContent = `Round ${round} — Find the Imposter`;
  document.getElementById("progress-text").textContent = `Loading audio on ${playerCount} devices…`;
  document.getElementById("progress-fill").style.width = "0%";
  setPlaybackButtons("loading");
  showScreen("game");
});

socket.on("game:ready-progress", ({ ready, total }) => {
  document.getElementById("progress-text").textContent = `${ready} / ${total} devices ready`;
  document.getElementById("progress-fill").style.width = `${(ready / total) * 100}%`;
});

socket.on("game:all-ready", () => {
  document.getElementById("progress-text").textContent = "Everyone's ready — hit Play when you are.";
  setPlaybackButtons("ready");
});

document.getElementById("btn-play").addEventListener("click", () => {
  socket.emit("host:play-audio", { code: roomCode });
  setPlaybackButtons("playing");
});
document.getElementById("btn-pause").addEventListener("click", () => {
  socket.emit("host:pause-audio", { code: roomCode });
  setPlaybackButtons("paused");
});
document.getElementById("btn-resume").addEventListener("click", () => {
  socket.emit("host:resume-audio", { code: roomCode });
  setPlaybackButtons("playing");
});
document.getElementById("btn-restart").addEventListener("click", () => {
  socket.emit("host:restart-audio", { code: roomCode });
  setPlaybackButtons("playing");
});

function setPlaybackButtons(state) {
  const buttons = {
    play: document.getElementById("btn-play"),
    pause: document.getElementById("btn-pause"),
    resume: document.getElementById("btn-resume"),
    restart: document.getElementById("btn-restart"),
  };
  Object.values(buttons).forEach((b) => (b.style.display = "none"));
  if (state === "ready") {
    buttons.play.style.display = "block";
  } else if (state === "playing") {
    buttons.pause.style.display = "block";
    buttons.restart.style.display = "block";
  } else if (state === "paused") {
    buttons.resume.style.display = "block";
    buttons.restart.style.display = "block";
  }
}

socket.on("game:vote-progress", ({ voted, total }) => {
  document.getElementById("progress-text").textContent = `${voted} / ${total} players voted`;
  document.getElementById("progress-fill").style.width = `${(voted / total) * 100}%`;
});

// ---- Round results ----
socket.on("game:round-results", ({ round, eliminated, wasImposter, remainingActive }) => {
  document.getElementById("round-results-title").textContent = `Round ${round} Results`;
  const text = eliminated
    ? `${eliminated.nickname} was voted out — they were ${wasImposter ? "" : "NOT "}the imposter. ${remainingActive} players remain.`
    : `No one was eliminated this round. ${remainingActive} players remain.`;
  document.getElementById("round-elimination-text").textContent = text;
  showScreen("roundResults");
});

document.getElementById("btn-next-round").addEventListener("click", () => {
  socket.emit("host:next-round", { code: roomCode });
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
    const status = r.eliminated ? "eliminated" : "survived";
    li.innerHTML = `<span>${r.nickname}${r.wasImposter ? " 🎭" : ""}</span><span>${status}</span>`;
    list.appendChild(li);
  });

  showScreen("results");
});

document.getElementById("btn-play-again").addEventListener("click", () => {
  selectedGameId = null;
  socket.emit("host:reset-room", { code: roomCode });
});

socket.on("room:reset", ({ room }) => {
  renderPlayers(room.players);
  document.querySelectorAll(".game-card").forEach((c) => c.classList.remove("selected"));
  showScreen("lobby");
});

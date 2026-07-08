const socket = io();

let roomCode = null;
let selectedGameId = null;

const screens = {
  start: document.getElementById("screen-start"),
  lobby: document.getElementById("screen-lobby"),
  game: document.getElementById("screen-game"),
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
  socket.emit("host:start-game", { code: roomCode });
});

socket.on("host:error", ({ error }) => {
  document.getElementById("lobby-error").textContent = error;
});

socket.on("game:started", ({ playerCount }) => {
  document.getElementById("game-title-active").textContent = "Find the Imposter";
  document.getElementById("progress-text").textContent = `Loading audio on ${playerCount} devices…`;
  document.getElementById("progress-fill").style.width = "0%";
  showScreen("game");
});

socket.on("game:ready-progress", ({ ready, total }) => {
  document.getElementById("progress-text").textContent = `${ready} / ${total} devices ready`;
  document.getElementById("progress-fill").style.width = `${(ready / total) * 100}%`;
});

socket.on("game:vote-progress", ({ voted, total }) => {
  document.getElementById("progress-text").textContent = `${voted} / ${total} players voted`;
  document.getElementById("progress-fill").style.width = `${(voted / total) * 100}%`;
});

socket.on("game:play-at", () => {
  document.getElementById("progress-text").textContent = "Playing on all devices — take out earphones to vote!";
});

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
      li.innerHTML = `<span>${r.nickname}${r.wasImposter ? " 🎭" : ""}</span><span>${r.votesReceived} votes</span>`;
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

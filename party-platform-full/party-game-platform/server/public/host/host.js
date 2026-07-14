const socket = io();

let roomCode = null;
let selectedGameId = null;
let hasStartedFirstRound = false;
let activePlayerCount = 0;
let lastKnownRound = 0;

const screens = {
  start: document.getElementById("screen-start"),
  lobby: document.getElementById("screen-lobby"),
  trackSelect: document.getElementById("screen-track-select"),
  setup: document.getElementById("screen-setup"),
  referee: document.getElementById("screen-referee"),
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
  activePlayerCount = players.length;
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
      document.getElementById("btn-start-game").textContent =
        g.id === "slip-up" ? "Continue to Setup" : "Continue to Round 1";
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
  if (selectedGameId === "slip-up") {
    enterSlipUpSetup();
  } else {
    enterTrackSelect();
  }
});

socket.on("host:error", ({ error }) => {
  document.getElementById("lobby-error").textContent = error;
  document.getElementById("track-select-error").textContent = error;
  document.getElementById("slipup-setup-error").textContent = error;
  document.getElementById("slipup-referee-error").textContent = error;
});

// ---- Track selection ----
// game:track-pairs fires from two different moments: (1) the instant a game
// is selected in the lobby — before players may have joined, so this must
// NOT jump the host off the lobby's player-count gate; and (2) after
// host:next-round, where there's no gating button and the host should land
// on track-select immediately. hasStartedFirstRound distinguishes the two:
// only case (2) auto-navigates; case (1) just caches the pairs and waits for
// the "Continue to Round 1" button.
socket.on("game:track-pairs", ({ pairs }) => {
  renderPairList(pairs);
  if (hasStartedFirstRound) {
    enterTrackSelect();
  }
});

let selectedUploadIds = { normal: null, imposter: null };

function enterTrackSelect() {
  document.getElementById("active-count").textContent = activePlayerCount;
  document.getElementById("round-title").textContent = `Round ${lastKnownRound + 1}`;
  document.getElementById("track-select-error").textContent = "";
  selectedUploadIds = { normal: null, imposter: null };
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector('.tab-btn[data-tab="builtin"]').classList.add("active");
  document.getElementById("tab-builtin").classList.add("active");
  showScreen("trackSelect");
}

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
  hasStartedFirstRound = true;
  lastKnownRound = round;
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
  activePlayerCount = remainingActive;
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
  hasStartedFirstRound = false;
  lastKnownRound = 0;
  renderPlayers(room.players);
  document.querySelectorAll(".game-card").forEach((c) => c.classList.remove("selected"));
  showScreen("lobby");
});

// ---- Track-select tabs ----
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "upload") {
      socket.emit("host:list-uploaded-files", { code: roomCode });
    }
  });
});

// ---- YouTube tab ----
document.getElementById("btn-select-youtube").addEventListener("click", () => {
  document.getElementById("track-select-error").textContent = "";
  const normalUrl = document.getElementById("yt-normal-url").value.trim();
  const normalStart = Number(document.getElementById("yt-normal-start").value) || 0;
  const imposterUrl = document.getElementById("yt-imposter-url").value.trim();
  const imposterStart = Number(document.getElementById("yt-imposter-start").value) || 0;
  socket.emit("host:select-youtube-pair", {
    code: roomCode,
    normal: { url: normalUrl, startSeconds: normalStart },
    imposter: { url: imposterUrl, startSeconds: imposterStart },
  });
});

// ---- Uploaded-files tab ----
document.getElementById("btn-upload-file").addEventListener("click", async () => {
  const input = document.getElementById("upload-file-input");
  const file = input.files[0];
  const statusEl = document.getElementById("upload-status");
  if (!file) {
    statusEl.textContent = "Choose a file first.";
    return;
  }
  statusEl.textContent = "Uploading…";
  const form = new FormData();
  form.append("audio", file);
  try {
    const res = await fetch("/api/upload-audio", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || "Upload failed.";
      return;
    }
    statusEl.textContent = `Uploaded ${data.originalName}.`;
    input.value = "";
    socket.emit("host:list-uploaded-files", { code: roomCode });
  } catch (err) {
    statusEl.textContent = "Upload failed — check your connection.";
  }
});

socket.on("game:uploaded-files", ({ files }) => {
  renderUploadFileList(files);
});

function renderUploadFileList(files) {
  const container = document.getElementById("upload-file-list");
  container.innerHTML = "";
  if (files.length === 0) {
    container.innerHTML = '<p class="hint">No files uploaded yet.</p>';
    return;
  }
  files.forEach((f) => {
    const row = document.createElement("div");
    row.className = "upload-file-row";
    row.innerHTML = `
      <span>${f.originalName}</span>
      <button type="button" class="btn-secondary btn-slot" data-role="normal" data-id="${f.id}">Normal</button>
      <button type="button" class="btn-secondary btn-slot" data-role="imposter" data-id="${f.id}">Imposter</button>
    `;
    container.appendChild(row);
  });

  // Re-apply the current selection's highlight -- this function re-runs
  // every time the Upload tab is revisited or a new file is uploaded, and
  // selectedUploadIds persists across those re-renders. Without this, a
  // previously-selected file would render unhighlighted, and clicking it
  // again would silently deselect it instead of the (visually implied) select.
  ["normal", "imposter"].forEach((role) => {
    const selectedId = selectedUploadIds[role];
    if (!selectedId) return;
    const btn = container.querySelector(`.btn-slot[data-role="${role}"][data-id="${selectedId}"]`);
    if (btn) btn.classList.add("selected");
  });

  container.querySelectorAll(".btn-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.dataset.role;
      const id = btn.dataset.id;
      selectedUploadIds[role] = selectedUploadIds[role] === id ? null : id;
      container.querySelectorAll(`.btn-slot[data-role="${role}"]`).forEach((b) => b.classList.remove("selected"));
      if (selectedUploadIds[role]) {
        const activeBtn = container.querySelector(`.btn-slot[data-role="${role}"][data-id="${selectedUploadIds[role]}"]`);
        if (activeBtn) activeBtn.classList.add("selected");
      }
    });
  });
}

document.getElementById("btn-select-upload").addEventListener("click", () => {
  document.getElementById("track-select-error").textContent = "";
  socket.emit("host:select-upload-pair", {
    code: roomCode,
    normalFileId: selectedUploadIds.normal,
    imposterFileId: selectedUploadIds.imposter,
  });
});

// ---- Slip-Up: setup screen ----
let slipUpEntryPool = [];
let slipUpExcludedIds = new Set();
let slipUpCustomEntries = [];

socket.on("game:entry-pool", ({ entries }) => {
  slipUpEntryPool = entries;
  slipUpExcludedIds = new Set();
  slipUpCustomEntries = [];
  renderEntryChecklist();
  renderCustomEntryList();
});

function enterSlipUpSetup() {
  document.getElementById("slipup-setup-error").textContent = "";
  showScreen("setup");
}

function renderEntryChecklist() {
  const container = document.getElementById("entry-checklist");
  container.innerHTML = "";
  slipUpEntryPool.forEach((entry) => {
    const row = document.createElement("label");
    row.className = "entry-row";
    const icon = entry.type === "action" ? "🤸" : "🗣️";
    row.innerHTML = `
      <input type="checkbox" checked data-id="${entry.id}" />
      <span>${icon} ${entry.text}</span>
    `;
    const checkbox = row.querySelector("input");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        slipUpExcludedIds.delete(entry.id);
      } else {
        slipUpExcludedIds.add(entry.id);
      }
    });
    container.appendChild(row);
  });
}

function renderCustomEntryList() {
  const list = document.getElementById("custom-entry-list");
  list.innerHTML = "";
  slipUpCustomEntries.forEach((entry, index) => {
    const li = document.createElement("li");
    const icon = entry.type === "action" ? "🤸" : "🗣️";
    li.innerHTML = `<span>${icon} ${entry.text}</span>`;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn-secondary";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      slipUpCustomEntries.splice(index, 1);
      renderCustomEntryList();
    });
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

document.getElementById("btn-add-custom-entry").addEventListener("click", () => {
  const textInput = document.getElementById("custom-entry-text");
  const typeSelect = document.getElementById("custom-entry-type");
  const text = textInput.value.trim();
  if (!text) return;
  slipUpCustomEntries.push({ type: typeSelect.value, text });
  textInput.value = "";
  renderCustomEntryList();
});

document.getElementById("btn-slipup-start").addEventListener("click", () => {
  document.getElementById("slipup-setup-error").textContent = "";
  socket.emit("host:start-game", {
    code: roomCode,
    excludedIds: Array.from(slipUpExcludedIds),
    customEntries: slipUpCustomEntries,
  });
});

// ---- Slip-Up: referee screen ----
socket.on("game:referee-view", ({ players }) => {
  const container = document.getElementById("referee-rows");
  container.innerHTML = "";
  players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "referee-row";
    const icon = p.entry.type === "action" ? "🤸" : "🗣️";
    row.innerHTML = `
      <span>${p.nickname}</span>
      <span>${icon} ${p.entry.text}</span>
      <button type="button" class="btn-secondary btn-caught" data-id="${p.id}">Caught!</button>
    `;
    row.querySelector(".btn-caught").addEventListener("click", () => {
      socket.emit("host:mark-caught", { code: roomCode, targetPlayerId: p.id });
    });
    container.appendChild(row);
  });
  showScreen("referee");
});

socket.on("game:score-update", ({ scores }) => {
  const list = document.getElementById("slipup-scoreboard");
  if (!list) return;
  list.innerHTML = "";
  scores
    .slice()
    .sort((a, b) => a.catchCount - b.catchCount)
    .forEach((s) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${s.nickname}</span><span>${s.catchCount} caught</span>`;
      list.appendChild(li);
    });
});

document.getElementById("btn-slipup-end").addEventListener("click", () => {
  socket.emit("host:end-game", { code: roomCode });
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
    li.innerHTML = `<span>${r.nickname}</span><span>${r.catchCount} caught</span>`;
    list.appendChild(li);
  });
  showScreen("results");
});

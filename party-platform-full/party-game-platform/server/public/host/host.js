const socket = io();

// The host tab lives on the phone that is also running the server, so Android
// backgrounding it is routine. On every (re)connect, try to walk back into the
// room this tab was last hosting.
socket.on("connect", () => {
  let lastCode = null;
  try { lastCode = localStorage.getItem("party-host-room"); } catch (err) {}
  if (lastCode) {
    socket.emit("host:reclaim-room", { code: lastCode, token: window.sessionToken });
  }
});

let roomCode = null;
let selectedGameId = null;
let hasStartedFirstRound = false;
let activePlayerCount = 0;
let lastKnownRound = 0;
let gamesById = {};

const screens = {
  start: document.getElementById("screen-start"),
  lobby: document.getElementById("screen-lobby"),
  trackSelect: document.getElementById("screen-track-select"),
  setup: document.getElementById("screen-setup"),
  referee: document.getElementById("screen-referee"),
  game: document.getElementById("screen-game"),
  wordSelect: document.getElementById("screen-word-select"),
  wordRound: document.getElementById("screen-word-round"),
  avalonSetup: document.getElementById("screen-avalon-setup"),
  avalonRoleReveal: document.getElementById("screen-avalon-role-reveal"),
  avalonProgress: document.getElementById("screen-avalon-progress"),
  avalonResults: document.getElementById("screen-avalon-results"),
  roundResults: document.getElementById("screen-round-results"),
  results: document.getElementById("screen-results"),
};

// Only Word Wolf uses "wolf" wording in the shared round-results/final-
// results screens; every other game (today, just Find the Imposter) keeps
// the original "imposter" wording unchanged.
function roleLabel() {
  return selectedGameId === "word-wolf" ? "wolf" : "imposter";
}

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

document.getElementById("btn-create-room").addEventListener("click", () => {
  socket.emit("host:create-room", { token: window.sessionToken });
});

// The host screen is normally opened on the host's own device, where
// window.location.host is `localhost` — useless to players. Ask the server
// which LAN address they should actually dial, and show it as a QR code so
// nobody has to type an IP at a party.
async function renderJoinInfo() {
  const urlEl = document.getElementById("join-url");
  const qrEl = document.getElementById("join-qr");
  const altEl = document.getElementById("join-url-alt");
  const fallback = `${window.location.protocol}//${window.location.host}/player/`;

  qrEl.innerHTML = "";
  altEl.textContent = "";

  let info = null;
  try {
    const res = await fetch("/api/join-info", { cache: "no-store" });
    if (res.ok) info = await res.json();
  } catch (err) {
    info = null;
  }

  const primary = (info && info.primaryJoinUrl) || fallback;
  urlEl.textContent = primary;
  if (info && info.qrSvg) qrEl.innerHTML = info.qrSvg;

  // More than one interface (e.g. WiFi client + hotspot) means the primary
  // guess can be the wrong one; list the rest so the host can try another.
  const others = ((info && info.joinUrls) || []).filter((u) => u !== primary);
  if (others.length) altEl.textContent = `If that does not work, try: ${others.join("  |  ")}`;
}

// A party can run on a hotspot with no internet at all, and YouTube playback
// silently needs one. Probe for real reachability rather than trusting
// navigator.onLine, which reports true for an internet-less hotspot.
async function isInternetReachable() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    await fetch("https://www.youtube.com/generate_204", {
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return true;
  } catch (err) {
    return false;
  }
}

async function applyYoutubeAvailability() {
  const tabBtn = document.querySelector('.tab-btn[data-tab="youtube"]');
  const notice = document.getElementById("yt-offline-notice");
  const useBtn = document.getElementById("btn-select-youtube");
  if (!tabBtn) return;

  const online = await isInternetReachable();
  tabBtn.disabled = !online;
  tabBtn.title = online ? "" : "No internet on this network";
  if (notice) notice.hidden = online;
  if (useBtn) useBtn.disabled = !online;
}

socket.on("host:room-created", ({ room, games }) => {
  try { localStorage.setItem("party-host-room", room.code); } catch (err) {}
  roomCode = room.code;
  document.getElementById("room-code").textContent = room.code;
  renderJoinInfo();
  gamesById = Object.fromEntries(games.map((g) => [g.id, g]));
  renderGameList(games);
  showScreen("lobby");
});

socket.on("host:room-updated", ({ room }) => {
  renderPlayers(room.players);
});

socket.on("host:room-reclaimed", ({ room, games }) => {
  roomCode = room.code;
  document.getElementById("room-code").textContent = room.code;
  renderJoinInfo();
  gamesById = Object.fromEntries(games.map((g) => [g.id, g]));
  renderGameList(games);
  renderPlayers(room.players);
  showScreen("lobby");
});

socket.on("host:reclaim-failed", () => {
  // The room is gone (swept, or the server restarted). Forget it so the next
  // connect does not keep asking.
  try { localStorage.removeItem("party-host-room"); } catch (err) {}
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
        g.id === "slip-up" || g.id === "avalon" ? "Continue to Setup" : "Continue to Round 1";
      updateStartButton();
    });
    container.appendChild(card);
  });
}

function updateStartButton() {
  const btn = document.getElementById("btn-start-game");
  const playerCount = document.querySelectorAll("#player-list li").length;
  const selectedGame = gamesById[selectedGameId];
  btn.disabled = !(selectedGame && playerCount >= selectedGame.minPlayers && playerCount <= selectedGame.maxPlayers);
}

document.getElementById("btn-start-game").addEventListener("click", () => {
  document.getElementById("lobby-error").textContent = "";
  if (selectedGameId === "slip-up") {
    enterSlipUpSetup();
  } else if (selectedGameId === "word-wolf") {
    enterWordSelect();
  } else if (selectedGameId === "avalon") {
    enterAvalonSetup();
  } else {
    enterTrackSelect();
  }
});

socket.on("host:error", ({ error }) => {
  document.getElementById("lobby-error").textContent = error;
  document.getElementById("track-select-error").textContent = error;
  document.getElementById("slipup-setup-error").textContent = error;
  document.getElementById("slipup-referee-error").textContent = error;
  document.getElementById("word-select-error").textContent = error;
  document.getElementById("avalon-setup-error").textContent = error;
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
  applyYoutubeAvailability();
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

// ---- Word Wolf: word-source selection ----
function enterWordSelect() {
  document.getElementById("word-active-count").textContent = activePlayerCount;
  document.getElementById("word-round-title").textContent = `Round ${lastKnownRound + 1}`;
  document.getElementById("word-select-error").textContent = "";
  document.getElementById("custom-normal-word").value = "";
  document.getElementById("custom-imposter-word").value = "";
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelector('.tab-btn[data-tab="auto"]').classList.add("active");
  document.getElementById("tab-auto").classList.add("active");
  showScreen("wordSelect");
}

socket.on("game:word-select-ready", () => {
  enterWordSelect();
});

document.getElementById("btn-select-auto-pair").addEventListener("click", () => {
  document.getElementById("word-select-error").textContent = "";
  socket.emit("host:select-auto-pair", { code: roomCode });
});

document.getElementById("btn-select-custom-pair").addEventListener("click", () => {
  document.getElementById("word-select-error").textContent = "";
  const normalWord = document.getElementById("custom-normal-word").value.trim();
  const imposterWord = document.getElementById("custom-imposter-word").value.trim();
  socket.emit("host:select-custom-pair", { code: roomCode, normalWord, imposterWord });
});

document.getElementById("btn-reveal-words").addEventListener("click", () => {
  socket.emit("host:reveal-words", { code: roomCode });
  document.getElementById("word-round-status").textContent = "Words revealed — players are discussing and voting.";
  document.getElementById("btn-reveal-words").style.display = "none";
});

// ---- Round start / playback ----
socket.on("game:started", ({ round, playerCount }) => {
  hasStartedFirstRound = true;
  lastKnownRound = round;

  if (selectedGameId === "word-wolf") {
    document.getElementById("word-round-title-active").textContent = `Round ${round} — Word Wolf`;
    document.getElementById("word-round-status").textContent = `${playerCount} players in this round. Ready when you are.`;
    document.getElementById("btn-reveal-words").style.display = "block";
    showScreen("wordRound");
    return;
  }

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
  if (selectedGameId === "word-wolf") {
    document.getElementById("word-round-status").textContent = `${voted} / ${total} players voted`;
    return;
  }
  document.getElementById("progress-text").textContent = `${voted} / ${total} players voted`;
  document.getElementById("progress-fill").style.width = `${(voted / total) * 100}%`;
});

// ---- Round results ----
socket.on("game:round-results", ({ round, eliminated, wasImposter, remainingActive }) => {
  activePlayerCount = remainingActive;
  document.getElementById("round-results-title").textContent = `Round ${round} Results`;
  const role = roleLabel();
  const text = eliminated
    ? `${eliminated.nickname} was voted out — they were ${wasImposter ? "" : "NOT "}the ${role}. ${remainingActive} players remain.`
    : `No one was eliminated this round. ${remainingActive} players remain.`;
  document.getElementById("round-elimination-text").textContent = text;
  showScreen("roundResults");
});

document.getElementById("btn-next-round").addEventListener("click", () => {
  socket.emit("host:next-round", { code: roomCode });
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
    const status = r.eliminated ? "eliminated" : "survived";
    li.innerHTML = `<span>${r.nickname}${r.wasImposter ? ` ${emoji}` : ""}</span><span>${status}</span>`;
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

function enterAvalonSetup() {
  document.getElementById("avalon-setup-error").textContent = "";
  document.getElementById("avalon-player-count").textContent =
    document.querySelectorAll("#player-list li").length;
  showScreen("avalonSetup");
}

document.getElementById("btn-avalon-start").addEventListener("click", () => {
  document.getElementById("avalon-setup-error").textContent = "";
  socket.emit("host:avalon-start", { code: roomCode });
});

document.getElementById("btn-avalon-begin").addEventListener("click", () => {
  socket.emit("host:avalon-begin", { code: roomCode });
});

document.getElementById("btn-avalon-next-quest").addEventListener("click", () => {
  socket.emit("host:next-round", { code: roomCode });
});

const AVALON_PHASE_LABEL = {
  "team-proposal": (s) => `Waiting for ${s.leaderNickname} to propose a team of ${s.teamSize}.`,
  "team-vote": (s) => `${s.currentTeam.map((p) => p.nickname).join(", ")} — team is being voted on.`,
  quest: (s) => `${s.currentTeam.map((p) => p.nickname).join(", ")} are on a secret mission…`,
  "quest-result": () => "Quest resolved.",
  assassin: () => "The Assassin is deciding Merlin's fate…",
};

function renderQuestTrack(questResults) {
  return questResults.map((r) => (r === "success" ? "✓" : "✗")).join(" ") || "no quests completed yet";
}

socket.on("game:avalon-state", (state) => {
  if (state.phase === "role-reveal") {
    showScreen("avalonRoleReveal");
    return;
  }
  if (state.phase === "game-over") return; // handled by Task 13's game:avalon-results listener

  document.getElementById("avalon-progress-title").textContent = `Avalon — Quest ${state.questIndex + 1}`;
  // Skip updating progress-status during quest-result phase; game:avalon-quest-result
  // listener already set the more informative "Quest succeeded!/failed!" text
  if (state.phase !== "quest-result") {
    const label = AVALON_PHASE_LABEL[state.phase];
    document.getElementById("avalon-progress-status").textContent = label ? label(state) : "";
  }
  document.getElementById("avalon-quest-track").textContent =
    `Quests so far: ${renderQuestTrack(state.questResults)}`;
  document.getElementById("btn-avalon-next-quest").style.display =
    state.phase === "quest-result" ? "block" : "none";
  // Clear stale vote breakdown when phase changes away from team-vote
  if (state.phase !== "team-vote") {
    document.getElementById("avalon-vote-breakdown").innerHTML = "";
  }
  showScreen("avalonProgress");
});

socket.on("game:avalon-team-vote-result", ({ approved, votes }) => {
  const list = document.getElementById("avalon-vote-breakdown");
  list.innerHTML = "";
  votes.forEach((v) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${v.nickname}</span><span>${v.approve ? "✅ approve" : "❌ reject"}</span>`;
    list.appendChild(li);
  });
  document.getElementById("avalon-progress-status").textContent =
    approved ? "Team approved!" : "Team rejected — next leader is up.";
});

socket.on("game:avalon-quest-result", ({ outcome }) => {
  document.getElementById("avalon-progress-status").textContent =
    outcome === "success" ? "Quest succeeded! ✓" : "Quest failed! ✗";
});

document.getElementById("btn-avalon-play-again").addEventListener("click", () => {
  socket.emit("host:reset-room", { code: roomCode });
});

socket.on("game:avalon-results", ({ winner, roles }) => {
  const winnerText =
    winner === null
      ? "⚠️ Game interrupted — a player disconnected."
      : winner === "good"
        ? "🛡️ Good wins! The quests were completed."
        : "🗡️ Evil wins!";
  document.getElementById("avalon-winner-text").textContent = winnerText;

  const list = document.getElementById("avalon-role-list");
  list.innerHTML = "";
  roles.forEach((r) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${r.nickname}</span><span>${r.role} (${r.team})</span>`;
    list.appendChild(li);
  });
  showScreen("avalonResults");
});

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

// ---- Punishment Wheel (room-level, independent of any game) ----
let wheelItems = [];
let wheelSpinning = false;

const wheelPanel = document.getElementById("wheel-panel");
const wheelCanvas = document.getElementById("wheel-canvas");
const wheelCtx = wheelCanvas.getContext("2d");
const wheelColors = ["#ff5fa2", "#7c5cff", "#4ade80", "#facc15", "#38bdf8", "#f97316"];

document.getElementById("btn-wheel-toggle").addEventListener("click", () => {
  wheelPanel.classList.toggle("hidden");
});
document.getElementById("btn-wheel-close").addEventListener("click", () => {
  wheelPanel.classList.add("hidden");
});

document.getElementById("btn-wheel-add").addEventListener("click", () => {
  const input = document.getElementById("wheel-add-input");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("wheel:add-punishment", { code: roomCode, text });
  input.value = "";
});

document.getElementById("wheel-item-list").addEventListener("click", (e) => {
  if (!e.target.matches("[data-remove-id]")) return;
  socket.emit("wheel:remove-punishment", { code: roomCode, id: e.target.dataset.removeId });
});

document.getElementById("btn-wheel-spin").addEventListener("click", () => {
  if (wheelSpinning || wheelItems.length === 0) return;
  spinWheel();
});

socket.on("wheel:list-updated", ({ items }) => {
  wheelItems = items;
  renderWheelList();
  if (!wheelSpinning) drawWheel(0);
});

socket.on("wheel:add-error", ({ error }) => {
  alert(error);
});

function renderWheelList() {
  const list = document.getElementById("wheel-item-list");
  list.innerHTML = "";
  wheelItems.forEach((item) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = item.nickname ? `${item.text} (${item.nickname})` : item.text;
    const removeBtn = document.createElement("button");
    removeBtn.textContent = "×";
    removeBtn.dataset.removeId = item.id;
    li.appendChild(label);
    li.appendChild(removeBtn);
    list.appendChild(li);
  });
}

function drawWheel(rotation) {
  const size = wheelCanvas.width;
  const center = size / 2;
  const radius = center - 4;
  wheelCtx.clearRect(0, 0, size, size);
  if (wheelItems.length === 0) return;

  const sliceAngle = (2 * Math.PI) / wheelItems.length;
  wheelCtx.save();
  wheelCtx.translate(center, center);
  wheelCtx.rotate(rotation);
  wheelItems.forEach((item, i) => {
    const start = i * sliceAngle;
    const end = start + sliceAngle;
    wheelCtx.beginPath();
    wheelCtx.moveTo(0, 0);
    wheelCtx.arc(0, 0, radius, start, end);
    wheelCtx.closePath();
    wheelCtx.fillStyle = wheelColors[i % wheelColors.length];
    wheelCtx.fill();

    wheelCtx.save();
    wheelCtx.rotate(start + sliceAngle / 2);
    wheelCtx.textAlign = "right";
    wheelCtx.fillStyle = "#16121f";
    wheelCtx.font = "11px sans-serif";
    const label = item.text.length > 18 ? item.text.slice(0, 17) + "…" : item.text;
    wheelCtx.fillText(label, radius - 6, 4);
    wheelCtx.restore();
  });
  wheelCtx.restore();
}

function spinWheel() {
  wheelSpinning = true;
  document.getElementById("btn-wheel-spin").disabled = true;
  document.getElementById("wheel-result").textContent = "";

  const winnerIndex = Math.floor(Math.random() * wheelItems.length);
  const sliceAngle = (2 * Math.PI) / wheelItems.length;
  // Canvas angle 0 is at 3 o'clock, increasing clockwise. The pointer is
  // fixed visually at the top (12 o'clock == angle -PI/2). Land the winning
  // slice's center under the pointer, plus a few full spins for effect.
  const targetSliceCenter = winnerIndex * sliceAngle + sliceAngle / 2;
  const extraSpins = 4 * 2 * Math.PI;
  const finalRotation = extraSpins + (-Math.PI / 2 - targetSliceCenter);

  const durationMs = 3000;
  const startTime = performance.now();

  function animate(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / durationMs, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    drawWheel(finalRotation * eased);
    if (t < 1) {
      requestAnimationFrame(animate);
    } else {
      wheelSpinning = false;
      document.getElementById("btn-wheel-spin").disabled = false;
      document.getElementById("wheel-result").textContent = wheelItems[winnerIndex].text;
    }
  }
  requestAnimationFrame(animate);
}

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
  game: document.getElementById("screen-game"),
  wordSelect: document.getElementById("screen-word-select"),
  wordRound: document.getElementById("screen-word-round"),
  roundResults: document.getElementById("screen-round-results"),
  results: document.getElementById("screen-results"),
  wwtPromptSelect: document.getElementById("screen-wwt-prompt-select"),
  wwtAnswering: document.getElementById("screen-wwt-answering"),
  wwtGuessing: document.getElementById("screen-wwt-guessing"),
  wwtReveal: document.getElementById("screen-wwt-reveal"),
  wwtRoundResults: document.getElementById("screen-wwt-round-results"),
  wwtResults: document.getElementById("screen-wwt-results"),
  xpPromptSelect: document.getElementById("screen-xp-prompt-select"),
  xpAnswering: document.getElementById("screen-xp-answering"),
  xpReveal: document.getElementById("screen-xp-reveal"),
  xpResults: document.getElementById("screen-xp-results"),
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
  if (selectedGameId === "word-wolf") {
    enterWordSelect();
  } else if (selectedGameId === "who-wrote-that") {
    enterWwtPromptSelect();
  } else if (selectedGameId === "x-people") {
    enterXpPromptSelect();
  } else {
    enterTrackSelect();
  }
});

socket.on("host:error", ({ error }) => {
  document.getElementById("lobby-error").textContent = error;
  document.getElementById("track-select-error").textContent = error;
  document.getElementById("word-select-error").textContent = error;
  document.getElementById("wwt-prompt-select-error").textContent = error;
  document.getElementById("xp-prompt-select-error").textContent = error;
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

// ---- Who Wrote That?: prompt-select, answering, guessing, reveal, scores ----
let wwtSpice = 2;
let wwtLastRound = 0;

function enterWwtPromptSelect() {
  document.getElementById("wwt-round-title").textContent = `Round ${wwtLastRound + 1}`;
  document.getElementById("wwt-prompt-select-error").textContent = "";
  document.getElementById("wwt-custom-prompt").value = "";
  document.getElementById("wwt-ai-topic").value = "";
  document.getElementById("wwt-ai-batch").innerHTML = "";
  document.getElementById("btn-approve-prompts").style.display = "none";
  document.querySelectorAll('.tab-btn[data-tab^="wwt-"]').forEach((b) => b.classList.remove("active"));
  document.querySelectorAll('.tab-panel[id^="tab-wwt-"]').forEach((p) => p.classList.remove("active"));
  document.querySelector('.tab-btn[data-tab="wwt-draw"]').classList.add("active");
  document.getElementById("tab-wwt-draw").classList.add("active");
  showScreen("wwtPromptSelect");
}

socket.on("game:prompt-select-ready", () => {
  if (selectedGameId === "x-people") enterXpPromptSelect();
  else enterWwtPromptSelect();
});

socket.on("game:prompt-sources", ({ aiAvailable }) => {
  document.getElementById("wwt-ai-unavailable").style.display = aiAvailable ? "none" : "block";
  document.getElementById("wwt-ai-controls").style.display = aiAvailable ? "block" : "none";
  document.getElementById("xp-ai-unavailable").style.display = aiAvailable ? "none" : "block";
  document.getElementById("xp-ai-controls").style.display = aiAvailable ? "block" : "none";
});

document.querySelectorAll(".spice-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".spice-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const spice = Number(btn.dataset.spice);
    wwtSpice = spice;
    xpSpice = spice;
    socket.emit("host:set-spice", { code: roomCode, spice });
  });
});

document.getElementById("btn-draw-prompt").addEventListener("click", () => {
  document.getElementById("wwt-prompt-select-error").textContent = "";
  socket.emit("host:draw-prompt", { code: roomCode });
});

document.getElementById("btn-custom-prompt").addEventListener("click", () => {
  document.getElementById("wwt-prompt-select-error").textContent = "";
  const text = document.getElementById("wwt-custom-prompt").value.trim();
  socket.emit("host:custom-prompt", { code: roomCode, text });
});

document.getElementById("btn-generate-prompts").addEventListener("click", () => {
  document.getElementById("wwt-prompt-select-error").textContent = "";
  const topic = document.getElementById("wwt-ai-topic").value.trim();
  socket.emit("host:generate-prompts", { code: roomCode, topic, spice: wwtSpice, count: 10 });
});

socket.on("game:generated-prompts", ({ prompts }) => {
  const container = document.getElementById("wwt-ai-batch");
  container.innerHTML = "";
  prompts.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "ai-batch-row";
    row.innerHTML = `<input type="checkbox" id="ai-prompt-${i}" checked /><span>${p.text}</span>`;
    container.appendChild(row);
  });
  document.getElementById("btn-approve-prompts").style.display = prompts.length ? "block" : "none";
  document.getElementById("btn-approve-prompts").dataset.prompts = JSON.stringify(prompts);
});

document.getElementById("btn-approve-prompts").addEventListener("click", () => {
  const btn = document.getElementById("btn-approve-prompts");
  const prompts = JSON.parse(btn.dataset.prompts || "[]");
  const approved = prompts.filter((p, i) => document.getElementById(`ai-prompt-${i}`).checked);
  socket.emit("host:approve-prompts", { code: roomCode, prompts: approved });
  document.getElementById("wwt-ai-batch").innerHTML = "";
  btn.style.display = "none";
});

socket.on("game:submission-count", ({ count }) => {
  document.getElementById("wwt-submission-count").textContent = count;
  document.getElementById("xp-submission-count").textContent = count;
});

socket.on("game:prompt", ({ round, text }) => {
  if (selectedGameId === "x-people") {
    xpLastRound = round;
    document.getElementById("xp-answering-title").textContent = `Round ${round} — X People In This Room`;
    document.getElementById("xp-answering-prompt").textContent = text;
    document.getElementById("xp-answer-progress-text").textContent = "0 / 0 players answered";
    showScreen("xpAnswering");
    return;
  }
  if (selectedGameId !== "who-wrote-that") return;
  wwtLastRound = round;
  document.getElementById("wwt-answering-title").textContent = `Round ${round} — Who Wrote That?`;
  document.getElementById("wwt-answering-prompt").textContent = text;
  showScreen("wwtAnswering");
});

socket.on("game:answer-progress", ({ answered, total }) => {
  if (selectedGameId === "x-people") {
    document.getElementById("xp-answer-progress-text").textContent = `${answered} / ${total} players answered`;
    return;
  }
  document.getElementById("wwt-answer-progress-text").textContent = `${answered} / ${total} players answered`;
});

document.getElementById("btn-force-answers").addEventListener("click", () => {
  socket.emit("host:force-answers", { code: roomCode });
});

socket.on("game:show-answer", ({ answerNumber, totalAnswers, text }) => {
  document.getElementById("wwt-answer-counter").textContent = `Answer ${answerNumber} of ${totalAnswers}`;
  document.getElementById("wwt-current-answer").textContent = text;
  document.getElementById("wwt-vote-progress-text").textContent = "0 votes in";
  showScreen("wwtGuessing");
});

socket.on("game:answer-reveal", ({ authorNickname, text, correctGuessers, fooledCount, authorBonus, voided }) => {
  document.getElementById("wwt-reveal-text").textContent = text;
  if (voided) {
    document.getElementById("wwt-reveal-detail").textContent = `${authorNickname} disconnected — this answer is voided, no points awarded.`;
  } else {
    const guesserNames = correctGuessers.map((g) => g.nickname).join(", ") || "nobody";
    document.getElementById("wwt-reveal-detail").textContent =
      `Written by ${authorNickname}. Correctly guessed by: ${guesserNames}. Fooled ${fooledCount} — +${authorBonus} bonus.`;
  }
  showScreen("wwtReveal");
});

document.getElementById("btn-next-answer").addEventListener("click", () => {
  socket.emit("host:next-answer", { code: roomCode });
});

function renderWwtScoreboard(listEl, scores) {
  listEl.innerHTML = "";
  scores.forEach((s) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${s.nickname}</span><span>${s.score}</span>`;
    listEl.appendChild(li);
  });
}

document.getElementById("btn-wwt-next-round").addEventListener("click", () => {
  socket.emit("host:next-round", { code: roomCode });
});

document.getElementById("btn-wwt-end-game").addEventListener("click", () => {
  socket.emit("host:end-game", { code: roomCode });
});

document.getElementById("btn-wwt-play-again").addEventListener("click", () => {
  selectedGameId = null;
  socket.emit("host:reset-room", { code: roomCode });
});

// ---- X People In This Room: prompt-select, answering, count reveal, scores ----
let xpSpice = 2;
let xpLastRound = 0;

function enterXpPromptSelect() {
  document.getElementById("xp-round-title").textContent = `Round ${xpLastRound + 1}`;
  document.getElementById("xp-prompt-select-error").textContent = "";
  document.getElementById("xp-custom-prompt").value = "";
  document.getElementById("xp-ai-topic").value = "";
  document.getElementById("xp-ai-batch").innerHTML = "";
  document.getElementById("btn-xp-approve-prompts").style.display = "none";
  document.querySelectorAll('.tab-btn[data-tab^="xp-"]').forEach((b) => b.classList.remove("active"));
  document.querySelectorAll('.tab-panel[id^="tab-xp-"]').forEach((p) => p.classList.remove("active"));
  document.querySelector('.tab-btn[data-tab="xp-draw"]').classList.add("active");
  document.getElementById("tab-xp-draw").classList.add("active");
  showScreen("xpPromptSelect");
}

document.getElementById("btn-xp-draw-prompt").addEventListener("click", () => {
  document.getElementById("xp-prompt-select-error").textContent = "";
  socket.emit("host:draw-prompt", { code: roomCode });
});

document.getElementById("btn-xp-custom-prompt").addEventListener("click", () => {
  document.getElementById("xp-prompt-select-error").textContent = "";
  const text = document.getElementById("xp-custom-prompt").value.trim();
  socket.emit("host:custom-prompt", { code: roomCode, text });
});

document.getElementById("btn-xp-generate-prompts").addEventListener("click", () => {
  document.getElementById("xp-prompt-select-error").textContent = "";
  const topic = document.getElementById("xp-ai-topic").value.trim();
  socket.emit("host:generate-prompts", { code: roomCode, topic, spice: xpSpice, count: 10 });
});

socket.on("game:generated-prompts", ({ prompts }) => {
  if (selectedGameId !== "x-people") return;
  const container = document.getElementById("xp-ai-batch");
  container.innerHTML = "";
  prompts.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "ai-batch-row";
    row.innerHTML = `<input type="checkbox" id="xp-ai-prompt-${i}" checked /><span>${p.text}</span>`;
    container.appendChild(row);
  });
  document.getElementById("btn-xp-approve-prompts").style.display = prompts.length ? "block" : "none";
  document.getElementById("btn-xp-approve-prompts").dataset.prompts = JSON.stringify(prompts);
});

document.getElementById("btn-xp-approve-prompts").addEventListener("click", () => {
  const btn = document.getElementById("btn-xp-approve-prompts");
  const prompts = JSON.parse(btn.dataset.prompts || "[]");
  const approved = prompts.filter((p, i) => document.getElementById(`xp-ai-prompt-${i}`).checked);
  socket.emit("host:approve-prompts", { code: roomCode, prompts: approved });
  document.getElementById("xp-ai-batch").innerHTML = "";
  btn.style.display = "none";
});

document.getElementById("btn-xp-force-answers").addEventListener("click", () => {
  socket.emit("host:force-answers", { code: roomCode });
});

function renderXpScoreboard(listEl, scores) {
  listEl.innerHTML = "";
  scores.forEach((s) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${s.nickname}</span><span>${s.score}</span>`;
    listEl.appendChild(li);
  });
}

socket.on("game:count-reveal", ({ round, yesCount, playerCount, results, scores }) => {
  document.getElementById("xp-reveal-title").textContent = `Round ${round} Reveal`;
  document.getElementById("xp-count-display").textContent = yesCount;
  document.getElementById("xp-reveal-subtitle").textContent = `out of ${playerCount} players said yes`;

  const predictionList = document.getElementById("xp-prediction-results");
  predictionList.innerHTML = "";
  results.forEach((r) => {
    const li = document.createElement("li");
    li.innerHTML = `<span>${r.nickname} guessed ${r.prediction}</span><span>+${r.points}</span>`;
    predictionList.appendChild(li);
  });

  renderXpScoreboard(document.getElementById("xp-scoreboard"), scores);
  showScreen("xpReveal");
});

document.getElementById("btn-xp-next-round").addEventListener("click", () => {
  socket.emit("host:next-round", { code: roomCode });
});

document.getElementById("btn-xp-end-game").addEventListener("click", () => {
  socket.emit("host:end-game", { code: roomCode });
});

document.getElementById("btn-xp-play-again").addEventListener("click", () => {
  selectedGameId = null;
  socket.emit("host:reset-room", { code: roomCode });
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
  if (selectedGameId === "who-wrote-that") {
    document.getElementById("wwt-vote-progress-text").textContent = `${voted} / ${total} players voted`;
    return;
  }
  if (selectedGameId === "word-wolf") {
    document.getElementById("word-round-status").textContent = `${voted} / ${total} players voted`;
    return;
  }
  document.getElementById("progress-text").textContent = `${voted} / ${total} players voted`;
  document.getElementById("progress-fill").style.width = `${(voted / total) * 100}%`;
});

// ---- Round results ----
socket.on("game:round-results", (payload) => {
  if (selectedGameId === "who-wrote-that") {
    renderWwtScoreboard(document.getElementById("wwt-round-scoreboard"), payload.scores);
    showScreen("wwtRoundResults");
    return;
  }
  const { round, eliminated, wasImposter, remainingActive } = payload;
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
socket.on("game:results", (payload) => {
  if (selectedGameId === "x-people") {
    const { winners, scores } = payload;
    const winnerNames = winners.map((w) => w.nickname).join(", ");
    document.getElementById("xp-winner-text").textContent =
      winners.length > 1 ? `🏆 It's a tie: ${winnerNames}!` : `🏆 ${winnerNames} wins!`;
    renderXpScoreboard(document.getElementById("xp-final-scoreboard"), scores);
    showScreen("xpResults");
    return;
  }
  if (selectedGameId === "who-wrote-that") {
    const { winners, scores } = payload;
    const winnerNames = winners.map((w) => w.nickname).join(", ");
    document.getElementById("wwt-winner-text").textContent =
      winners.length > 1 ? `🏆 It's a tie: ${winnerNames}!` : `🏆 ${winnerNames} wins!`;
    renderWwtScoreboard(document.getElementById("wwt-final-scoreboard"), scores);
    showScreen("wwtResults");
    return;
  }

  const { imposter, winner, results } = payload;
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
  wwtLastRound = 0;
  wwtSpice = 2;
  xpLastRound = 0;
  xpSpice = 2;
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

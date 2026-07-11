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

const screens = {
  join: document.getElementById("screen-join"),
  waiting: document.getElementById("screen-waiting"),
  audioReady: document.getElementById("screen-audio-ready"),
  wordReveal: document.getElementById("screen-word-reveal"),
  playing: document.getElementById("screen-playing"),
  roundResults: document.getElementById("screen-round-results"),
  spectator: document.getElementById("screen-spectator"),
  results: document.getElementById("screen-results"),
  wwtAnswering: document.getElementById("screen-wwt-answering"),
  wwtGuessing: document.getElementById("screen-wwt-guessing"),
  wwtReveal: document.getElementById("screen-wwt-reveal"),
  wwtRoundResults: document.getElementById("screen-wwt-round-results"),
  wwtResults: document.getElementById("screen-wwt-results"),
  xpAnswering: document.getElementById("screen-xp-answering"),
  xpReveal: document.getElementById("screen-xp-reveal"),
  xpResults: document.getElementById("screen-xp-results"),
};

// Only Word Wolf uses "wolf" wording in the shared round-results/final-
// results screens; every other game (today, just Find the Imposter) keeps
// the original "imposter" wording unchanged.
function roleLabel() {
  return currentGameId === "word-wolf" ? "wolf" : "imposter";
}

socket.on("room:game-selected", ({ gameId }) => {
  currentGameId = gameId;
  const usesPromptPipeline = gameId === "who-wrote-that" || gameId === "x-people";
  document.getElementById("wwt-submit-widget").style.display = usesPromptPipeline ? "block" : "none";
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

document.getElementById("btn-start-voting").addEventListener("click", () => {
  selectedVoteTarget = null;
  renderVoteOptions(currentPlayers);
  showScreen("playing");
  document.getElementById("vote-status").textContent = "";
});

// ---- Who Wrote That?: persistent prompt-submission widget ----
document.getElementById("btn-toggle-submit-prompt").addEventListener("click", () => {
  const panel = document.getElementById("wwt-submit-panel");
  panel.style.display = panel.style.display === "block" ? "none" : "block";
});

document.getElementById("btn-submit-prompt").addEventListener("click", () => {
  const input = document.getElementById("wwt-submit-input");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("player:submit-prompt", { code: roomCode, text });
});

socket.on("player:prompt-accepted", () => {
  document.getElementById("wwt-submit-input").value = "";
  document.getElementById("wwt-submit-status").textContent = "Sent! It'll show up in a future round.";
});

socket.on("player:prompt-rejected", ({ error }) => {
  document.getElementById("wwt-submit-status").textContent = error;
});

// ---- Who Wrote That?: answering ----
let wwtAnswerSubmitted = false;

socket.on("game:prompt", ({ text }) => {
  if (currentGameId !== "who-wrote-that") return;
  wwtAnswerSubmitted = false;
  document.getElementById("wwt-prompt-text").textContent = text;
  document.getElementById("wwt-answer-input").value = "";
  document.getElementById("wwt-answer-input").disabled = false;
  document.getElementById("btn-submit-answer").disabled = false;
  document.getElementById("wwt-answer-status").textContent = "";
  showScreen("wwtAnswering");
});

document.getElementById("btn-submit-answer").addEventListener("click", () => {
  const text = document.getElementById("wwt-answer-input").value.trim();
  if (!text) return;
  socket.emit("player:submit-answer", { code: roomCode, text });
  wwtAnswerSubmitted = true;
  document.getElementById("wwt-answer-status").textContent = "Answer submitted — you can still edit it until everyone's in.";
});

socket.on("player:answer-rejected", ({ error }) => {
  document.getElementById("wwt-answer-status").textContent = error;
});

// ---- Who Wrote That?: guessing ----
let wwtSelectedVote = null;

socket.on("game:show-answer", ({ text }) => {
  wwtSelectedVote = null;
  document.getElementById("wwt-shown-answer").textContent = text;
  document.getElementById("wwt-vote-status").textContent = "";
  document.getElementById("btn-wwt-confirm-vote").disabled = true;
  renderWwtVoteOptions();
  showScreen("wwtGuessing");
});

function renderWwtVoteOptions() {
  const container = document.getElementById("wwt-vote-list");
  container.innerHTML = "";
  const candidates = currentPlayers.filter((p) => p.id !== myId);
  candidates.forEach((p) => {
    const btn = document.createElement("button");
    btn.className = "vote-btn";
    btn.textContent = p.nickname;
    btn.addEventListener("click", () => {
      wwtSelectedVote = p.id;
      document.querySelectorAll("#wwt-vote-list .vote-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      document.getElementById("btn-wwt-confirm-vote").disabled = false;
    });
    container.appendChild(btn);
  });
}

document.getElementById("btn-wwt-confirm-vote").addEventListener("click", () => {
  if (!wwtSelectedVote) return;
  socket.emit("player:vote-author", { code: roomCode, votedForId: wwtSelectedVote });
  document.querySelectorAll("#wwt-vote-list .vote-btn").forEach((b) => (b.disabled = true));
  document.getElementById("btn-wwt-confirm-vote").disabled = true;
  document.getElementById("wwt-vote-status").textContent = "Guess submitted — waiting for others…";
});

// ---- Who Wrote That?: reveal, round results, final results ----
socket.on("game:answer-reveal", ({ authorNickname, text, correctGuessers, fooledCount, authorBonus, voided }) => {
  document.getElementById("wwt-reveal-text").textContent = text;
  if (voided) {
    document.getElementById("wwt-reveal-detail").textContent = `${authorNickname} disconnected — voided, no points.`;
  } else {
    const guesserNames = correctGuessers.map((g) => g.nickname).join(", ") || "nobody";
    document.getElementById("wwt-reveal-detail").textContent =
      `Written by ${authorNickname}. Correctly guessed by: ${guesserNames}. Fooled ${fooledCount} — +${authorBonus} bonus.`;
  }
  showScreen("wwtReveal");
});

// ---- X People In This Room: yes/no + prediction, count reveal, scores ----
let xpAnswer = null;
let xpPrediction = 0;
let xpMaxPrediction = 0;

socket.on("game:prompt", ({ text, playerCount }) => {
  if (currentGameId !== "x-people") return;
  xpAnswer = null;
  xpPrediction = 0;
  xpMaxPrediction = playerCount;
  document.getElementById("xp-prompt-text").textContent = text;
  document.getElementById("xp-player-count").textContent = playerCount;
  document.getElementById("xp-prediction-value").textContent = "0";
  document.getElementById("xp-answer-status").textContent = "";
  document.getElementById("btn-xp-submit").disabled = true;
  document.querySelectorAll(".yesno-btn").forEach((b) => {
    b.classList.remove("selected");
    b.disabled = false;
  });
  showScreen("xpAnswering");
});

function updateXpSubmitEnabled() {
  document.getElementById("btn-xp-submit").disabled = xpAnswer === null;
}

document.getElementById("btn-xp-yes").addEventListener("click", () => {
  xpAnswer = true;
  document.getElementById("btn-xp-yes").classList.add("selected");
  document.getElementById("btn-xp-no").classList.remove("selected");
  updateXpSubmitEnabled();
});

document.getElementById("btn-xp-no").addEventListener("click", () => {
  xpAnswer = false;
  document.getElementById("btn-xp-no").classList.add("selected");
  document.getElementById("btn-xp-yes").classList.remove("selected");
  updateXpSubmitEnabled();
});

document.getElementById("btn-xp-dec").addEventListener("click", () => {
  xpPrediction = Math.max(0, xpPrediction - 1);
  document.getElementById("xp-prediction-value").textContent = xpPrediction;
});

document.getElementById("btn-xp-inc").addEventListener("click", () => {
  xpPrediction = Math.min(xpMaxPrediction, xpPrediction + 1);
  document.getElementById("xp-prediction-value").textContent = xpPrediction;
});

document.getElementById("btn-xp-submit").addEventListener("click", () => {
  if (xpAnswer === null) return;
  socket.emit("player:submit-response", { code: roomCode, answer: xpAnswer, prediction: xpPrediction });
  document.querySelectorAll(".yesno-btn").forEach((b) => (b.disabled = true));
  document.getElementById("btn-xp-dec").disabled = true;
  document.getElementById("btn-xp-inc").disabled = true;
  document.getElementById("btn-xp-submit").disabled = true;
  document.getElementById("xp-answer-status").textContent = "Submitted — waiting for others…";
});

socket.on("game:count-reveal", ({ yesCount, playerCount, results }) => {
  if (currentGameId !== "x-people") return;
  document.getElementById("xp-count-display").textContent = yesCount;
  document.getElementById("xp-reveal-subtitle").textContent = `out of ${playerCount} players said yes`;
  const mine = results.find((r) => r.id === myId);
  document.getElementById("xp-my-result").textContent = mine
    ? `You guessed ${mine.prediction} — +${mine.points} points`
    : "";
  showScreen("xpReveal");
});

function renderWwtScoreboardPlayer(listEl, scores) {
  listEl.innerHTML = "";
  scores.forEach((s) => {
    const li = document.createElement("li");
    const youTag = s.id === myId ? " (you)" : "";
    li.innerHTML = `<span>${s.nickname}${youTag}</span><span>${s.score}</span>`;
    listEl.appendChild(li);
  });
}

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
  if (currentGameId === "who-wrote-that") {
    document.getElementById("wwt-vote-status").textContent = reason || "That guess couldn't be submitted — pick again.";
    document.querySelectorAll("#wwt-vote-list .vote-btn").forEach((b) => (b.disabled = false));
    return;
  }
  selectedVoteTarget = null;
  renderVoteOptions(currentPlayers);
  document.getElementById("vote-status").textContent = reason || "That vote couldn't be submitted — pick again.";
});

// ---- Round results ----
socket.on("game:round-results", (payload) => {
  if (currentGameId === "who-wrote-that") {
    renderWwtScoreboardPlayer(document.getElementById("wwt-round-scoreboard"), payload.scores);
    showScreen("wwtRoundResults");
    return;
  }

  const { eliminated, wasImposter, remainingActive } = payload;
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
socket.on("game:results", (payload) => {
  if (currentGameId === "x-people") {
    const { winners, scores } = payload;
    const winnerNames = winners.map((w) => w.nickname).join(", ");
    const youWon = winners.some((w) => w.id === myId);
    document.getElementById("xp-winner-text").textContent =
      winners.length > 1 ? `🏆 It's a tie: ${winnerNames}!` : `🏆 ${winnerNames} wins!${youWon ? " (you!)" : ""}`;
    renderWwtScoreboardPlayer(document.getElementById("xp-final-scoreboard"), scores);
    showScreen("xpResults");
    return;
  }
  if (currentGameId === "who-wrote-that") {
    const { winners, scores } = payload;
    const winnerNames = winners.map((w) => w.nickname).join(", ");
    const youWon = winners.some((w) => w.id === myId);
    document.getElementById("wwt-winner-text").textContent =
      winners.length > 1 ? `🏆 It's a tie: ${winnerNames}!` : `🏆 ${winnerNames} wins!${youWon ? " (you!)" : ""}`;
    renderWwtScoreboardPlayer(document.getElementById("wwt-final-scoreboard"), scores);
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
  document.getElementById("wwt-submit-widget").style.display = "none";
  document.getElementById("wwt-submit-panel").style.display = "none";
  document.getElementById("wwt-submit-status").textContent = "";
  showScreen("waiting");
});

socket.on("room:host-disconnected", () => {
  alert("Host disconnected. The room has closed.");
});

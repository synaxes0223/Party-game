const socket = io();
window.__playerSocket = socket;

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
let avalonSelectedTeam = new Set();

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
  wwtAnswering: document.getElementById("screen-wwt-answering"),
  wwtGuessing: document.getElementById("screen-wwt-guessing"),
  wwtReveal: document.getElementById("screen-wwt-reveal"),
  wwtRoundResults: document.getElementById("screen-wwt-round-results"),
  wwtResults: document.getElementById("screen-wwt-results"),
  xpAnswering: document.getElementById("screen-xp-answering"),
  xpReveal: document.getElementById("screen-xp-reveal"),
  xpResults: document.getElementById("screen-xp-results"),
  ptbTicking: document.getElementById("screen-ptb-ticking"),
  ptbBoom: document.getElementById("screen-ptb-boom"),
  ptbResults: document.getElementById("screen-ptb-results"),
  smMissions: document.getElementById("screen-sm-missions"),
  smResults: document.getElementById("screen-sm-results"),
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
  const usesPromptPipeline = gameId === "who-wrote-that" || gameId === "x-people" || gameId === "pass-the-bomb";
  document.getElementById("wwt-submit-widget").style.display = usesPromptPipeline ? "block" : "none";
});

function showScreen(name) {
  document.querySelectorAll(".screen.active").forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

socket.on("connect", () => {
  myId = window.sessionToken;
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
  socket.emit("player:join-room", { code, nickname, token: window.sessionToken });
}

socket.on("player:join-error", ({ error }) => {
  document.getElementById("join-error").textContent = error;
  // A stale saved session (e.g. the game ended, or this game doesn't support
  // reconnect) shouldn't keep retrying silently -- drop it and let the user
  // join fresh from the visible join screen.
  localStorage.removeItem("partyGameSession");
});

socket.on("player:joined", ({ room }) => {
  roomCode = room.code;
  renderPlayerList(room.players);
  const nicknameInput = document.getElementById("input-nickname").value.trim();
  const savedNickname = JSON.parse(localStorage.getItem("partyGameSession") || "null")?.nickname;
  localStorage.setItem(
    "partyGameSession",
    JSON.stringify({ code: room.code, nickname: nicknameInput || savedNickname || "" })
  );
  showScreen("waiting");
});

// A rejoin lands here instead of player:joined. The room view is the same
// shape, so reuse the same screen transition; the game module re-sends this
// player's private state separately.
socket.on("player:rejoined", ({ room }) => {
  roomCode = room.code;
  renderPlayerList(room.players);
  showScreen("waiting");
});

// ---- Reconnect: silently reclaim a saved session whenever the socket
// (re)connects -- on first load, and after a phone-lock / tab-switch drop.
// The server keys the seat off the persistent token, so re-sending
// player:join-room lands as a player:rejoined and the game module re-sends
// this player's private state. ----
function attemptSavedSessionRejoin() {
  const saved = JSON.parse(localStorage.getItem("partyGameSession") || "null");
  if (!saved || !saved.code || !saved.nickname) return;
  socket.emit("player:join-room", {
    code: saved.code,
    nickname: saved.nickname,
    token: window.sessionToken,
  });
}

socket.on("connect", attemptSavedSessionRejoin);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && roomCode) {
    attemptSavedSessionRejoin();
  }
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

socket.on("game:avalon-state", (state) => {
  // "quest-result" reuses this same screen (per Task 14's routing table)
  // while the host reviews the outcome and clicks Next Quest — show a plain
  // wait message instead of stale leader/picker content from the last
  // team-proposal phase.
  if (state.phase === "quest-result") {
    document.getElementById("avalon-proposal-status").textContent =
      "Quest resolved — waiting for the host to start the next quest…";
    document.getElementById("avalon-team-picker").innerHTML = "";
    document.getElementById("btn-avalon-submit-team").disabled = true;
    return;
  }
  if (state.phase !== "team-proposal") return;
  const amLeader = state.leaderId === myId;
  document.getElementById("avalon-proposal-status").textContent = amLeader
    ? `You're the leader — pick ${state.teamSize} players for the quest.`
    : `Waiting for ${state.leaderNickname} to propose a team of ${state.teamSize}.`;
  document.getElementById("avalon-proposal-error").textContent = "";

  const picker = document.getElementById("avalon-team-picker");
  const submitBtn = document.getElementById("btn-avalon-submit-team");
  picker.innerHTML = "";
  avalonSelectedTeam = new Set();
  submitBtn.disabled = true;

  if (!amLeader) return;

  currentPlayers.forEach((p) => {
    const row = document.createElement("label");
    row.className = "entry-row";
    row.innerHTML = `<input type="checkbox" data-id="${p.id}" /><span>${p.nickname}</span>`;
    const checkbox = row.querySelector("input");
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) avalonSelectedTeam.add(p.id);
      else avalonSelectedTeam.delete(p.id);
      submitBtn.disabled = avalonSelectedTeam.size !== state.teamSize;
    });
    picker.appendChild(row);
  });
});

document.getElementById("btn-avalon-submit-team").addEventListener("click", () => {
  socket.emit("player:avalon-propose-team", {
    code: roomCode,
    teamPlayerIds: Array.from(avalonSelectedTeam),
  });
});

socket.on("game:avalon-propose-rejected", ({ reason }) => {
  document.getElementById("avalon-proposal-error").textContent = reason;
});

socket.on("game:avalon-state", (state) => {
  if (state.phase !== "team-vote") return;
  document.getElementById("avalon-vote-team-text").textContent =
    `Proposed team: ${state.currentTeam.map((p) => p.nickname).join(", ")}`;
  document.getElementById("avalon-team-vote-status").textContent = "";
  document.getElementById("btn-avalon-approve").disabled = false;
  document.getElementById("btn-avalon-reject").disabled = false;
});

function submitAvalonTeamVote(approve) {
  document.getElementById("btn-avalon-approve").disabled = true;
  document.getElementById("btn-avalon-reject").disabled = true;
  document.getElementById("avalon-team-vote-status").textContent = "Vote submitted — waiting for others…";
  socket.emit("player:avalon-team-vote", { code: roomCode, approve });
}

document.getElementById("btn-avalon-approve").addEventListener("click", () => submitAvalonTeamVote(true));
document.getElementById("btn-avalon-reject").addEventListener("click", () => submitAvalonTeamVote(false));

socket.on("game:avalon-team-vote-result", ({ approved, votes }) => {
  const breakdown = votes.map((v) => `${v.nickname}: ${v.approve ? "✅" : "❌"}`).join(" · ");
  document.getElementById("avalon-team-vote-status").textContent =
    `${approved ? "Approved!" : "Rejected."} (${breakdown})`;
});

function isAvalonEvil() {
  return myAvalonRole && ["assassin", "morgana", "minion"].includes(myAvalonRole.role);
}

socket.on("game:avalon-state", (state) => {
  if (state.phase !== "quest") return;
  const onTeam = state.currentTeam.some((p) => p.id === myId);
  document.getElementById("avalon-quest-text").textContent = onTeam
    ? "You're on the quest — submit your vote."
    : `${state.currentTeam.map((p) => p.nickname).join(", ")} are on a secret mission…`;
  document.getElementById("avalon-quest-status").textContent = "";

  document.getElementById("btn-avalon-success").style.display = onTeam ? "inline-block" : "none";
  document.getElementById("btn-avalon-fail").style.display = onTeam && isAvalonEvil() ? "inline-block" : "none";
  document.getElementById("btn-avalon-success").disabled = false;
  document.getElementById("btn-avalon-fail").disabled = false;
});

function submitAvalonQuestVote(success) {
  document.getElementById("btn-avalon-success").disabled = true;
  document.getElementById("btn-avalon-fail").disabled = true;
  document.getElementById("avalon-quest-status").textContent = "Vote submitted — waiting for the rest of the team…";
  socket.emit("player:avalon-quest-vote", { code: roomCode, success });
}

document.getElementById("btn-avalon-success").addEventListener("click", () => submitAvalonQuestVote(true));
document.getElementById("btn-avalon-fail").addEventListener("click", () => submitAvalonQuestVote(false));

socket.on("game:avalon-quest-vote-rejected", ({ reason }) => {
  document.getElementById("btn-avalon-success").disabled = false;
  document.getElementById("btn-avalon-fail").disabled = false;
  document.getElementById("avalon-quest-status").textContent = reason;
});

let avalonAssassinTarget = null;

socket.on("game:avalon-state", (state) => {
  if (state.phase !== "assassin") return;
  const amAssassin = state.assassinId === myId;
  document.getElementById("avalon-assassin-status").textContent = amAssassin
    ? "Pick who you think Merlin is."
    : "The Assassin is deciding Merlin's fate…";

  const picker = document.getElementById("avalon-assassin-picker");
  const confirmBtn = document.getElementById("btn-avalon-confirm-assassin");
  picker.innerHTML = "";
  avalonAssassinTarget = null;
  confirmBtn.disabled = true;
  confirmBtn.style.display = amAssassin ? "inline-block" : "none";

  if (!amAssassin) return;

  currentPlayers
    .filter((p) => p.id !== myId)
    .forEach((p) => {
      const btn = document.createElement("button");
      btn.className = "vote-btn";
      btn.textContent = p.nickname;
      btn.addEventListener("click", () => {
        avalonAssassinTarget = p.id;
        document.querySelectorAll("#avalon-assassin-picker .vote-btn").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        confirmBtn.disabled = false;
      });
      picker.appendChild(btn);
    });
});

document.getElementById("btn-avalon-confirm-assassin").addEventListener("click", () => {
  if (!avalonAssassinTarget) return;
  document.getElementById("btn-avalon-confirm-assassin").disabled = true;
  document.querySelectorAll("#avalon-assassin-picker .vote-btn").forEach((b) => (b.disabled = true));
  socket.emit("player:avalon-assassin-guess", { code: roomCode, targetId: avalonAssassinTarget });
});

socket.on("game:avalon-results", ({ winner, roles }) => {
  const winnerText =
    winner === null
      ? "⚠️ Game interrupted — a player disconnected."
      : winner === "good"
        ? "🛡️ Good wins! The quests were completed."
        : "🗡️ Evil wins!";
  document.getElementById("avalon-results-winner").textContent = winnerText;

  const list = document.getElementById("avalon-results-list");
  list.innerHTML = "";
  roles.forEach((r) => {
    const youTag = r.id === myId ? " (you)" : "";
    const li = document.createElement("li");
    li.innerHTML = `<span>${r.nickname}${youTag}</span><span>${r.role} (${r.team})</span>`;
    list.appendChild(li);
  });
  showScreen("avalonResults");
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

// ---- Pass The Bomb: holder gets the giant PASS button, everyone else waits ----
socket.on("game:bomb-started", ({ category, holderId }) => {
  if (currentGameId !== "pass-the-bomb") return;
  document.getElementById("ptb-category").textContent = category;
  updatePtbHolderUi(holderId);
  showScreen("ptbTicking");
});

socket.on("game:bomb-passed", ({ holderId }) => {
  if (currentGameId !== "pass-the-bomb") return;
  updatePtbHolderUi(holderId);
});

function updatePtbHolderUi(holderId) {
  const iAmHolder = holderId === myId;
  document.getElementById("btn-ptb-pass").style.display = iAmHolder ? "block" : "none";
  document.getElementById("ptb-holder-status").textContent = iAmHolder
    ? "🧨 You have the bomb!"
    : "🧨 Someone else has the bomb";
}

document.getElementById("btn-ptb-pass").addEventListener("click", () => {
  socket.emit("player:pass-bomb", { code: roomCode });
});

socket.on("game:bomb-exploded", ({ holderNickname }) => {
  if (currentGameId !== "pass-the-bomb") return;
  document.getElementById("ptb-boom-text").textContent = `${holderNickname} was holding the bomb!`;
  showScreen("ptbBoom");
});

function renderPtbTallyPlayer(listEl, booms) {
  listEl.innerHTML = "";
  booms
    .slice()
    .sort((a, b) => a.count - b.count)
    .forEach((b) => {
      const li = document.createElement("li");
      const youTag = b.id === myId ? " (you)" : "";
      li.innerHTML = `<span>${b.nickname}${youTag}</span><span>${b.count} 💥</span>`;
      listEl.appendChild(li);
    });
}

// ---- Secret Mission Bingo: your missions, live board, accusations ----
let smLatestBoard = [];

function renderSmMyMissions(missions) {
  const container = document.getElementById("sm-my-missions");
  container.innerHTML = "";
  missions.forEach((m) => {
    const row = document.createElement("div");
    row.className = "sm-mission-card";
    const claimBtn =
      m.status === "open"
        ? `<button class="btn-secondary" data-mission-id="${m.id}">Claim</button>`
        : `<span class="hint">${m.status}</span>`;
    row.innerHTML = `<span class="text">${m.text}</span>${claimBtn}`;
    container.appendChild(row);
  });
  container.querySelectorAll("button[data-mission-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("player:claim-mission", { code: roomCode, missionId: btn.dataset.missionId });
    });
  });
}

socket.on("game:your-missions", ({ missions }) => {
  if (currentGameId !== "secret-missions") return;
  renderSmMyMissions(missions);
  showScreen("smMissions");
});

function renderSmAccuseOptions() {
  const playerSelect = document.getElementById("sm-accuse-player");
  playerSelect.innerHTML = "";
  currentPlayers
    .filter((p) => p.id !== myId)
    .forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.nickname;
      playerSelect.appendChild(opt);
    });

  const missionSelect = document.getElementById("sm-accuse-mission");
  missionSelect.innerHTML = "";
  smLatestBoard
    .filter((m) => m.status !== "busted")
    .forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.text;
      missionSelect.appendChild(opt);
    });
}

socket.on("game:mission-board", ({ missions, accusationsLeft }) => {
  if (currentGameId !== "secret-missions") return;
  smLatestBoard = missions;

  const container = document.getElementById("sm-public-board");
  container.innerHTML = "";
  const icons = { open: "⬜", claimed: "✅", busted: "💥" };
  missions.forEach((m) => {
    const row = document.createElement("div");
    row.className = `sm-board-row status-${m.status}`;
    row.innerHTML = `<span>${icons[m.status] || "⬜"} ${m.text}</span><span class="status">${m.status}</span>`;
    container.appendChild(row);
  });

  renderSmAccuseOptions();

  const mine = (accusationsLeft || []).find((a) => a.id === myId);
  if (mine) document.getElementById("sm-accusations-left").textContent = mine.left;
});

document.getElementById("btn-sm-accuse").addEventListener("click", () => {
  const targetPlayerId = document.getElementById("sm-accuse-player").value;
  const missionId = document.getElementById("sm-accuse-mission").value;
  if (!targetPlayerId || !missionId) return;
  socket.emit("player:accuse", { code: roomCode, targetPlayerId, missionId });
  document.getElementById("sm-accuse-status").textContent = "Accusation submitted…";
});

socket.on("game:accusation-result", ({ accuserNickname, targetNickname, hit }) => {
  if (currentGameId !== "secret-missions") return;
  document.getElementById("sm-accuse-status").textContent = hit
    ? `🎯 ${accuserNickname} correctly busted ${targetNickname}!`
    : `❌ ${accuserNickname} accused ${targetNickname} and missed.`;
});

socket.on("player:mission-action-rejected", ({ error }) => {
  if (currentGameId !== "secret-missions") return;
  document.getElementById("sm-accuse-status").textContent = error;
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
  if (currentGameId === "secret-missions") {
    const { winners, reveal, scores } = payload;
    const winnerNames = winners.map((w) => w.nickname).join(", ");
    const youWon = winners.some((w) => w.id === myId);
    document.getElementById("sm-winner-text").textContent =
      winners.length > 1 ? `🏆 Tied: ${winnerNames}!` : `🏆 ${winnerNames} wins the night!${youWon ? " (you!)" : ""}`;
    const revealList = document.getElementById("sm-reveal-list");
    revealList.innerHTML = "";
    reveal.forEach((m) => {
      const row = document.createElement("div");
      row.className = `sm-board-row status-${m.status}`;
      row.innerHTML = `<span>${m.text}</span><span class="status">${m.ownerNickname} — ${m.status}</span>`;
      revealList.appendChild(row);
    });
    renderWwtScoreboardPlayer(document.getElementById("sm-final-scoreboard"), scores);
    showScreen("smResults");
    return;
  }
  if (currentGameId === "pass-the-bomb") {
    const { winners, booms } = payload;
    const winnerNames = winners.map((w) => w.nickname).join(", ");
    const youWon = winners.some((w) => w.id === myId);
    document.getElementById("ptb-winner-text").textContent =
      winners.length > 1
        ? `🏆 Tied fewest booms: ${winnerNames}!`
        : `🏆 ${winnerNames} had the fewest booms!${youWon ? " (you!)" : ""}`;
    renderPtbTallyPlayer(document.getElementById("ptb-final-tally"), booms);
    showScreen("ptbResults");
    return;
  }
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
  localStorage.removeItem("partyGameSession");
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

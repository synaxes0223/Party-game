// night.js
// The night panel: shows the current step (character or pseudo-step), lets
// the Storyteller pick a candidate for information-reveal steps
// (Washerwoman/Empath/minion-info/demon-info), or submit a target on a
// choice-based character's behalf (Poisoner/Butler/Imp) -- the only way a
// choice resolves until the separate player-UI plan ships self-service
// night-choice screens. "Begin Night" starts night 2+ once the day is over.
import { store, onStateChange } from "./store.js";

const STEP_LABEL = {
  "minion-info": "Minion learns the Demon",
  "demon-info": "Demon learns their Minion(s) and bluffs",
  washerwoman: "Washerwoman",
  librarian: "Librarian",
  investigator: "Investigator",
  chef: "Chef",
  empath: "Empath",
  soldier: "Soldier",
  monk: "Monk",
  fortuneTeller: "Fortune Teller",
  butler: "Butler",
  poisoner: "Poisoner",
  baron: "Baron",
  imp: "Imp",
};

function stepLabel(stepId) {
  return STEP_LABEL[stepId] || stepId;
}

function renderCandidates(step) {
  const area = document.getElementById("botc-night-candidate-area");
  area.innerHTML = "";
  if (!step || !step.candidates || step.requiresChoice) return;

  // Verbal night reveal: log the pick but don't push game:botc-info to the
  // player's phone -- the Storyteller reads it aloud. Read at click time so
  // toggling the box mid-step takes effect without a re-render.
  const isVerbal = () => document.getElementById("botc-night-verbal").checked;

  // A candidate-based step can legally have zero candidates (e.g. the
  // Demon-bluffs step once every implemented good character is already
  // dealt -- a documented limitation of steps/demonInfo.js, not a bug).
  // nightLoop.submitCandidate accepts candidateId: null for exactly this
  // case (test/e2e-botc.js's driveNightToEnd already relies on it) -- without
  // a way to submit that from the UI, the night would be stuck here forever.
  if (step.candidates.length === 0) {
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "btn-secondary";
    skipBtn.textContent = "No info to send — Advance";
    skipBtn.addEventListener("click", () => {
      store.socket.emit("host:botc-night-candidate", { code: store.roomCode, candidateId: null, verbal: isVerbal() });
    });
    area.appendChild(skipBtn);
    return;
  }

  const trueCandidates = step.candidates.filter((c) => c.truthful);
  const falseCandidates = step.candidates.filter((c) => !c.truthful);

  if (trueCandidates.length > 0) {
    const randomBtn = document.createElement("button");
    randomBtn.type = "button";
    randomBtn.className = "btn-secondary";
    randomBtn.textContent = "🎲 Pick a true one at random";
    randomBtn.addEventListener("click", () => {
      const pick = trueCandidates[Math.floor(Math.random() * trueCandidates.length)];
      store.socket.emit("host:botc-night-candidate", { code: store.roomCode, candidateId: pick.id, verbal: isVerbal() });
    });
    area.appendChild(randomBtn);
  }

  [...trueCandidates, ...falseCandidates].forEach((c) => {
    const row = document.createElement("div");
    row.className = "botc-candidate-row";
    const label = document.createElement("span");
    label.textContent = `${c.truthful ? "✅ True" : "❌ False"} — ${c.label}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary";
    btn.textContent = "Send";
    btn.addEventListener("click", () => {
      store.socket.emit("host:botc-night-candidate", { code: store.roomCode, candidateId: c.id, verbal: isVerbal() });
    });
    row.appendChild(label);
    row.appendChild(btn);
    area.appendChild(row);
  });
}

function renderChoiceOverride(step) {
  const area = document.getElementById("botc-night-choice-area");
  area.innerHTML = "";
  if (!step || !step.requiresChoice) return;

  const stateNow = store.latestState;
  const type = step.requiresChoice.type;

  if (type === "select-two-players") {
    const picked = new Set();
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "btn-secondary";
    submit.disabled = true;
    submit.textContent = "Submit 2 players";
    submit.addEventListener("click", () => {
      store.socket.emit("host:botc-night-choice", {
        code: store.roomCode,
        choice: { targetSeatIds: [...picked] },
      });
    });
    stateNow.seats.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary";
      btn.textContent = s.nickname + (s.alive ? "" : " (dead)");
      btn.addEventListener("click", () => {
        if (picked.has(s.seatId)) picked.delete(s.seatId);
        else if (picked.size < 2) picked.add(s.seatId);
        btn.classList.toggle("botc-picked", picked.has(s.seatId));
        submit.disabled = picked.size !== 2;
      });
      area.appendChild(btn);
    });
    area.appendChild(submit);
    return;
  }

  const excludeSelf = type === "select-one-player-excluding-self";
  const targets = stateNow.seats.filter((s) => !excludeSelf || s.seatId !== step.seatId);
  targets.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary";
    btn.textContent = s.nickname + (s.alive ? "" : " (dead)");
    btn.addEventListener("click", () => {
      store.socket.emit("host:botc-night-choice", { code: store.roomCode, choice: { targetSeatId: s.seatId } });
    });
    area.appendChild(btn);
  });
}

function renderNightPanel() {
  const state = store.latestState;
  const panel = document.getElementById("botc-night-panel");
  if (!state || state.phase !== "night") {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const step = state.nightStep;
  const titleEl = document.getElementById("botc-night-step-title");
  const beginBtn = document.getElementById("btn-botc-begin-night");

  if (!step) {
    // nightStep is null once every step this night has resolved, but the
    // server auto-transitions phase to "day-discussion" itself once that
    // happens (nightLoop.isNightOver, checked after every submission) --
    // seeing phase still "night" with a null step should not normally
    // persist, but render a neutral message rather than nothing if it does.
    titleEl.textContent = "Night complete — waiting to move to day.";
    beginBtn.hidden = true;
    document.getElementById("botc-night-candidate-area").innerHTML = "";
    document.getElementById("botc-night-choice-area").innerHTML = "";
    return;
  }

  titleEl.textContent = `${stepLabel(step.stepId)} — ${step.nickname}`;
  beginBtn.hidden = true;
  renderCandidates(step);
  renderChoiceOverride(step);
}

// Runs after renderNightPanel in the same onStateChange callback (see
// initNightPanel below). During phase "night", renderNightPanel already
// manages #botc-night-panel's own visibility and content; this function's
// job there is only to make sure the begin-night button stays hidden.
function renderBeginNightButton() {
  const state = store.latestState;
  const beginBtn = document.getElementById("btn-botc-begin-night");
  if (!state || state.phase !== "day-discussion") {
    beginBtn.hidden = true;
    return;
  }
  document.getElementById("botc-night-panel").hidden = false;
  document.getElementById("botc-night-step-title").textContent = "";
  document.getElementById("botc-night-candidate-area").innerHTML = "";
  document.getElementById("botc-night-choice-area").innerHTML = "";
  beginBtn.hidden = false;
  document.getElementById("botc-begin-night-number").textContent = state.dayNumber + 1;
}

export function initNightPanel() {
  onStateChange(() => {
    renderNightPanel();
    renderBeginNightButton();
  });

  document.getElementById("btn-botc-begin-night").addEventListener("click", () => {
    store.socket.emit("host:botc-begin-night", { code: store.roomCode });
  });
}

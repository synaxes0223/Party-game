// day.js
// The day panel: nominate, watch the sequential vote tally, resolve the
// nomination, execute whoever is on the block, and see the automatic
// game:botc-ended banner once a win condition fires.
import { store, onStateChange } from "./store.js";

function renderNominationSelects() {
  const state = store.latestState;
  const nominatorSelect = document.getElementById("botc-nominator-select");
  const nomineeSelect = document.getElementById("botc-nominee-select");
  if (!state) return;

  // Preserve the Storyteller's in-progress selection across a re-render
  // triggered by an unrelated state update (e.g. another player joining) --
  // without this, every rebuild silently resets both selects to seat 1,
  // discarding a selection made moments earlier. Restored only if that
  // seatId still exists, since a departure/reorder could invalidate it.
  const previousNominator = nominatorSelect.value;
  const previousNominee = nomineeSelect.value;

  // Show each seat's 1-based position in state.seats, not its raw seatId --
  // grimoire.js's renderSeatRow does the same, and for the same reason
  // (seatId is a stable identifier that reordering does not renumber; the
  // displayed number needs to run 1..N in seating order for "nominate the
  // seat to my left" to mean anything to the Storyteller). The option's
  // value is still the real seatId, which is what host:botc-nominate reads.
  const optionsHtml = state.seats
    .map((s, index) => `<option value="${s.seatId}">${index + 1}. ${s.nickname}${s.alive ? "" : " (dead)"}</option>`)
    .join("");
  nominatorSelect.innerHTML = optionsHtml;
  nomineeSelect.innerHTML = optionsHtml;

  if (state.seats.some((s) => String(s.seatId) === previousNominator)) nominatorSelect.value = previousNominator;
  if (state.seats.some((s) => String(s.seatId) === previousNominee)) nomineeSelect.value = previousNominee;
}

function renderVoteTally() {
  const state = store.latestState;
  const tally = document.getElementById("botc-vote-tally");
  tally.innerHTML = "";
  const nomination = state && state.day && state.day.currentNomination;
  if (!nomination) return;

  const nomineeSeat = state.seats.find((s) => s.seatId === nomination.nomineeSeatId);
  const nominatorSeat = state.seats.find((s) => s.seatId === nomination.nominatorSeatId);
  const header = document.createElement("div");
  header.textContent = `${nominatorSeat ? nominatorSeat.nickname : "?"} nominated ${nomineeSeat ? nomineeSeat.nickname : "?"} — ${nomination.votes.length} vote(s) so far.`;
  tally.appendChild(header);

  nomination.order.forEach((seatId, index) => {
    const seat = state.seats.find((s) => s.seatId === seatId);
    const vote = nomination.votes.find((v) => v.seatId === seatId);
    const row = document.createElement("div");
    row.className = "botc-vote-row" + (index === nomination.currentVoterIndex ? " current-voter" : "");
    const status = vote ? (vote.voted ? "voted yes" : "passed") : index < nomination.currentVoterIndex ? "passed" : "waiting…";
    row.innerHTML = `<span>${seat ? seat.nickname : seatId}</span><span>${status}</span>`;
    tally.appendChild(row);

    if (index === nomination.currentVoterIndex && !vote) {
      const yesBtn = document.createElement("button");
      yesBtn.type = "button";
      yesBtn.className = "btn-secondary";
      yesBtn.textContent = "Cast: Yes";
      yesBtn.addEventListener("click", () => {
        store.socket.emit("host:botc-vote", { code: store.roomCode, seatId, voted: true });
      });
      const noBtn = document.createElement("button");
      noBtn.type = "button";
      noBtn.className = "btn-secondary";
      noBtn.textContent = "Cast: No";
      noBtn.addEventListener("click", () => {
        store.socket.emit("host:botc-vote", { code: store.roomCode, seatId, voted: false });
      });
      row.appendChild(yesBtn);
      row.appendChild(noBtn);
    }
  });

  if (nomination.currentVoterIndex >= nomination.order.length) {
    const resolveBtn = document.createElement("button");
    resolveBtn.type = "button";
    resolveBtn.className = "btn-primary";
    resolveBtn.textContent = "Resolve Nomination";
    resolveBtn.addEventListener("click", () => {
      store.socket.emit("host:botc-resolve-vote", { code: store.roomCode });
    });
    tally.appendChild(resolveBtn);
  }
}

function renderVoteControls() {
  const state = store.latestState;
  const input = document.getElementById("botc-vote-timer-input");
  if (state && state.day && document.activeElement !== input) {
    input.value = Math.round((state.day.voteTimerMs || 0) / 1000);
  }
}

function renderVirginPrompt() {
  const state = store.latestState;
  const box = document.getElementById("botc-virgin-prompt");
  const pending = state && state.day && state.day.pendingVirgin;
  if (!pending) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  document.getElementById("botc-virgin-prompt-text").textContent =
    `${pending.nominatorNickname} nominated the Virgin (${pending.nomineeNickname}). ` +
    `${pending.nominatorNickname} currently registers as a Townsfolk: ${pending.nominatorRegistersAsTownsfolk ? "YES" : "no"}. ` +
    `Trigger the Virgin?`;
}

function renderSlayerRow() {
  const state = store.latestState;
  if (!state) return;
  const opts = state.seats
    .map((s, i) => `<option value="${s.seatId}">${i + 1}. ${s.nickname}${s.alive ? "" : " (dead)"}</option>`)
    .join("");
  const shooter = document.getElementById("botc-slayer-shooter-select");
  const target = document.getElementById("botc-slayer-target-select");
  const prevS = shooter.value;
  const prevT = target.value;
  shooter.innerHTML = opts;
  target.innerHTML = opts;
  if (state.seats.some((s) => String(s.seatId) === prevS)) shooter.value = prevS;
  if (state.seats.some((s) => String(s.seatId) === prevT)) target.value = prevT;

  const box = document.getElementById("botc-slayer-prompt");
  const pending = state.day && state.day.pendingSlayer;
  if (!pending) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  document.getElementById("botc-slayer-prompt-text").textContent =
    `${pending.shooterNickname} shot ${pending.targetNickname}. ` +
    `Target registers as the Demon: ${pending.targetRegistersAsDemon ? "YES" : "no"}. Resolve:`;
}

function renderOnBlockAndExecute() {
  const state = store.latestState;
  const onBlockEl = document.getElementById("botc-onblock");
  const executeBtn = document.getElementById("btn-botc-execute");
  const onBlock = state && state.day && state.day.onBlock;
  if (!onBlock) {
    onBlockEl.textContent = "Nobody is currently on the block.";
    executeBtn.hidden = true;
    executeBtn.onclick = null;
    return;
  }
  const seat = state.seats.find((s) => s.seatId === onBlock.seatId);
  onBlockEl.textContent = `${seat ? seat.nickname : onBlock.seatId} is on the block with ${onBlock.votes} votes.`;
  executeBtn.hidden = false;
  executeBtn.onclick = () => {
    store.socket.emit("host:botc-execute", { code: store.roomCode, seatId: onBlock.seatId });
  };
}

function renderDayPanel() {
  const state = store.latestState;
  const panel = document.getElementById("botc-day-panel");
  // The implemented backend only ever sets phase to "setup", "night",
  // "day-discussion", or "ended" (confirmed by reading state.js/nightLoop.js/
  // voting.js/index.js in full) -- nomination/voting/dusk from the spec's
  // phase enum were never split into distinct phase values; that finer
  // detail lives in state.day.currentNomination/onBlock instead, which
  // renderVoteTally/renderOnBlockAndExecute already read directly.
  const isDay = state && state.phase === "day-discussion";
  panel.hidden = !isDay;
  if (!isDay) return;

  renderNominationSelects();
  renderVoteTally();
  renderOnBlockAndExecute();
}

function renderEndedBanner() {
  const state = store.latestState;
  const banner = document.getElementById("botc-ended-banner");
  if (!state || !state.ended) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const winnerLabel = state.ended.winner === "good" ? "🛡️ Good wins!" : "🗡️ Evil wins!";
  banner.textContent = `${winnerLabel} (${state.ended.reason})`;
}

export function initDayPanel() {
  const g = document.getElementById("botc-verbal-global");

  onStateChange(() => {
    renderDayPanel();
    renderVoteControls();
    renderVirginPrompt();
    renderSlayerRow();
    renderEndedBanner();
    if (store.latestState && store.latestState.day && document.activeElement !== g) {
      g.checked = !!store.latestState.day.verbalMode;
    }
  });

  g.addEventListener("change", () => {
    store.socket.emit("host:botc-set-verbal", { code: store.roomCode, verbal: g.checked });
  });

  document.getElementById("btn-botc-set-vote-timer").addEventListener("click", () => {
    const secs = Number(document.getElementById("botc-vote-timer-input").value) || 0;
    store.socket.emit("host:botc-set-vote-timer", { code: store.roomCode, ms: secs * 1000 });
  });
  document.getElementById("btn-botc-skip-voter").addEventListener("click", () => {
    store.socket.emit("host:botc-skip-voter", { code: store.roomCode });
  });

  document.getElementById("btn-botc-nominate").addEventListener("click", () => {
    const nominatorSeatId = Number(document.getElementById("botc-nominator-select").value);
    const nomineeSeatId = Number(document.getElementById("botc-nominee-select").value);
    store.socket.emit("host:botc-nominate", { code: store.roomCode, nominatorSeatId, nomineeSeatId });
  });

  document.getElementById("btn-botc-virgin-execute").addEventListener("click", () => {
    store.socket.emit("host:botc-virgin-resolve", { code: store.roomCode, execute: true, proceed: true });
  });
  document.getElementById("btn-botc-virgin-spare").addEventListener("click", () => {
    store.socket.emit("host:botc-virgin-resolve", { code: store.roomCode, execute: false, proceed: true });
  });

  document.getElementById("btn-botc-slayer-shot").addEventListener("click", () => {
    store.socket.emit("host:botc-slayer-shot", {
      code: store.roomCode,
      shooterSeatId: Number(document.getElementById("botc-slayer-shooter-select").value),
      targetSeatId: Number(document.getElementById("botc-slayer-target-select").value),
    });
  });
  document.getElementById("btn-botc-slayer-kill").addEventListener("click", () => {
    store.socket.emit("host:botc-slayer-resolve", { code: store.roomCode, killed: true });
  });
  document.getElementById("btn-botc-slayer-nothing").addEventListener("click", () => {
    store.socket.emit("host:botc-slayer-resolve", { code: store.roomCode, killed: false });
  });
}

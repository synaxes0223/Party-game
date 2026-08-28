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

function renderOnBlockAndExecute() {
  const state = store.latestState;
  const onBlockEl = document.getElementById("botc-onblock");
  const executeBtn = document.getElementById("btn-botc-execute");
  const onBlock = state && state.day && state.day.onBlock;
  if (!onBlock) {
    onBlockEl.textContent = "Nobody is currently on the block.";
    executeBtn.hidden = true;
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
  onStateChange(() => {
    renderDayPanel();
    renderEndedBanner();
  });

  document.getElementById("btn-botc-nominate").addEventListener("click", () => {
    const nominatorSeatId = Number(document.getElementById("botc-nominator-select").value);
    const nomineeSeatId = Number(document.getElementById("botc-nominee-select").value);
    store.socket.emit("host:botc-nominate", { code: store.roomCode, nominatorSeatId, nomineeSeatId });
  });
}

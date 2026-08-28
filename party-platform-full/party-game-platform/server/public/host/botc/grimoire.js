// grimoire.js
// The persistent seat list -- always visible once dealing has happened,
// alongside whichever of the night/day panels (Tasks 6-7) is currently
// relevant. Realizes spec §4's governing principle in the UI: every field
// (character, alignment via character, alive, reminders) is editable here
// at any time, not just what the current night step or vote happens to
// expose.
import { store, onStateChange } from "./store.js";

const CHARACTERS = [
  { id: "washerwoman", label: "Washerwoman" },
  { id: "empath", label: "Empath" },
  { id: "soldier", label: "Soldier" },
  { id: "chef", label: "Chef" },
  { id: "investigator", label: "Investigator" },
  { id: "librarian", label: "Librarian" },
  { id: "monk", label: "Monk" },
  { id: "fortuneTeller", label: "Fortune Teller" },
  { id: "butler", label: "Butler" },
  { id: "drunk", label: "Drunk" },
  { id: "saint", label: "Saint" },
  { id: "poisoner", label: "Poisoner" },
  { id: "baron", label: "Baron" },
  { id: "imp", label: "Imp" },
];

function characterLabel(characterId) {
  const found = CHARACTERS.find((c) => c.id === characterId);
  return found ? found.label : characterId || "(none)";
}

// seat.seatId is a stable identifier (spec §4: "independent of player
// identity") that grimoire.reorderSeats deliberately does NOT renumber when
// the array order changes -- only the seat objects' positions move. But
// spec §6's whole adjacency-list concept ("seats 1 and 4 are adjacent")
// depends on the DISPLAYED numbers running 1..N in the same order the rows
// are drawn in. displayNumber (this row's 1-based position in state.seats,
// passed in by renderSeatList) is what gets shown; seat.seatId remains what
// every socket emit and data-*-for attribute below targets, since that's
// the identifier the backend's handlers actually key on.
function renderSeatRow(seat, displayNumber) {
  const row = document.createElement("div");
  row.className = "botc-seat-row" + (seat.alive ? "" : " dead");
  row.dataset.seatId = seat.seatId;

  const main = document.createElement("div");
  main.className = "botc-seat-row-main";

  const believedSuffix =
    seat.characterId !== seat.believedCharacterId ? ` (believes ${characterLabel(seat.believedCharacterId)})` : "";
  main.innerHTML = `
    <span class="botc-seat-id">${displayNumber}</span>
    <span class="botc-seat-nickname">${seat.nickname}</span>
    <span class="botc-seat-character ${seat.alignment === "evil" ? "evil" : ""}">${characterLabel(seat.characterId)}${believedSuffix}</span>
    <span>${seat.alive ? "alive" : "dead" + (seat.usedDeadVote ? ", dead vote used" : ", dead vote unused")}</span>
  `;
  row.appendChild(main);

  const reminders = document.createElement("div");
  reminders.className = "botc-seat-reminders";
  seat.reminders.forEach((r) => {
    const tag = document.createElement("span");
    tag.className = "botc-reminder-tag";
    tag.innerHTML = `${r.label} <button type="button" data-remove-reminder="${r.id}">×</button>`;
    reminders.appendChild(tag);
  });
  row.appendChild(reminders);

  const controls = document.createElement("div");
  controls.className = "botc-seat-controls";

  const charSelect = document.createElement("select");
  charSelect.className = "input-field";
  charSelect.innerHTML = CHARACTERS.map((c) => `<option value="${c.id}" ${c.id === seat.characterId ? "selected" : ""}>${c.label}</option>`).join("");
  charSelect.dataset.setCharacterFor = seat.seatId;

  const aliveBtn = document.createElement("button");
  aliveBtn.type = "button";
  aliveBtn.className = "btn-secondary";
  aliveBtn.textContent = seat.alive ? "Mark dead" : "Revive";
  aliveBtn.dataset.toggleAliveFor = seat.seatId;
  aliveBtn.dataset.nextAlive = seat.alive ? "false" : "true";

  const reminderInput = document.createElement("input");
  reminderInput.type = "text";
  reminderInput.className = "input-field";
  reminderInput.placeholder = "Add reminder…";
  reminderInput.dataset.reminderInputFor = seat.seatId;

  const reminderKindSelect = document.createElement("select");
  reminderKindSelect.className = "input-field";
  reminderKindSelect.dataset.reminderKindFor = seat.seatId;
  reminderKindSelect.innerHTML = ["custom", "red-herring", "protected", "poisoned"]
    .map((k) => `<option value="${k}">${k}</option>`)
    .join("");

  const addReminderBtn = document.createElement("button");
  addReminderBtn.type = "button";
  addReminderBtn.className = "btn-secondary";
  addReminderBtn.textContent = "Add";
  addReminderBtn.dataset.addReminderFor = seat.seatId;

  controls.appendChild(charSelect);
  controls.appendChild(aliveBtn);
  controls.appendChild(reminderInput);
  controls.appendChild(reminderKindSelect);
  controls.appendChild(addReminderBtn);
  row.appendChild(controls);

  return row;
}

function renderSeatList() {
  const container = document.getElementById("botc-seat-list");
  container.innerHTML = "";
  const state = store.latestState;
  if (!state) return;
  state.seats.forEach((seat, index) => container.appendChild(renderSeatRow(seat, index + 1)));
}

// Event delegation on the container -- rows are fully re-rendered on every
// state update, so listeners attached directly to row elements would need
// re-attaching every time; delegating to the stable container avoids that.
function wireSeatListDelegation() {
  const container = document.getElementById("botc-seat-list");

  container.addEventListener("change", (e) => {
    const seatId = e.target.dataset.setCharacterFor;
    if (seatId) {
      store.socket.emit("host:botc-set-character", { code: store.roomCode, seatId: Number(seatId), characterId: e.target.value });
    }
  });

  container.addEventListener("click", (e) => {
    const toggleSeatId = e.target.dataset.toggleAliveFor;
    if (toggleSeatId) {
      store.socket.emit("host:botc-set-alive", {
        code: store.roomCode,
        seatId: Number(toggleSeatId),
        alive: e.target.dataset.nextAlive === "true",
      });
      return;
    }

    const addSeatId = e.target.dataset.addReminderFor;
    if (addSeatId) {
      const input = container.querySelector(`[data-reminder-input-for="${addSeatId}"]`);
      const label = input.value.trim();
      if (!label) return;
      const kindSelect = container.querySelector(`[data-reminder-kind-for="${addSeatId}"]`);
      const kind = kindSelect ? kindSelect.value : "custom";
      store.socket.emit("host:botc-add-reminder", { code: store.roomCode, seatId: Number(addSeatId), label, kind });
      input.value = "";
      return;
    }

    const removeReminderId = e.target.dataset.removeReminder;
    if (removeReminderId) {
      // The reminder belongs to whichever seat's row contains this button --
      // read the seat id directly off the row's own dataset (set in
      // renderSeatRow) rather than inferring it from DOM position.
      const row = e.target.closest(".botc-seat-row");
      const seatId = Number(row.dataset.seatId);
      store.socket.emit("host:botc-remove-reminder", { code: store.roomCode, seatId, reminderId: Number(removeReminderId) });
    }
  });
}

function wireCoverButton() {
  const coverScreen = document.getElementById("botc-cover-screen");
  document.getElementById("btn-botc-cover").addEventListener("click", () => {
    coverScreen.hidden = false;
  });
  document.getElementById("btn-botc-uncover").addEventListener("click", () => {
    coverScreen.hidden = true;
  });
}

export function initGrimoire() {
  onStateChange(() => renderSeatList());
  wireSeatListDelegation();
  wireCoverButton();
}

// setup.js
// The pre-game screen: arrange seat order (adjacency-dependent characters
// and the voting order both read this), then deal -- randomly (the backend
// picks characters respecting the player-count distribution table) or
// manually (the Storyteller assigns every seat's character by hand).
import { store, onStateChange } from "./store.js";

// The registered characters. Team here is display-only (grouping the
// manual-deal dropdown); the server independently derives the authoritative
// team/alignment from the character id itself (dealing.js's
// alignmentForTeam) -- this list drifting from characters/index.js's
// TEAM_OF would only ever mislabel a dropdown group, never mis-assign an
// actual alignment.
const CHARACTERS = [
  { id: "washerwoman", label: "Washerwoman", team: "Townsfolk" },
  { id: "empath", label: "Empath", team: "Townsfolk" },
  { id: "soldier", label: "Soldier", team: "Townsfolk" },
  { id: "chef", label: "Chef", team: "Townsfolk" },
  { id: "investigator", label: "Investigator", team: "Townsfolk" },
  { id: "librarian", label: "Librarian", team: "Townsfolk" },
  { id: "monk", label: "Monk", team: "Townsfolk" },
  { id: "fortuneTeller", label: "Fortune Teller", team: "Townsfolk" },
  { id: "butler", label: "Butler", team: "Outsider" },
  { id: "drunk", label: "Drunk", team: "Outsider" },
  { id: "saint", label: "Saint", team: "Outsider" },
  { id: "poisoner", label: "Poisoner", team: "Minion" },
  { id: "baron", label: "Baron", team: "Minion" },
  { id: "imp", label: "Imp", team: "Demon" },
];

// The Drunk is dealt as a Townsfolk they believe themselves to be; the
// manual-deal row reveals a second <select> (these ids) for that believed
// character, sent as believedCharacterId in the assignment.
const TOWNSFOLK_IDS = CHARACTERS.filter((c) => c.team === "Townsfolk");

// Local reordering happens purely client-side against this array of player
// ids until Deal is clicked -- the server has no notion of "seat order"
// before a deal exists at all (seats are created BY dealing).
let orderedPlayerIds = [];

function syncOrderedPlayerIdsFromRoster() {
  const rosterIds = store.roster.map((p) => p.id);
  // Preserve any manual reordering already done for players still present;
  // append newly-joined players at the end; drop anyone who left.
  const kept = orderedPlayerIds.filter((id) => rosterIds.includes(id));
  const added = rosterIds.filter((id) => !kept.includes(id));
  orderedPlayerIds = [...kept, ...added];
}

function nicknameFor(playerId) {
  const p = store.roster.find((r) => r.id === playerId);
  return p ? p.nickname : "(unknown)";
}

function renderSeatOrderList() {
  const list = document.getElementById("botc-seat-order-list");
  list.innerHTML = "";
  orderedPlayerIds.forEach((playerId, index) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${nicknameFor(playerId)}`;
    const controls = document.createElement("span");

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "btn-secondary";
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => {
      [orderedPlayerIds[index - 1], orderedPlayerIds[index]] = [orderedPlayerIds[index], orderedPlayerIds[index - 1]];
      renderSeatOrderList();
      renderManualDealRows();
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "btn-secondary";
    downBtn.textContent = "↓";
    downBtn.disabled = index === orderedPlayerIds.length - 1;
    downBtn.addEventListener("click", () => {
      [orderedPlayerIds[index + 1], orderedPlayerIds[index]] = [orderedPlayerIds[index], orderedPlayerIds[index + 1]];
      renderSeatOrderList();
      renderManualDealRows();
    });

    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    li.appendChild(label);
    li.appendChild(controls);
    list.appendChild(li);
  });
}

function distributionHintFor(playerCount) {
  if (!store.distributionTable) return "";
  const row = store.distributionTable[playerCount];
  if (!row) return `No distribution entry for ${playerCount} players (need 5-15).`;
  return `Expected for ${playerCount} players: ${row.townsfolk} Townsfolk, ${row.outsiders} Outsiders, ${row.minions} Minion(s), ${row.demon} Demon. (A Baron in play shifts this by +2 Outsiders/-2 Townsfolk -- this is only a suggestion; dealing never blocks on it.)`;
}

function renderManualDealRows() {
  const container = document.getElementById("botc-manual-deal-rows");
  // Preserve any characters already chosen, keyed by player id, across a
  // re-render triggered by an unrelated state update (e.g. another player
  // joining) -- without this, every rebuild silently wipes the Storyteller's
  // in-progress selections. Same bug family as the reorder-desync fix
  // (a full DOM rebuild discarding data the Storyteller already entered),
  // and reuses that same fix's dataset.playerId convention.
  const previousChoices = new Map();
  const previousBelieved = new Map();
  container.querySelectorAll("select[data-player-id]").forEach((select) => {
    if (select.value) previousChoices.set(select.dataset.playerId, select.value);
  });
  container.querySelectorAll("select[data-believed-for]").forEach((select) => {
    if (select.value) previousBelieved.set(select.dataset.believedFor, select.value);
  });

  container.innerHTML = "";
  orderedPlayerIds.forEach((playerId, index) => {
    const row = document.createElement("div");
    row.className = "botc-manual-deal-row";
    const seatNumber = index + 1;
    const select = document.createElement("select");
    select.className = "input-field";
    select.dataset.playerId = playerId;
    select.innerHTML = `<option value="">-- choose --</option>` + CHARACTERS.map((c) => `<option value="${c.id}">${c.label} (${c.team})</option>`).join("");
    if (previousChoices.has(playerId)) select.value = previousChoices.get(playerId);
    row.innerHTML = `<span>${seatNumber}. ${nicknameFor(playerId)}</span>`;
    row.appendChild(select);

    // The Drunk needs a believed Townsfolk; reveal a second <select> for it
    // only while this row's character is "drunk".
    const believedSelect = document.createElement("select");
    believedSelect.className = "input-field";
    believedSelect.dataset.believedFor = playerId;
    believedSelect.innerHTML = `<option value="">-- believes… --</option>` + TOWNSFOLK_IDS.map((c) => `<option value="${c.id}">${c.label}</option>`).join("");
    if (previousBelieved.has(playerId)) believedSelect.value = previousBelieved.get(playerId);
    believedSelect.hidden = select.value !== "drunk";
    select.addEventListener("change", () => {
      believedSelect.hidden = select.value !== "drunk";
    });
    row.appendChild(believedSelect);

    container.appendChild(row);
  });
}

function renderAll() {
  document.getElementById("botc-player-count").textContent = store.roster.length;
  document.getElementById("botc-distribution-hint").textContent = distributionHintFor(store.roster.length);
  syncOrderedPlayerIdsFromRoster();
  renderSeatOrderList();
  renderManualDealRows();
}

export function initSetup() {
  onStateChange(() => renderAll());
  renderAll();

  document.getElementById("btn-botc-random-deal").addEventListener("click", () => {
    document.getElementById("botc-setup-error").textContent = "";
    store.socket.emit("host:botc-start", { code: store.roomCode, seatOrder: orderedPlayerIds });
  });

  document.getElementById("btn-botc-manual-deal").addEventListener("click", () => {
    document.getElementById("botc-setup-error").textContent = "";
    const selects = document.querySelectorAll("#botc-manual-deal-rows select[data-player-id]");
    const assignments = [];
    for (const select of selects) {
      // Resolve this select's seat from its own player id against the
      // CURRENT orderedPlayerIds, rather than trusting DOM position to
      // still match array position -- defense-in-depth against the
      // manual-deal rows ever going stale relative to a reorder again.
      const playerId = select.dataset.playerId;
      const seatId = orderedPlayerIds.indexOf(playerId) + 1;
      const characterId = select.value;
      if (!characterId) {
        document.getElementById("botc-setup-error").textContent = "Assign a character to every seat before dealing manually.";
        return;
      }
      if (characterId === "drunk") {
        const believedSelect = document.querySelector(`#botc-manual-deal-rows select[data-believed-for="${playerId}"]`);
        const believedCharacterId = believedSelect && believedSelect.value;
        if (!believedCharacterId) {
          document.getElementById("botc-setup-error").textContent = "Choose the Townsfolk the Drunk believes they are.";
          return;
        }
        assignments.push({ seatId, characterId, believedCharacterId });
        continue;
      }
      assignments.push({ seatId, characterId });
    }
    store.socket.emit("host:botc-manual-deal", { code: store.roomCode, assignments, seatOrder: orderedPlayerIds });
  });
}

// main.js
// Entry point for the Blood on the Clocktower host UI. This file, and every
// other file under public/host/botc/, is loaded as a native ES module
// (spec §3) -- no bundler, no build step. It never imports from or modifies
// host.js; the only integration points are the two lines added to host.js
// in this task's Step 1 (window.__hostSocket, and the "botc" branch that
// calls window.__botcEnterSetup).
import { store, setState } from "./store.js";
import { initSetup } from "./setup.js";
import { initGrimoire } from "./grimoire.js";
import { initNightPanel } from "./night.js";
import { initDayPanel } from "./day.js";

const screens = {
  setup: document.getElementById("screen-botc-setup"),
  grimoire: document.getElementById("screen-botc-grimoire"),
};

function showBotcScreen(name) {
  document.querySelectorAll(".screen.active").forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

// Called by host.js's Start-game handler once, when the Storyteller selects
// Blood on the Clocktower and clicks Start.
window.__botcEnterSetup = function (code) {
  setState({ roomCode: code });
  store.socket.emit("host:botc-request-state", { code });
  showBotcScreen("setup");
};

function updateRosterFromRoom(room) {
  setState({ roster: room.players });
}

function updateDistributionTable(games) {
  const botcMeta = games.find((g) => g.id === "botc");
  if (botcMeta) setState({ distributionTable: botcMeta.distributionTable });
}

store.socket.on("host:room-created", ({ room, games }) => {
  updateRosterFromRoom(room);
  updateDistributionTable(games);
});

store.socket.on("host:room-reclaimed", ({ room, games, gameId }) => {
  updateRosterFromRoom(room);
  updateDistributionTable(games);
  // A page reload/reconnect while already mid-botc-game: re-request state so
  // the grimoire re-populates instead of sitting empty until the next
  // Storyteller action happens to trigger a broadcast.
  if (gameId === "botc") {
    setState({ roomCode: room.code });
    store.socket.emit("host:botc-request-state", { code: room.code });
  }
});

store.socket.on("host:room-updated", ({ room }) => updateRosterFromRoom(room));

store.socket.on("host:botc-state", ({ state }) => {
  setState({ latestState: state });
  if (state.phase !== "setup") showBotcScreen("grimoire");
});

store.socket.on("host:botc-error", ({ error }) => {
  const el = document.getElementById("botc-setup-error");
  if (el) el.textContent = error;
});

initSetup();
initGrimoire();
initNightPanel();
initDayPanel();

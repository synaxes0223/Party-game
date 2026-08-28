// main.js
// Entry point for the Blood on the Clocktower player UI. This file, and
// every other file under public/player/botc/, is loaded as a native ES
// module -- no bundler. It never imports from or modifies player.js; the
// only integration point is the one line added to player.js in this task's
// Step 1 (window.__playerSocket).
import { store, setState } from "./store.js";

const screens = {
  role: document.getElementById("screen-botc-role"),
  nightChoice: document.getElementById("screen-botc-night-choice"),
  vote: document.getElementById("screen-botc-vote"),
  ended: document.getElementById("screen-botc-ended"),
};

export function showBotcScreen(name) {
  document.querySelectorAll(".screen.active").forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

// player:joined/player:rejoined already fire on this same connection --
// player.js has its own listeners for these same two events (rendering the
// waiting-room player list); this is a second, independent listener for the
// one additional thing this plan needs from them (the room code), which
// player.js's own private roomCode variable cannot expose to a separate
// module.
store.socket.on("player:joined", ({ room }) => setState({ roomCode: room.code }));
store.socket.on("player:rejoined", ({ room }) => setState({ roomCode: room.code }));

// roleAndInfo.js
// Three purely-passive display surfaces: the role-reveal screen (shown
// once at deal time and again on any reconnect, since game:botc-role is
// re-sent by onPlayerRejoined), the info toast (a Storyteller-sent reveal,
// e.g. the Washerwoman's "one of X/Y is a Townsfolk"), and the game-over
// screen. None of these submit anything back to the server.
import { store } from "./store.js";
import { showBotcScreen } from "./main.js";

// Hint text is short, original flavor per spec §1 ("written fresh and kept
// short") -- not official Almanac prose. A Drunk's phone receives its
// BELIEVED character via game:botc-role, so the drunk entry here is only a
// fallback.
const CHARACTERS = {
  washerwoman: {
    label: "Washerwoman",
    hint: "You start knowing that 1 of 2 players is a particular Townsfolk.",
  },
  empath: {
    label: "Empath",
    hint: "Each night, you learn how many of your 2 alive neighbours are evil.",
  },
  soldier: {
    label: "Soldier",
    hint: "You are safe from the Demon's kill.",
  },
  chef: {
    label: "Chef",
    hint: "You start knowing how many pairs of evil players sit next to each other.",
  },
  investigator: {
    label: "Investigator",
    hint: "You start knowing that 1 of 2 players is a particular Minion.",
  },
  librarian: {
    label: "Librarian",
    hint: "You start knowing that 1 of 2 players is a particular Outsider (or that none are in play).",
  },
  monk: {
    label: "Monk",
    hint: "Each night except the first, choose a player (not yourself): they are safe from the Demon tonight.",
  },
  fortuneTeller: {
    label: "Fortune Teller",
    hint: "Each night, choose 2 players: you learn if either registers as the Demon. One good player may register falsely to you.",
  },
  virgin: {
    label: "Virgin",
    hint: "The first time you are nominated, if the nominator is a Townsfolk, they die instead of you.",
  },
  butler: {
    label: "Butler",
    hint: "Each night, choose a player (not yourself). Tomorrow, you may only vote if they are voting too.",
  },
  drunk: {
    label: "Drunk",
    hint: "You think you are a Townsfolk, but you are the Drunk. Your ability does nothing and your information may be wrong.",
  },
  saint: {
    label: "Saint",
    hint: "If you are executed, your team loses.",
  },
  poisoner: {
    label: "Poisoner",
    hint: "Each night, choose a player. They are poisoned until dusk tomorrow.",
  },
  baron: {
    label: "Baron",
    hint: "There are extra Outsiders in play, and fewer Townsfolk.",
  },
  imp: {
    label: "Imp",
    hint: "Each night, choose a player to kill. If you kill yourself, a Minion becomes the Imp.",
  },
};

function renderRole({ characterId, alignment }) {
  const info = CHARACTERS[characterId] || { label: characterId, hint: "" };
  document.getElementById("botc-role-name").textContent = info.label;
  const alignmentEl = document.getElementById("botc-role-alignment");
  alignmentEl.textContent = alignment === "evil" ? "🗡️ Evil" : "🛡️ Good";
  alignmentEl.className = "botc-role-alignment" + (alignment === "evil" ? " evil" : "");
  document.getElementById("botc-role-hint").textContent = info.hint;
  showBotcScreen("role");
}

function showInfoToast(text) {
  const toast = document.getElementById("botc-info-toast");
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 6000);
}

function renderEnded({ winner, reason }) {
  const winnerLabel = winner === "good" ? "🛡️ Good wins!" : "🗡️ Evil wins!";
  document.getElementById("botc-ended-text").textContent = `${winnerLabel} (${reason})`;
  showBotcScreen("ended");
}

export function initRoleAndInfo() {
  store.socket.on("game:botc-role", renderRole);
  store.socket.on("game:botc-info", ({ text }) => showInfoToast(text));
  store.socket.on("game:botc-ended", renderEnded);
}

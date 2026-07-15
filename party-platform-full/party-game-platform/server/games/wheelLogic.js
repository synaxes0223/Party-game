// wheelLogic.js
// Pure logic for the punishment wheel's item list — no socket.io, no room
// state. Mirrors slipUpLogic.js's pure-function, non-throwing convention:
// every function returns a plain object, either { error } or { items }.

const crypto = require("crypto");

const DEFAULT_PUNISHMENTS = [
  "Sing a song of the group's choice",
  "Do 15 pushups",
  "Talk in a funny accent for the next 5 minutes",
  "Let the group draw something on your face with a washable marker",
  "Do your best impression of another player",
  "Speak only in questions for the next 3 minutes",
  "Do a dance for 30 seconds",
  "Tell an embarrassing story",
  "Let the group pick your profile picture for a day",
  "Act like a chicken for 1 minute",
];

function makeDefaultItems() {
  return DEFAULT_PUNISHMENTS.map((text) => ({
    id: crypto.randomUUID(),
    text,
    addedBy: "default",
  }));
}

function addItem(items, { text, addedBy, nickname }) {
  const trimmed = (typeof text === "string" ? text : "").trim();
  if (!trimmed) return { error: "Punishment text is required." };

  const newItem = {
    id: crypto.randomUUID(),
    text: trimmed,
    addedBy: addedBy || "player",
  };
  if (nickname) newItem.nickname = nickname;

  return { items: [...items, newItem] };
}

function removeItem(items, id) {
  return { items: items.filter((item) => item.id !== id) };
}

module.exports = { DEFAULT_PUNISHMENTS, makeDefaultItems, addItem, removeItem };

// slipUpLogic.js
// Pure functions for Slip-Up's word/action pool: building the session pool
// from built-ins plus host customizations, dealing distinct entries to
// players, and reassigning a caught player without colliding with anyone
// else's currently-held entry. No socket.io, no room state — plain data in,
// plain data out.

const crypto = require("crypto");

const BUILTIN_ENTRIES = [
  { id: "w1", type: "word", text: "like" },
  { id: "w2", type: "word", text: "actually" },
  { id: "w3", type: "word", text: "literally" },
  { id: "w4", type: "word", text: "basically" },
  { id: "w5", type: "word", text: "um" },
  { id: "w6", type: "word", text: "so" },
  { id: "w7", type: "word", text: "yeah" },
  { id: "w8", type: "word", text: "totally" },
  { id: "w9", type: "word", text: "honestly" },
  { id: "w10", type: "word", text: "obviously" },
  { id: "w11", type: "word", text: "whatever" },
  { id: "w12", type: "word", text: "cool" },
  { id: "w13", type: "word", text: "nice" },
  { id: "w14", type: "word", text: "okay" },
  { id: "w15", type: "word", text: "right" },
  { id: "w16", type: "word", text: "seriously" },
  { id: "a1", type: "action", text: "cross your arms" },
  { id: "a2", type: "action", text: "point at someone" },
  { id: "a3", type: "action", text: "laugh out loud" },
  { id: "a4", type: "action", text: "touch your face" },
  { id: "a5", type: "action", text: "say someone's name" },
  { id: "a6", type: "action", text: "clap your hands" },
  { id: "a7", type: "action", text: "check your phone" },
  { id: "a8", type: "action", text: "sit down" },
  { id: "a9", type: "action", text: "stand up" },
  { id: "a10", type: "action", text: "wave at someone" },
  { id: "a11", type: "action", text: "give a thumbs up" },
  { id: "a12", type: "action", text: "make eye contact with the host" },
  { id: "a13", type: "action", text: "cross your legs" },
  { id: "a14", type: "action", text: "smile" },
  { id: "a15", type: "action", text: "nod your head" },
  { id: "a16", type: "action", text: "shake someone's hand" },
];

function buildPool(excludedIds, customEntries) {
  const excluded = new Set(excludedIds || []);
  const builtins = BUILTIN_ENTRIES.filter((e) => !excluded.has(e.id));

  const seenTexts = new Set(builtins.map((e) => e.text.trim().toLowerCase()));
  const custom = [];
  for (const raw of customEntries || []) {
    const type = raw && raw.type === "action" ? "action" : "word";
    const text = raw && typeof raw.text === "string" ? raw.text.trim() : "";
    if (!text) return { error: "Custom entries must have non-empty text." };
    const key = text.toLowerCase();
    if (seenTexts.has(key)) return { error: `Duplicate entry: "${text}".` };
    seenTexts.add(key);
    custom.push({ id: crypto.randomUUID(), type, text });
  }

  return { pool: [...builtins, ...custom] };
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dealAssignments(pool, playerIds) {
  if (pool.length < playerIds.length) {
    return { error: `Need at least ${playerIds.length} entries in the pool (have ${pool.length}).` };
  }
  const shuffled = shuffle(pool);
  const assignments = new Map();
  playerIds.forEach((pid, i) => assignments.set(pid, shuffled[i]));
  return { assignments };
}

function reassignOne(pool, currentlyHeldEntries) {
  const heldIds = new Set(currentlyHeldEntries.map((e) => e.id));
  const candidates = pool.filter((e) => !heldIds.has(e.id));
  if (candidates.length === 0) {
    return { error: "No available entry to reassign — every pool entry is currently held." };
  }
  const entry = candidates[Math.floor(Math.random() * candidates.length)];
  return { entry };
}

module.exports = { BUILTIN_ENTRIES, buildPool, dealAssignments, reassignOne };

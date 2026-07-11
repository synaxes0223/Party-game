// promptLogic.js
// Pure functions for the shared prompt pipeline: drawing from a curated pack
// without immediate repeats (mirrors wordPairLogic's pickAutoPair), player-
// submission validation, and the queue-before-pack draw order used by every
// pipeline game. No socket.io, no room state -- plain data in, plain data out.

const MAX_SUBMISSION_LENGTH = 200;

// Picks a random entry from `pool` whose spice is <= maxSpice and whose
// index isn't in usedIndexes. Once every eligible index has been used,
// resets (returning a fresh set containing only the newly picked index) so a
// long game session never runs dry. Returns a NEW Set rather than mutating
// the one passed in, keeping this function pure. Returns {error} if the pool
// has no entry at or below maxSpice at all.
function pickFromPack(pool, usedIndexes, maxSpice) {
  const eligibleIndexes = pool.map((_, i) => i).filter((i) => pool[i].spice <= maxSpice);
  if (eligibleIndexes.length === 0) {
    return { error: `No prompts available at spice level ${maxSpice} or below.` };
  }

  let availableIndexes = eligibleIndexes.filter((i) => !usedIndexes.has(i));
  let baseUsed = usedIndexes;
  if (availableIndexes.length === 0) {
    availableIndexes = eligibleIndexes;
    baseUsed = new Set();
  }

  const index = availableIndexes[Math.floor(Math.random() * availableIndexes.length)];
  const nextUsed = new Set(baseUsed);
  nextUsed.add(index);
  return { prompt: pool[index], index, usedIndexes: nextUsed };
}

// Validates a player-submitted (or host custom) prompt string.
function validateSubmission(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return { error: "Prompt text is required." };
  if (trimmed.length > MAX_SUBMISSION_LENGTH) {
    return { error: `Keep it under ${MAX_SUBMISSION_LENGTH} characters.` };
  }
  return { text: trimmed };
}

// The single draw function pipeline games call each round: player
// submissions (and AI-approved prompts, which are pushed onto the same
// queue) drain first, FIFO; only once the queue is empty does it fall back
// to the curated pack. Returns {prompt: {text, spice, source, authorId?},
// nextQueue, usedIndexes} or {error}. Does not mutate its inputs.
function drawNext(queue, pool, usedIndexes, maxSpice) {
  if (queue.length > 0) {
    const [next, ...rest] = queue;
    return { prompt: next, nextQueue: rest, usedIndexes };
  }

  const result = pickFromPack(pool, usedIndexes, maxSpice);
  if (result.error) return { error: result.error };

  return {
    prompt: { text: result.prompt.text, spice: result.prompt.spice, source: "pack" },
    nextQueue: queue,
    usedIndexes: result.usedIndexes,
  };
}

module.exports = { pickFromPack, validateSubmission, drawNext, MAX_SUBMISSION_LENGTH };

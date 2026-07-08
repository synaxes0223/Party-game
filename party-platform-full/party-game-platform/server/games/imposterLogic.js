// imposterLogic.js
// Pure game-rule functions for Find the Imposter's round/elimination mechanics.
// No socket.io or room state here — plain data in, plain data out — so these
// rules are unit-testable without spinning up a server.

const SYNC_BUFFER_MS = 1500;

function resolveRound(activePlayerIds, votes) {
  const tally = {};
  for (const targetId of votes.values()) {
    tally[targetId] = (tally[targetId] || 0) + 1;
  }

  const threshold = Math.floor(activePlayerIds.length / 2) + 1;
  let eliminatedId = null;
  for (const [targetId, count] of Object.entries(tally)) {
    if (targetId !== "skip" && count >= threshold) {
      eliminatedId = targetId;
      break;
    }
  }

  return { eliminatedId, tally };
}

function checkGameEnd(remainingActiveIds, eliminatedId, imposterId) {
  if (eliminatedId !== null && eliminatedId === imposterId) {
    return { gameOver: true, winner: "crew" };
  }
  if (remainingActiveIds.length <= 2) {
    return { gameOver: true, winner: "imposter" };
  }
  return { gameOver: false, winner: null };
}

function computeElapsedMs(segmentStartedAtMs, atMs) {
  return Math.max(0, atMs - segmentStartedAtMs);
}

module.exports = { SYNC_BUFFER_MS, resolveRound, checkGameEnd, computeElapsedMs };

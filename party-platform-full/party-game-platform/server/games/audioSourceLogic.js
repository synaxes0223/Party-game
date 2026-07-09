// audioSourceLogic.js
// Pure functions for resolving YouTube URLs and uploaded-file pairs into
// TrackRefs, plus the per-player playback position formula. No socket.io,
// no room state, no filesystem access — plain data in, plain data out.

const YOUTUBE_URL_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
  /youtu\.be\/([a-zA-Z0-9_-]{11})/,
];

function parseYouTubeVideoId(url) {
  if (typeof url !== "string") return null;
  for (const pattern of YOUTUBE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function buildYoutubeTrack(input) {
  const videoId = parseYouTubeVideoId(input.url);
  if (!videoId) return { error: `Could not find a video ID in "${input.url}".` };
  const startSeconds = Number(input.startSeconds) || 0;
  if (startSeconds < 0) return { error: "Start second must be zero or positive." };
  return { videoId, startSeconds };
}

// Ignores any timestamp embedded in the URL itself -- the explicit
// startSeconds field on each input is the single source of truth.
function buildYoutubePair(normalInput, imposterInput) {
  const normalResult = buildYoutubeTrack(normalInput);
  if (normalResult.error) return { error: normalResult.error };
  const imposterResult = buildYoutubeTrack(imposterInput);
  if (imposterResult.error) return { error: imposterResult.error };
  return {
    normal: { sourceType: "youtube", videoId: normalResult.videoId, startSeconds: normalResult.startSeconds },
    imposter: { sourceType: "youtube", videoId: imposterResult.videoId, startSeconds: imposterResult.startSeconds },
  };
}

// Resolves a normal/imposter upload pair from the pool, given optional
// explicit file ids. Empty slots are randomly filled from the pool. The
// two resulting files must always be different -- this applies whether
// that's because random-fill couldn't find a distinct second file, or
// because the host explicitly submitted the same id for both slots.
function pickUploadPair(pool, normalFileId, imposterFileId) {
  const findById = (id) => pool.find((f) => f.id === id);

  let normalFile = normalFileId ? findById(normalFileId) : null;
  let imposterFile = imposterFileId ? findById(imposterFileId) : null;

  if (normalFileId && !normalFile) return { error: "Selected normal-track file no longer exists." };
  if (imposterFileId && !imposterFile) return { error: "Selected imposter-track file no longer exists." };

  if (normalFile && imposterFile && normalFile.id === imposterFile.id) {
    return { error: "Need at least 2 different uploaded files to use this source." };
  }

  if (!normalFile) {
    const candidates = pool.filter((f) => !imposterFile || f.id !== imposterFile.id);
    if (candidates.length === 0) return { error: "Need at least 2 different uploaded files to use this source." };
    normalFile = candidates[Math.floor(Math.random() * candidates.length)];
  }

  if (!imposterFile) {
    const candidates = pool.filter((f) => f.id !== normalFile.id);
    if (candidates.length === 0) return { error: "Need at least 2 different uploaded files to use this source." };
    imposterFile = candidates[Math.floor(Math.random() * candidates.length)];
  }

  return {
    normal: { sourceType: "upload", audioUrl: normalFile.url, startSeconds: 0 },
    imposter: { sourceType: "upload", audioUrl: imposterFile.url, startSeconds: 0 },
  };
}

// The per-player broadcast position: this player's own track start-second
// (0 for builtin/upload) plus the shared elapsed time since this round's
// playback segment began.
function computePlayerPosition(track, elapsedMs) {
  return (track.startSeconds || 0) * 1000 + elapsedMs;
}

module.exports = { parseYouTubeVideoId, buildYoutubePair, pickUploadPair, computePlayerPosition };

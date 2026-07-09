# Find the Imposter — YouTube & Uploaded-File Audio Sources

## Context

The round-elimination rewrite (see `2026-07-09-imposter-round-elimination-design.md`) deliberately kept the playback-control protocol source-agnostic — the server only ever broadcasts "play at timestamp X from position P" / "pause at timestamp X," never touching how a client actually renders the audio — specifically so a non-local audio source could be added later without re-architecting. This spec is that follow-up: it adds two new ways for the host to supply a round's normal/imposter track pair, alongside the existing built-in pairs:

1. **YouTube**: host pastes a URL + start-second for each of the normal and imposter tracks.
2. **Uploaded file**: host uploads `.mp3`/`.mp4` files from their computer into a server-side pool, then picks 0, 1, or 2 files per round (empty slots are randomly filled from the pool; the two tracks are always different files).

Both are offered alongside the built-in pairs, not as a replacement — the track-select screen gains three tabs (Built-in / YouTube / Uploaded).

Known, accepted risk (not mitigated in this spec): YouTube's embedded player can show a pre-roll ad before the actual video starts, which would break the synced start and could show different ads to different players. This is documented as a limitation, not solved — most short/casual party-use clips won't trigger it, and this is a friends-only game, not a public product.

## 1. Unified track representation

`gs.songPair` changes from `{ id, label, normalUrl, imposterUrl }` (a `SONG_PAIRS` lookup) to `{ normal: TrackRef, imposter: TrackRef }`, where:

```
TrackRef = {
  sourceType: "builtin" | "upload" | "youtube",
  audioUrl?: string,      // builtin and upload
  videoId?: string,       // youtube
  startSeconds: number,   // host-set for youtube; always 0 for builtin/upload
}
```

`game:load-audio` (per active player, unchanged event name) now carries the player's own `TrackRef` directly instead of just a URL, so the client knows which adapter to use (Section 4) and what to load.

## 2. Per-player playback position

Today, `gs.playback.segmentStartPosition`/`pausedPosition` represent an absolute track position broadcast identically to every active player. Since a YouTube normal/imposter pair can have different start-seconds, this becomes: **a single shared elapsed-time timeline, with each player's own track start-second added at broadcast time.**

- `gs.playback.segmentStartPosition` / `pausedPosition` are reinterpreted as "elapsed ms since this round's playback began" — a shared, source-independent number, computed exactly as before (`computeElapsedMs`).
- `broadcastPlayAt(room, io, startAt, elapsedMs)` is the only function that changes: for each active player, it looks up their own track (`pid === gs.imposterId ? gs.songPair.imposter : gs.songPair.normal`), adds `track.startSeconds * 1000` to `elapsedMs`, and emits that as `position` in their individual `game:play-at`.
- `startAt` (the wall-clock sync instant) stays identical for every player in the broadcast — that's what keeps playback simultaneous. Only `position` becomes per-player.
- Built-in and uploaded tracks have `startSeconds: 0`, so this is a no-op for them — existing behavior for those two source types is unchanged byte-for-byte in effect.
- "Restart" now means "back to this player's own configured start-second" (`elapsedMs: 0`, base offset still applied), not literally position 0 of the underlying media.

## 3. Track-select UI & new events

Three tabs on the track-select screen, replacing today's flat pair list:

- **Built-in** — unchanged, today's `game:track-pairs` → `host:select-track-pair`.
- **YouTube** — two URL fields + two start-second number fields (normal, imposter). New event `host:select-youtube-pair {code, normal: {url, startSeconds}, imposter: {url, startSeconds}}`. The server extracts the video ID from the URL (supports `youtube.com/watch?v=`, `youtu.be/`, with or without an existing `&t=`/`?t=` param — any timestamp embedded in the URL is ignored; the explicit `startSeconds` field is the single source of truth) and builds two `TrackRef`s with `sourceType: "youtube"`.
- **Uploaded files** — lists the pool (`game:uploaded-files {files}`, requested via `host:list-uploaded-files {code}`) with checkboxes to pick 0/1/2 as normal/imposter, plus an upload control (Section 5). New event `host:select-upload-pair {code, normalFileId?, imposterFileId?}` — either ID may be omitted for random-fill from the pool. The server enforces the two resulting files are always different: this applies both when random-fill can't find a distinct second file (pool too small) and when the host explicitly submits the same ID for both slots — either case errors with `{error: "Need at least 2 different uploaded files to use this source."}` rather than silently substituting a built-in pair or allowing an identical pair.

All three paths converge on the same round-start logic already in `onSelectTrackPair` (round 1 imposter assignment, `freshRoundState`, `game:load-audio`/`game:started` emission) — only how `gs.songPair` gets built differs per source type.

## 4. Client-side audio source adapters

Two implementations behind one interface (`prepare(trackRef)`, `playAt(startAtMs, positionMs)`, `pauseAt(pauseAtMs)`):

- **HTML5 adapter**: today's existing `<audio>` element logic, unchanged, used for `builtin` and `upload` — uploaded files need zero new client playback code, since they're served at a URL through the exact same pipeline as built-in tracks.
- **YouTube adapter**: wraps one reused `YT.Player` instance (YouTube IFrame API), rendered into an off-screen container (`position:absolute; left:-9999px` — not `display:none`, which some browsers use to throttle/pause hidden iframes). On `game:load-audio` with `sourceType: "youtube"`, calls `cueVideoById({videoId, startSeconds})` (loads without playing) and only emits `player:audio-ready` once YouTube's API confirms the video is cued.

`game:play-at`/`game:pause-at` handlers branch on the loaded track's `sourceType`: HTML5 path unchanged (`audioEl.currentTime = position/1000; audioEl.play()`); YouTube path calls `seekTo(position/1000, true)` + `playVideo()`/`pauseVideo()` at the scheduled wall-clock instant via the same `setTimeout(delay)` pattern already in use.

**"I'm Ready" priming** (medium confidence — needs real multi-browser verification, not guaranteed): the existing tap-gesture pattern (`play()` then immediate `pause()`) is mirrored for the YouTube adapter within the same click handler, intended to satisfy autoplay-gesture requirements for the later programmatic `playVideo()` call. YouTube's iframe autoplay policy is less predictable across browsers than plain `<audio>` — this is the standard workaround, not a guarantee.

**Load failures** (bad/private/restricted video, or the IFrame API failing to load): surfaced as a status message on the player's own screen; `player:audio-ready` is simply never sent, so the round stalls at the ready-progress step (host sees the count stuck below total) rather than hanging silently or crashing. No new server-side error-reporting channel for this — consistent with the accepted, documented ad-risk limitation rather than building recovery machinery for a prototype.

## 5. Upload endpoint & storage

New dependency, justified: **`multer`** (the standard Express multipart-upload middleware) — handling multipart file upload safely without a library is real risk (manual multipart parsing), and this is the first feature needing binary file upload on this platform.

- `POST /api/upload-audio` — accepts one file (`.mp3`/`.mp4` extension, capped at 50MB), stores it under `server/uploads/<uuid>-<original-name>` (new directory, gitignored — never committed, mirrors `node_modules`), and returns `{id, originalName, url}`.
- Uploaded files are served via `express.static` at `/uploads/...`, mirroring the existing `/audio` static route exactly.
- Pool storage: an in-memory array (`uploadedFiles: [{id, originalName, url, uploadedAt}]`), **server-wide** (not per-room) and **persists across rooms until server restart** — consistent with the platform's existing all-in-memory `rooms` Map; no database introduced, no auto-cleanup logic beyond a restart clearing it.

## 6. Testing plan

Extends the existing pattern (Node's built-in test runner for pure logic, a live `socket.io-client` E2E script for server integration):

1. Unit: the per-player position formula (base offset + elapsed) for both a zero-offset and non-zero-offset track pair.
2. Unit: upload-pool selection logic — 0/1/2 explicit picks, random-fill for empty slots, "always two different files," and the insufficient-pool error path.
3. Unit: YouTube URL parsing (the supported formats, and confirming an embedded `&t=`/`?t=` param is ignored in favor of the explicit `startSeconds` field).
4. E2E: a full round using an uploaded-file pair end-to-end (upload two fixture files via the HTTP endpoint, select them, verify correct per-player `game:load-audio` payloads).
5. E2E: a full round using a YouTube pair with *different* start-seconds for normal vs. imposter, verifying each player's `game:play-at` carries their own track's correct computed position — verified structurally (payload shape/values), since the actual YouTube IFrame playback isn't exercisable by a headless socket script.
6. Explicitly out of scope for automated testing (same limitation as the round-elimination work): real YouTube IFrame playback behavior, autoplay-gesture reliability across browsers, and the ad-risk exposure — these need a manual multi-browser walkthrough.

# Find the Imposter — Round Elimination & Host Playback Control

## Context

The current prototype (`party-platform-full/party-game-platform/server`) plays
one round of "Find the Imposter": everyone votes once, the imposter is
revealed, game over. This spec redesigns it into a multi-round elimination
game (Mafia/Werewolf-style), adds host-selectable audio per round, and adds
host-driven playback controls (Play/Pause/Resume/Restart) in place of the
current fully-automatic synced start.

All changes are scoped to `server/games/findTheImposter.js` plus the specific
new socket events it needs in `index.js`, following the existing pattern where
each game module owns its own gameplay logic and the platform (`roomService.js`)
stays generic. No changes to the room/lobby system itself.

Out of scope for this spec (tracked as follow-up): letting the host paste a
YouTube URL + start-second as a per-round audio source instead of the built-in
local track pairs. That's a separate subsystem (embedding YouTube's IFrame
Player API, handling ad/buffering unreliability against the sync requirement)
and will get its own spec after this one ships. To avoid rework, the playback
control protocol in this spec (Section 4) is designed to be source-agnostic —
the server only ever broadcasts "play at timestamp X from position P" /
"pause at timestamp X," never touching how a client actually renders the
audio. A future YouTube-source client just needs to implement the same two
signals against the IFrame Player API instead of an `<audio>` element.

## 1. Round/elimination state machine

Replaces the current single-shot `loading → playing → voting → results` flow
in `room.gameState.phase`:

```
track-select → loading → playing → voting → round-results ─┬→ track-select (next round)
                                                              └→ game-over (end)
```

- **track-select**: host picks a track pair for this round (see Section 3).
  Selecting a pair immediately assigns audio to each active player and moves
  to `loading` — there is no separate "start round" click.
- **loading**: unchanged in spirit from today — each active player receives
  their own audio URL (imposter gets the imposter track) and taps "I'm Ready"
  to prime autoplay. Once all active players are ready, the host is notified
  (`game:all-ready`) and the **Play** button becomes available. Playback no
  longer auto-starts.
- **playing**: host-controlled via Play/Pause/Resume/Restart (Section 4).
- **voting**: each active player selects a target (another active player) or
  "skip," then must press a Confirm button to submit — selecting alone does
  not submit the vote. No time limit; the round simply waits until every
  active player has confirmed, since players may need real-life discussion
  time first.
- **round-results**: reveals whether anyone was eliminated and, if so,
  whether they were the imposter. Host presses "Next Round" to loop back to
  `track-select`, unless the game just ended.

## 2. Elimination & win rules

- **Majority rule**: a candidate (a player, or "skip") is only resolved if it
  gets strictly more than half of active players' votes. No majority → no one
  is eliminated, `round-results` shows "No one was eliminated this round,"
  and the game proceeds to the next round with the same active roster.
- **Imposter persistence**: assigned once, at round 1, from the players
  active at that time. Stays the same player for the entire game.
- **Win conditions**, checked immediately after a round resolves:
  1. Eliminated player *was* the imposter → game over, crew wins.
  2. Active player count drops to 2 → game over immediately, imposter wins
     (no further vote — a 2-way majority is meaningless).
  3. Otherwise → next round.
- **Eliminated players**: removed from voting and from receiving audio for
  all subsequent rounds. They still receive `game:round-results` and the
  final `game:results` as spectators.
- **Self-voting**: not allowed — a player's own id never appears in their own
  candidate list (server-side enforced, not just UI-hidden).
- **Disconnect mid-round**: existing `disconnect` handling in `index.js`
  already removes the player from `room.players`. This spec adds a hook so
  the game module also drops them from the active-vote denominator, so a
  majority can still resolve among whoever is left. This does not add
  reconnect support — that remains an existing, documented platform
  limitation, unchanged by this spec.
- **Minimum players**: unchanged (`meta.minPlayers = 3`), which guarantees at
  least one elimination round is possible before the 2-player end state.

## 3. Track-pair selection

- `game:track-pairs {pairs}` is sent to the host on entering `track-select`,
  listing the same built-in pairs available today (currently just one
  placeholder pair; adding more is a data change to `SONG_PAIRS`, not a
  design change).
- `host:select-track-pair {code, pairId}` — host's choice. Handles both
  round 1 (also assigns the imposter) and subsequent rounds (imposter
  unchanged) via the same handler; the game module distinguishes by whether
  `gameState.imposterId` is already set.

## 4. Host playback controls

Only players receive/play audio — the host never plays the track itself, it
only orchestrates. Controls reuse the existing "synced future timestamp"
buffering trick (today's ~1.5s buffer for the initial start):

- **Play** (`host:play-audio`): server picks `startAt = now + buffer`,
  broadcasts `game:play-at {startAt, position: 0}` to active players. Each
  client schedules seeking to position 0 and calling `play()` at `startAt`.
- **Pause** (`host:pause-audio`): server picks `pauseAt = now + buffer`,
  broadcasts `game:pause-at {pauseAt}`. Each client schedules `pause()` at
  that instant. Server derives and stores the elapsed track position at
  `pauseAt` from the last known start time — clients never need to report
  position back, since they've all been playing the same synced timeline.
- **Resume** (`host:resume-audio`): server picks a new `startAt`, broadcasts
  `game:play-at {startAt, position: pausedPosition}` (reuses the same event
  as Play, just with a non-zero position).
- **Restart** (`host:restart-audio`): identical to Play — new `startAt`,
  `position: 0` — just usable mid-round instead of only at the start.

Host UI: **Play** (before first play) → **Pause** / **Restart** (while
playing) → **Resume** / **Restart** (while paused). No auto-timer anywhere in
this flow; every transition is a host click.

## 5. Socket events summary

| Direction | Event | Notes |
|---|---|---|
| Host→Server | `host:select-track-pair {code, pairId}` | Starts the round |
| Host→Server | `host:play-audio` / `host:pause-audio` / `host:resume-audio` / `host:restart-audio` `{code}` | Playback control |
| Host→Server | `host:next-round {code}` | `round-results` → `track-select` |
| Player→Server | `player:vote {code, votedForId}` | `votedForId` may be `"skip"`; reused from today |
| Server→Host | `game:track-pairs {pairs}` | On entering `track-select` |
| Server→Host | `game:all-ready` | Replaces the old auto-play trigger |
| Server→Active players | `game:play-at {startAt, position}` | Play/Resume/Restart |
| Server→Active players | `game:pause-at {pauseAt}` | Pause |
| Server→All | `game:round-results {round, eliminated, wasImposter, voteTally, remainingActive}` | Per-round reveal |
| Server→All | `game:results {imposter, winner, results}` | Final reveal; `winner` is new (`"crew"` \| `"imposter"`) |

Existing events reused unchanged: `host:create-room`, `player:join-room`,
`host:select-game`, `player:audio-ready` (now triggers `game:all-ready` once
all active players are ready, instead of auto-starting), `host:reset-room`,
disconnect handling.

## 6. UI changes

**Player**: join → load/prime audio → "waiting for host to start
playback" → listening (no controls) → vote screen (pick a target or Skip,
then a Confirm button — selection alone doesn't submit) → round reveal → (if
eliminated) persistent spectator banner from then on → final reveal.

**Host**: lobby → track-select (pick a pair = starts the round, shows round
number and active player count) → ready-progress → Play → Pause/Restart
while playing, Resume/Restart while paused → read-only vote-progress →
round reveal + "Next Round" button → final reveal + "Play Again" (existing
`host:reset-room`).

## 7. Testing plan

Extend the existing live `socket.io-client`-driven E2E approach (no mocks —
same style used to verify the current prototype) into scripted multi-round
scenarios:

1. 4 players, round 1 resolves with no majority → verify game continues with
   all 4 still active.
2. Round 2 votes out a non-imposter → verify they receive no audio and can't
   vote in round 3.
3. Reaching exactly 2 active players → verify game auto-ends, imposter
   declared winner, no further vote round is offered.
4. Separate scenario: imposter voted out directly in round 1 → verify
   immediate crew-win end.
5. Playback controls: Play → Pause → Resume → Restart, asserting event
   payloads and that `position` is correctly threaded through.
6. Self-voting rejected server-side even if a malicious/buggy client sends it.
7. A player disconnecting mid-voting-round doesn't block majority resolution
   among the remaining active players.

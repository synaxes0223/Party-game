# Secret Mission Bingo — New Game

## Context

A slow-burn social-engineering game that runs across a whole party. At start, every player secretly receives **3 missions** ("get someone to teach you a TikTok dance move", "make two people argue about which state has the best food"). The host screen shows the **full anonymous list of missions in play** — everyone knows what to watch for, nobody knows whose is whose. Players complete missions in real life and claim them on their phone; players can also **accuse** others ("I think Wei Jian has the high-five mission") to bust missions and steal points. At the end of the night the host triggers the big reveal: every mission, who had it, what got claimed, what got busted, final scores.

Uses the prompt pipeline (`2026-07-12-prompt-pipeline-design.md`) for the mission pool (packs + custom + AI; player submissions **disabled** for this game — you'd recognize your own mission text, see §3). Build **last** of the four games: it needs the reconnect prerequisite below.

### Scope limitation (accepted)

The platform supports one active game per room. Secret Mission Bingo therefore occupies its room for the whole party — the intended usage is a dedicated room (host tab stays open on the TV or a spare device) while other games run in a *separate* room, or it's played standalone. Multi-game-per-room concurrency is explicitly out of scope.

## 1. Prerequisite: player reconnect (new platform capability)

Phones lock, mobile browsers suspend sockets, and this game runs for hours — without reconnect, every locked phone is a dead player. Current behavior: `disconnect` → `roomService.removePlayer` deletes the player. This must become game-aware:

- Add `meta.supportsReconnect = true` to this game (other games unchanged).
- **`index.js` disconnect handler**: if `room.gameId` resolves to a game with `supportsReconnect` and `room.gameState` exists, do **not** remove the player. Instead mark `player.connected = false` (new field, default `true` on join) and emit the usual `host:room-updated` / `room:player-list` (which now include `connected`). Empty-room cleanup: only delete the room when *all* players are disconnected **and** the host is gone.
- **Rejoin path**: `player:join-room` currently rejects when `room.state !== "lobby"`. Change `roomService.joinRoom`: if the room is in-progress, the selected game `supportsReconnect`, and a player record with the same nickname (case-insensitive) exists with `connected === false` → **reclaim**: re-key the `room.players` map entry to the new socketId, set `connected = true`, and return `{ room, reclaimedFrom: oldSocketId }`. `index.js` then calls the game's `onPlayerReconnected(room, io, oldSocketId, newSocketId)` so the game re-keys its own state and re-sends the player's private screen. Joining in-progress with an unknown nickname is still rejected.
- Player client: persist `{ code, nickname }` in `localStorage` and auto-attempt rejoin on page load / socket reconnect.

This is deliberately minimal (nickname-based, no auth token) — fine for a living-room game among friends. It is the riskiest chunk of the build; implement and test it before any game logic.

## 2. Meta

```js
const meta = {
  id: "secret-missions",
  name: "Secret Mission Bingo",
  description: "Everyone gets 3 secret real-life missions for the night. The big screen shows every mission in play — but not whose. Complete yours sneakily, catch your friends doing theirs.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
  usesPromptPipeline: true,
  supportsReconnect: true,
};
```

## 3. Game state & setup

```js
room.gameState = {
  phase: "in-play",           // in-play → game-over  (single long round)
  missions: [],               // [{ id, text, ownerId, status: "open"|"claimed"|"busted" }]
  scores: new Map(),          // playerId -> { nickname, score }
  accusationsLeft: new Map(), // playerId -> int, starts at 3
  promptState: { maxSpice: 1, usedIndexes: new Set(), queue: [] },
}
```

**Setup flow (host)**: host selects spice + optionally generates/approves AI missions or types custom ones, then clicks **Start Night** → `host:start-missions` `{ code }`. Server draws `3 × playerCount` distinct missions via the pipeline (`drawNext` repeatedly; if the eligible pool is smaller than needed, allow pack repeats across *different* players but never give one player duplicate texts), assigns 3 per player, shuffles the combined list for public display.

Player submissions (`player:submit-prompt`) are rejected for this game (`onPromptSubmitted` returns an error) — a player who wrote a mission would recognize it on the board and out its owner by elimination when it's assigned; not worth the leak.

Broadcasts:
- To each player privately: **`game:your-missions`** `{ missions: [{id, text, status}] }` (also re-sent on reconnect).
- To the room: **`game:mission-board`** `{ missions: [{id, text, status}], scores, accusationsLeft }` — the anonymous public board, re-broadcast after every state change. `ownerId` is **never** included while phase is `in-play`.

## 4. Actions during play

### Claim

**`player:claim-mission`** `{ code, missionId }` → must be the caller's own mission with status `open`. Sets `status: "claimed"`, +100 to owner (banked silently — the public board shows the mission as claimed and scores changing, which is itself information; that ambiguity is intended). Private ack `game:mission-update` to the owner; public `game:mission-board` re-broadcast.

False/hasty claims are a social problem, not a server problem — the end-of-night reveal shows every claim, and the room can shame liars. (Optionally the group agrees on a house rule: disputed claims get voided by the host — out of scope for v1.)

### Accuse

**`player:accuse`** `{ code, targetPlayerId, missionId }` → requires `accusationsLeft > 0` (decrement on every attempt), target ≠ self, mission status ≠ `busted`.

- **Hit** (mission's `ownerId === targetPlayerId`): mission `status: "busted"`. If it was `open`: accuser **+100**, mission dead (owner can no longer claim it). If it was already `claimed`: the owner's 100 transfers to the accuser (owner −100, accuser +100) — you can catch someone *after* the fact.
- **Miss**: accuser **−50**.

Broadcast **`game:accusation-result`** to the room: `{ accuserNickname, targetNickname, missionText, hit }` — accusations are public drama by design. Re-broadcast the board.

### End of night

**`host:end-game`** `{ code }` → phase `game-over`, `room.state = "results"`, emit **`game:results`**:

```js
{
  winners: [{ id, nickname, score }],           // max score, ties included
  reveal: [{ text, ownerNickname, status }],    // the full de-anonymized board
  scores: [...]                                  // sorted desc
}
```

Host screen walks the reveal list (this is the payoff moment — one mission per click via `host:next-reveal` is a nice-to-have; a single full-list screen is acceptable for v1).

## 5. Disconnect handling

With reconnect (§1) a disconnect is soft: player marked `connected: false`, missions and score untouched, board shows them dimmed. `onPlayerReconnected` re-keys `missions[].ownerId`, `scores`, `accusationsLeft` from old socketId to new, then re-sends `game:your-missions` and the current board. Only if the host ends the game does anything resolve.

## 6. Client UI

**Host**: setup screen (spice, AI/custom mission pool management, Start Night); the live board — mission list with status icons (open ⬜ / claimed ✅ / busted 💥), scoreboard, recent-events ticker (claims move on the board, accusations show as toasts); reveal screen.

**Player**: "your 3 missions" card list with per-mission CLAIM buttons; an ACCUSE flow (pick player → pick mission from public list → confirm, showing accusations left); public board view (scrollable); results screen. Because the game runs all night, the player page must survive tab-switching: on `visibilitychange`/reconnect, silently rejoin (§1) and request current state via **`player:sync`** `{ code }` → server re-sends `game:your-missions` + `game:mission-board`.

## 7. Testing plan

1. Unit `roomService.test.js` additions + `reconnect.test.js`: disconnect marks not removes (reconnect-capable game only); nickname reclaim re-keys the map; unknown nickname still rejected in-progress; room cleanup only when fully empty.
2. Unit `secretMissions.test.js`: setup deals 3 unique missions per player; claim rules (own/open only); accuse hit on open (bust + steal-nothing +100), hit on claimed (transfer), miss (−50), accusation budget; board payload never contains `ownerId` during play; reconnect re-keys ownership; results reveal correct.
3. E2E `e2e-secret-missions.js` (own port): host + 3 players, start, one claim, one hit accusation, one miss, **disconnect + rejoin one player socket and verify state survives**, end game, verify reveal.
4. Manual walkthrough with real phones including locking a phone for a minute — the reconnect path is the thing most likely to only break on real devices.

## Appendix — starter mission pack (`promptPacks.js["secret-missions"]`)

Missions must be completable in a living-room party, observable when they happen, and not require money or leaving. Copy verbatim.

```js
[
  // ---- spice 1: chill ----
  { text: "Get someone to teach you a dance move (any dance)", spice: 1 },
  { text: "Get two different people to high-five you within one minute", spice: 1 },
  { text: "Make someone say 'walao' (you can't say it first)", spice: 1 },
  { text: "Get someone to show you the last photo in their camera roll", spice: 1 },
  { text: "Make two people argue about which state has the best food", spice: 1 },
  { text: "Get someone to check the price of something on Shopee for you", spice: 1 },
  { text: "Convince someone to sing at least one full line of a song", spice: 1 },
  { text: "Take a group selfie where you're the only one not smiling", spice: 1 },
  { text: "Get someone to tell you their phone battery percentage", spice: 1 },
  { text: "Make someone laugh hard enough that they make a sound", spice: 1 },
  { text: "Get someone to agree that durian is overrated OR underrated (your pick)", spice: 1 },
  { text: "Borrow something from someone and return it within 10 minutes", spice: 1 },
  { text: "Get someone to guess your favourite drink — keep going until someone gets it", spice: 1 },
  { text: "Start a conversation about primary school with anyone", spice: 1 },
  { text: "Get someone to stretch or exercise with you", spice: 1 },
  { text: "Make someone check the weather forecast out loud", spice: 1 },
  { text: "Get three people to agree on the best mamak in town", spice: 1 },
  { text: "Get someone to say the name of their first pet", spice: 1 },
  { text: "Convince someone to swap seats with you", spice: 1 },
  { text: "Get someone to show you a meme they saved", spice: 1 },
  { text: "Compliment three different people on three different things", spice: 1 },
  { text: "Get someone to do a 'cheers' with you using non-matching drinks", spice: 1 },

  // ---- spice 2: spicy ----
  { text: "Get someone to tell you about their most recent date", spice: 2 },
  { text: "Get someone to admit the last time they cried", spice: 2 },
  { text: "Get someone to reveal their screen time for one app", spice: 2 },
  { text: "Make someone tell you a secret about a person NOT in this room", spice: 2 },
  { text: "Get someone to say one honest criticism of you, to your face", spice: 2 },
  { text: "Get someone to show you their most-played song this year", spice: 2 },
  { text: "Get two people to admit they've never actually watched a famous movie", spice: 2 },
  { text: "Get someone to tell you how much they spent on food delivery this month", spice: 2 },
  { text: "Get someone to admit a purchase they hid from family/partner", spice: 2 },
  { text: "Get someone to rank three people in this room by cooking skill, out loud", spice: 2 },
]
```

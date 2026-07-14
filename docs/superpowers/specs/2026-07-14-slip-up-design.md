# Slip-Up — New Game

## Context

This is the platform's third game, proposed by 'MY'. Each player is secretly given a word to avoid saying or an action to avoid doing; every other player (but not the owner) can see it and try to catch them slipping up. Unlike Find the Imposter and Word Wolf, this game does **not** reuse the elimination-voting logic in `imposterLogic.js` — there is no voting, no elimination, and no discrete rounds. Instead, the host acts as a continuous referee: they mark a player as "caught," that player loses a point and is immediately dealt a fresh word/action, and the session just keeps running until the host manually ends it.

## 1. Session flow

Host setup screen: pick which built-in entries to include (exclude toggles) and optionally add custom word/action entries, then **Start**. On start, the server deals one distinct entry to each active player and the game enters `active` phase — there is no ready-check and no round counter.

While `active`:
- Every player's screen shows every *other* player's current word/action, grouped by nickname, plus the live scoreboard. Their own screen shows only a placeholder ("keep playing — it's a secret!") and the live scoreboard.
- The host's referee screen lists every player, their current entry, and a **Caught!** button per player, plus the same live scoreboard.
- `host:mark-caught` for a target player: that player's catch count increments by 1, and they are immediately reassigned a new entry that no one else currently holds. Updated assignments (personalized per socket) and the updated scoreboard are broadcast to everyone. The caught player's own screen shows a brief "you got caught!" flash before their new word silently swaps in, so they never glimpse it during the flash.
- `host:end-game` moves the phase to `ended` and broadcasts final results, ranked ascending by catch count (fewest catches wins; ties are shown as tied, no tiebreaker).

There are no rounds, no voting, and no elimination — a single continuous session from start to host-triggered end.

## 2. Content pool & data model

New pure-logic module `slipUpLogic.js` (mirrors `wordPairLogic.js`'s pattern — no socket.io, no room state):

- `BUILTIN_ENTRIES` — a curated list of ~30-40 `{ id, type: "word" | "action", text }` objects baked into the module, e.g. `{ type: "word", text: "like" }`, `{ type: "action", text: "cross your arms" }`.
- `buildPool(excludedIds, customEntries)` — returns the built-in entries minus any the host excluded, plus the host's custom entries (validated non-empty, deduped case-insensitively against each other and against the built-ins). Returns `{ pool }` or `{ error }`.
- `dealAssignments(pool, playerIds)` — deals one entry per player without replacement (no two players start the session holding the same entry). Returns `{ error }` if `pool.length < playerIds.length`.
- `reassignOne(pool, currentlyHeldEntries)` — for a caught player, picks a random entry from `pool` that is not in `currentlyHeldEntries` (the *other* players' current entries). This is a "no two players holding the same entry at once" constraint, not a whole-session uniqueness constraint — an entry can be reused once whoever held it is no longer holding it. Returns `{ error }` only in the degenerate case where every pool entry is currently held by someone else (pool size ≤ player count).

## 3. Server module (`slipUp.js`)

New file, structured like `wordWolf.js` but with no shared elimination logic imported — this game's rules are entirely local to this module:

- `meta` — `{ id: "slip-up", name: "Slip-Up", minPlayers: 3, maxPlayers: 16, supportedModes: ["multiplayer"] }`, registered in `games/registry.js` alongside the other two.
- `onStartGame(room, io, { excludedIds, customEntries })` — builds the pool via `slipUpLogic.buildPool`, deals assignments via `dealAssignments` (surfacing a pool-too-small error to the host if it fails), sets `room.gameState = { phase: "active", pool, assignments: Map<playerId, entry>, catchCounts: Map<playerId, 0> }`, then broadcasts a **personalized** `game:your-view` to each player socket (everyone else's entry, omitting their own) and a `game:score-update` to the room.
- `onMarkCaught(room, io, { targetPlayerId })` — only valid in `active` phase; increments `catchCounts[targetPlayerId]`, calls `reassignOne` (surfacing its error to the host if the pool is exhausted), updates the assignments map, and re-broadcasts personalized `game:your-view` plus `game:score-update`.
- `onEndGame(room, io)` — sets phase to `ended`, broadcasts `game:final-results` with players sorted ascending by catch count.
- `onPlayerLeft(room, io, socketId)` — removes the player from `assignments` and `catchCounts`, same disconnect-handling shape as the other two games.

## 4. Client UI

**Host** — Setup screen (checklist of built-in entries with an exclude toggle each, plus text inputs to add custom word/action entries) → **Start**. Once active: a referee screen listing every player's nickname, their current entry, and a **Caught!** button, plus the live scoreboard. An **End Game** button ends the session and shows the final ranked results (reusing the same kind of ranked-list results screen the other games already have).

**Player** — A new "in play" screen showing a list of every other player's nickname + current word/action, your own live scoreboard row highlighted among the rest, and a brief "you got caught!" flash triggered by your own catch-count increasing, shown *before* your new entry is rendered so the flash itself never leaks the new word.

## 5. Testing plan

Same two-tier pattern as the other games:

1. Unit (`slipUpLogic.test.js`): `buildPool` correctly excludes/includes built-ins and merges custom entries with dedup; `dealAssignments` gives every player a distinct entry and errors when `pool.length < playerIds.length`; `reassignOne` never returns an entry in `currentlyHeldEntries` and errors only in the fully-exhausted case.
2. Unit (`slipUp.test.js`): `onStartGame` broadcasts correct per-player omit-self payloads; `onMarkCaught` increments the right player's count and reassigns without colliding with any other player's current entry; `onEndGame` produces a correctly ascending-sorted final ranking.
3. E2E (`e2e-slip-up.js`, following `e2e-rounds.js`'s pattern): start a game, mark several catches across different players, assert each player's personalized broadcast never contains their own current entry, assert live score updates reach all clients, end the game and check the final ranking.
4. Manual walkthrough: word/action text sizing on a phone screen, and confirming the "caught" flash never reveals the new word before it clears — this one is worth actually eyeballing since it's a UI-timing concern unit tests won't catch.

Edge cases to flag for implementation: `dealAssignments` failing at game start (host excluded too many built-ins without enough custom entries) must surface a host-visible error, not crash the room; `reassignOne`'s fully-exhausted case (pool size ≤ active player count) should likewise surface an error rather than silently duplicating a currently-held entry.

# Word Wolf — New Game

## Context

This is the platform's second game, added to prove out `games/registry.js` as an actual plug-in point rather than a single-game scaffold. Word Wolf reuses the room/lobby system and, critically, the **existing generic elimination-voting logic** (`imposterLogic.js`'s `resolveRound`/`checkGameEnd`, which take only player IDs and votes — no audio-specific data) unchanged. It deliberately drops everything in Find the Imposter that exists solely to serve synced audio: no ready-check, no play/pause/resume/restart, no playback-position math.

Everyone gets the same word except one player (the "wolf"), who gets a different-but-related word (e.g. normal `"Coffee"` / wolf `"Tea"`). Players discuss out loud without saying their word, then vote out who they think the wolf is, across multiple rounds, until the wolf is caught (crew wins) or only 2 active players remain (wolf wins) — identical win condition to Find the Imposter.

## 1. Round flow

A round starts the instant the host picks a word pair (auto or custom) — no ready-check (confirmed: nothing needs preloading on a player's device, so gating on readiness buys nothing here). Phase sequence:

`loading` → host clicks **Reveal Words** → server broadcasts each player's own word via `game:reveal-word` → phase becomes `revealed` → players discuss and vote (`player:vote`, unchanged event/signature) → first vote flips phase to `voting` → once all active players have voted, round resolves via the existing `resolveRound`/`checkGameEnd` → `round-results` → host advances to the next round, which returns to `loading`.

`onVote`, `onNextRound`, `onPlayerLeft` reuse the **exact same function signatures** as `findTheImposter.js` (`(room, io, socketId, votedForId)` etc.) — `index.js`'s `player:vote`, `host:next-round`, and disconnect handlers already look up the active game generically (`gameRegistry.getGame(room.gameId)`) and call these hooks without any audio-specific assumptions, so no changes are needed there. Only three new handlers are needed for Word Wolf's own actions: selecting an auto pair, selecting a custom pair, and revealing.

## 2. Word pair sources & data model

New pure-logic module `wordPairLogic.js` (mirrors `audioSourceLogic.js` — no socket.io, no room state):

- A built-in dataset of ~30-40 curated pairs (`{ normal: "Coffee", imposter: "Tea" }`, `{ normal: "Beach", imposter: "Desert" }`, etc.) baked into the module as a plain array.
- `pickAutoPair(pool, usedPairIndexes)` — picks a random pair not yet used this game session; once the pool is exhausted, resets and allows repeats (so a long game session never runs dry).
- `buildCustomPair(normalWord, imposterWord)` — validates both are non-empty, distinct (case-insensitive trim comparison), returns `{normal: {word}, imposter: {word}}` or `{error}`.

Both return the shape `{ sourceType: "auto" | "custom", word: string }` per player — the Word Wolf analog of `TrackRef`. `game:reveal-word` carries this directly, the same way `game:load-audio` carries a `TrackRef`.

`usedPairIndexes` (session-level "don't immediately repeat" tracking) lives on `room.gameState`, reset each time a new game starts — same lifecycle as the existing `eliminated` Set, not a new persistence mechanism.

## 3. Server module (`wordWolf.js`)

New file, structured like `findTheImposter.js` but noticeably smaller (no playback/position logic):

- `meta` — `{ id: "word-wolf", name: "Word Wolf", minPlayers: 3, maxPlayers: 16, ... }`, registered in `games/registry.js` alongside `findTheImposter` (the actual point of this feature).
- `onSelectAutoPair(room, io)` — picks a pair via `wordPairLogic.pickAutoPair`, starts the round (assigns wolf on round 1 / advances round counter thereafter, exactly mirroring `startRound` in the audio game minus the `game:load-audio`/ready-check parts).
- `onSelectCustomPair(room, io, { normalWord, imposterWord })` — validates via `buildCustomPair`, same round-start path.
- `onHostReveal(room, io)` — only valid in `loading` phase; broadcasts each active player's own word via `game:reveal-word`, sets phase to `revealed`.
- `onVote`, `onNextRound`, `onPlayerLeft` — same signatures as `findTheImposter.js`, built directly on `imposterLogic.resolveRound`/`checkGameEnd` (imported, not reimplemented).

## 4. Client UI

**Host** — a new track-select-equivalent screen with two tabs (no "Built-in list to pick from" tab, since auto-pairs aren't host-browsable):
- **Auto** — one button, "Start Round with Random Pair."
- **Custom** — two text inputs (normal word, wolf word) + a "Start Round" button.

Once a round starts, the host sees a "Reveal Words" button (replacing the audio game's ready-progress readout, since there's no ready-check) — clicking it fires `host:reveal-words`. Round-results and final-results screens are reused as-is (they're already game-agnostic: nickname, eliminated flag, vote tally).

**Player** — a new "your word" screen (`screen-word-reveal`, alongside the existing `screen-audio-ready`/`screen-playing`) that simply displays the word in large text on `game:reveal-word`, then transitions to the same voting screen already used by Find the Imposter (voting UI takes a player list and doesn't know about audio).

## 5. Testing plan

Same two-tier pattern as the audio-sources work:

1. Unit (`wordPairLogic.test.js`): auto-pick avoids repeats until pool exhaustion then resets; custom-pair validation (empty word, identical words, valid pair).
2. Unit (`wordWolf.test.js`): round start assigns a wolf and reveals correct per-player words for both auto and custom sources; `onHostReveal` only fires from `loading` phase; voting/elimination/win-condition tests can largely mirror the existing Find the Imposter test cases since they hit the same shared `imposterLogic` functions.
3. E2E (`e2e-word-wolf.js`, following `e2e-rounds.js`'s pattern): full multi-round game via `socket.io-client` — auto-pair round, custom-pair round, majority-vote elimination, wolf-caught win, and the "down to 2 players" win.
4. Manual walkthrough (same accepted limitation as before): actually reading the words on real devices — nothing here is technically risky enough to need it the way YouTube's IFrame playback did, but it's a cheap final check before calling the feature done.

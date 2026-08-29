# Blood on the Clocktower — Curated Character Library + Live-Play Polish (Design)

Date: 2026-08-28
Status: approved design, ready for implementation planning
Supplements: `docs/superpowers/specs/2026-08-27-blood-on-the-clocktower-design.md`
(the full 22-character design of record). This note records the **curated
subset** decision, the exact characters chosen, the decomposition into two
implementation plans, and the handful of mechanics the parent spec left at a
design-sketch level.

## 1. What this is

The Blood on the Clocktower vertical slice shipped 7 of the 22 Trouble Brewing
characters (Washerwoman, Empath, Soldier, Butler, Poisoner, Baron, Imp) plus
the host grimoire UI, the player phone UI, and durable sessions. This work adds
**9 more characters** and the **T7 live-play polish** the slice deferred.

At 5–9 players a single game only ever draws ~9–13 characters, so the full
22-character script is not required for good games. This is a deliberate
curated subset: the highest-value, lowest-friction characters, skipping the
ones whose machinery (Recluse/Spy misregistration, Scarlet Woman succession)
touches every `computeCandidates` or the win-condition core.

## 2. Characters added

| Character | Team | Night | Shape |
| --- | --- | --- | --- |
| Chef | Townsfolk | first | info: count of adjacent evil pairs |
| Investigator | Townsfolk | first | info: 1 of 2 players is a specific Minion (Washerwoman shape) |
| Librarian | Townsfolk | first | info: 1 of 2 is a specific Outsider, or "0 in play" |
| Monk | Townsfolk | other | choice: protect a player from the Demon tonight |
| Fortune Teller | Townsfolk | both | choice (select two) → yes/no "is either the Demon", with a red herring |
| Virgin | Townsfolk | — | day: first nomination of them may execute a Townsfolk nominator |
| Slayer | Townsfolk | — | day: once per game, public shot; kills the Demon |
| Saint | Outsider | — | executed by the town → evil wins |
| Drunk | Outsider | — | believes they are a Townsfolk; every ability malfunctions |

### Resulting character pool (16)

- **Townsfolk (10):** Washerwoman, Empath, Soldier, Chef, Investigator,
  Librarian, Monk, Fortune Teller, Virgin, Slayer
- **Outsiders (3):** Butler, Saint, Drunk
- **Minions (2):** Poisoner, Baron
- **Demon (1):** Imp

### Explicitly NOT in this work

Undertaker, Ravenkeeper, Mayor (Townsfolk); Recluse (Outsider); Spy, Scarlet
Woman (Minion). These remain future work against the parent spec. Consequences:

- No Demon-succession branch — killing the Imp always ends the game for good
  (the Imp's own star-pass on self-kill already works and stays).
- `dealRandom` supports 5–12 players (2 Minions available; 13–15 needs 3).
  Manual deal is unaffected. The parent spec's `minPlayers: 5, maxPlayers: 15`
  gate on the start button is unchanged; this is a random-deal limitation only,
  and is already true today.
- No misregistration: `grimoire.isEvilRegistering` stays "evil means evil".
  Chef / Investigator / Fortune Teller compute against true alignment.

## 3. Decomposition

### Plan A — Night engine + passive characters

Everything night-phase, plus the two characters resolved outside the day loop.

- **Night order.** Rewrite `nightOrder.js`'s `FIRST_NIGHT_ORDER` and
  `OTHER_NIGHTS_ORDER` for all 16 characters, transcribed against an
  authoritative Trouble Brewing night sheet. This is a verification-critical
  task — one misplaced step corrupts a game — and includes an explicit
  cross-check step, exactly as the vertical-slice plan's Task 9 did.
- **Chef** — first night only. `computeCandidates`: the true candidate is the
  number of *pairs of adjacent evil players* (walk `state.seats` in order,
  wrapping; a run of three evils is two pairs); false candidates are the other
  plausible counts. Payload is a number. `renderForPlayer`: "There are N pairs
  of evil players sitting next to each other."
- **Investigator / Librarian** — the working Washerwoman module's exact
  structure, retargeted: Investigator reveals a Minion, Librarian reveals an
  Outsider and additionally offers a "zero Outsiders in play" candidate (true
  when none are dealt).
- **Monk** — `requiresChoice: () => ({ type: "select-one-player" })` (not
  self). `applyChoice` adds a `protected` reminder to the target.
  `grimoire.isSafeFromDemon` gains a second clause: true if the seat carries a
  `protected` reminder (in addition to the existing sober-Soldier clause). Its
  generic name already anticipates this. `nightLoop.startNight` currently
  clears `poisoned` reminders each night; it will also clear `protected`.
  `red-herring` is NOT cleared (it is permanent).
- **Fortune Teller** — first use of `select-two-players`. On deal, a
  `red-herring` reminder is auto-assigned to one random good player who is not
  the Fortune Teller; the Storyteller can move it via the existing
  `host:botc-add-reminder` / `host:botc-remove-reminder` (governing principle:
  everything overridable). After the choice, `computeCandidates` returns two
  candidates — "yes" (truthful when either picked seat is the Demon or carries
  the red herring) and "no".
- **Drunk** — `night: { firstNight: false, otherNights: false }`; it never
  schedules itself. Dealing gains a Drunk path: assigning the Drunk requires a
  `believedCharacterId` (any Townsfolk; `dealRandom` picks one not in play).
  `dealManual` accepts an optional `believedCharacterId` per assignment;
  `grimoire.setCharacter` still forces `believedCharacterId = characterId` for
  every non-Drunk, so a dedicated path (e.g. `grimoire.setDrunk(seat,
  believedCharacterId)`) sets the split. `nightLoop` already schedules on
  `believedCharacterId` and `grimoire.isImpaired` already returns true when
  `characterId !== believedCharacterId`, so the believed module runs.
  Its `computeCandidates` still returns both true and false options (the
  same convention as a poisoned Washerwoman/Empath: the module offers, the
  Storyteller decides); the host night panel groups them true-vs-false so
  the Storyteller sends a false one for an impaired seat. Plan A verifies
  the scheduling end to end rather than building it.
- **Saint** — no night action. The win check gains an execution branch:
  when a seat is executed (`host:botc-execute`, and on-block execution) and
  that seat is a living good Saint, the verdict is
  `{ winner: "evil", reason: "The Saint was executed." }`.
  `winConditions.checkWinCondition` gains an optional context argument
  (`{ executedSeat }`) rather than inferring death cause from alive counts.
- Unit tests per character (`computeCandidates` truth/false coverage, the Monk
  kill interaction, the Drunk's false-only candidates, the Saint verdict).
  Extend `test/e2e-botc.js` with a scenario exercising a first-night
  Chef/Investigator/Librarian reveal, a Monk save, and a Saint execution loss.

### Plan B — Day drama + live-play polish

Everything day-phase: the two interactive day characters and all of T7.

- **Virgin** — in `voting.startNomination`, if the nominee is a Virgin whose
  ability is unused, the nomination **pauses**: the engine records the prompt
  in `publicStateView.day.pendingVirgin` (state-driven, so it survives a host
  refresh — a one-shot event would not), carrying the nominator's current
  registered team. The app never auto-executes — whether the nominator counts
  as a Townsfolk and whether the Virgin is drunk/poisoned are Storyteller
  judgments (parent spec §7). `host:botc-virgin-resolve { execute, proceed }`
  resolves it: on `execute`, the nominator dies and a `used` reminder is added
  to the Virgin; on `proceed`, the nomination then goes to a vote, otherwise
  it is dropped. (Executing the nominator drops the nomination — no vote is
  ever led by a dead nominator.)
- **Slayer** — valid only in `day-discussion`, once per game (tracked by a
  `used` reminder on the Slayer's seat). `host:botc-slayer-shot` (the
  Storyteller enters the public shot) records `publicStateView.day.pendingSlayer`
  (state-driven, survives a host refresh), then `host:botc-slayer-resolve
  { killed }` is the Storyteller's ruling — because a drunk/poisoned Slayer does
  nothing and that is the Storyteller's call. The outcome broadcasts to the
  whole room: `game:botc-slayer-result { shooterSeatId, targetSeatId, killed }`
  (the shot is public theatre). A win check runs after a kill. A player
  self-service `player:botc-slayer-shot` is deferred (see Self-Review).
- **Vote timers** — `state.day.voteTimerMs`, default `15000`, `0` disables;
  set via `host:botc-set-vote-timer { ms }`. When `maybePromptVoteTurn` lights
  up a seat, `index.js` arms a `setTimeout`; on expiry it records that voter as
  **pass** and advances the nomination. The handle is stored on `room` (the
  pattern `passTheBomb.js` uses for `fuseTimeout`) so `host:reset-room` and the
  disconnect handler clear it; it is also cleared on every manual vote and when
  the nomination resolves. `host:botc-skip-voter` lets the Storyteller pass the
  current voter immediately.
- **Verbal mode** —
  - *Global:* `host:botc-set-verbal { verbal }`. While on, no "your turn to
    vote" prompts are pushed to any phone and vote timers are suspended; the
    Storyteller enters every vote (`host:botc-vote`) and every night reveal
    manually.
  - *Per-seat:* `host:botc-set-seat-verbal { seatId, verbal }` sets
    `seat.verbal`. That seat is skipped by vote prompts and timers; the
    Storyteller acts for it. Covers a single dead or absent phone.
  - *Night:* `host:botc-night-candidate` gains an optional `verbal: true` that
    picks and logs the candidate but skips the `io.to(seat).emit` push.
- **infoLog** — populated whenever a reveal is chosen (the first-night info
  Townsfolk, the Fortune Teller and Empath each night, and any
  `host:botc-night-candidate` pick): `{ night, seatId, characterId, text,
  truthful }`. Player-driven choices (Poisoner, Monk, Imp, Butler) reveal no
  information and log nothing. `publicStateView` gains `infoLog`; the host
  grimoire renders it as a collapsible sidebar panel, grouped by seat, so the
  Storyteller can see what they have already said before choosing the next
  reveal.
- Unit tests: Virgin trigger/no-trigger and once-only, Slayer hit/miss/spent,
  the vote-timer pass path, infoLog population. Extend `test/e2e-botc.js` with
  a day scenario: a Virgin nomination executes the nominator, a Slayer shot
  kills the Demon (ending the game), and a vote proceeds past a seat whose
  timer expired.

## 4. Constraints (inherited)

- Working directory: `party-platform-full/party-game-platform/server/`.
- No new runtime dependencies; the deployment runs offline under Termux.
- No disk persistence.
- The 7 existing characters, durable sessions, and both botc UIs keep passing
  every test. Baseline: 415 unit tests, all `test/e2e-*.js` scripts.
- Do not delete, skip, or comment out an existing test to make a change pass.
- Match each file's existing line-ending convention; do not reformat whole
  files.
- Character-facing text is written fresh and kept short; no official art or
  Almanac prose.
- New `host:botc-*` / `player:botc-*` events are additive — every existing
  event keeps working unchanged (governing principle: the grimoire is always
  manually overridable, and player self-service never replaces the
  Storyteller's ability to act on a player's behalf).

## 5. Out of scope

- The 6 deferred characters (§2) and Demon succession.
- Scripts other than Trouble Brewing.
- Circular grimoire layout; guided mode for a first-time Storyteller.
- Persisting game state to disk.

# Blood on the Clocktower — Storyteller Assistant (Design)

Date: 2026-08-27 (revised after cold review)
Status: approved design, ready for implementation planning
Scope: the **Trouble Brewing** script only (22 characters), calibrated for 5–9 players

## 1. What this is

A digital Blood on the Clocktower for the existing party-game platform. It is
**not** an automated referee. A human Storyteller runs the game; the app is
their grimoire, night-order prompter, and information courier.

Four decisions frame everything below:

1. **Human Storyteller.** The app advises; the Storyteller decides.
   Full automation is explicitly out of scope, revisitable later.
2. **Phone night.** Nobody closes their eyes. The Storyteller steps through the
   night order on the host screen and pushes information to individual player
   phones, which report a read receipt back.
3. **Smart assistant.** The app understands each character's ability well
   enough to compute the *legal* information options — true and false — and
   offers them for the Storyteller to pick from.
4. **One regular Storyteller, who is an expert.** The host UI is tuned for
   information density and speed, not for discoverability. No tutorial text;
   one-line character hints with full ability text available in a collapsed
   layer. Common actions (add/remove reminder, mark poisoned, confirm death,
   advance the night) are reachable in one tap. The cost — a first-time
   Storyteller borrowing the app will struggle — is accepted; a guided mode is
   out of scope but not architecturally excluded.

The Storyteller is the room host and is not a player, which matches how the
platform already separates host and player screens.

Target size is **5–9 players** (so 6–10 people present). Trouble Brewing's
distribution gives exactly one Minion and one Demon anywhere in that range —
a second Minion first appears at 10 players — so the first-night "Minions learn
each other" step degenerates to "the sole Minion learns the Demon". This
shrinks the UI density problem (nine seats fit one phone screen, which is what
justifies the list layout in §5) but **does not shrink the character work**: all
four Minions must still be implemented because a different one is chosen each
game.

Content note: game mechanics are implemented from the rules; official character
art and Almanac prose are not reproduced. Character hint text is written fresh
and kept short.

## 2. Prerequisite: durable sessions

**This work lands before Blood on the Clocktower and is not part of it.**

The platform currently identifies a player by `socket.id` (`roomService.js:52`),
deletes players from the room on disconnect (`roomService.js:56-64`), refuses
any join once `room.state !== "lobby"` (`roomService.js:42`), and deletes the
entire room when the host disconnects (`index.js:357-359`). Everything is held
in an in-memory `Map` (`roomService.js:7`).

For a five-minute round of Find the Imposter this is tolerable. Blood on the
Clocktower runs 60–90 minutes, and the deployment is the worst case for it: the
server runs on an Android phone under Termux, with the host page open in a
browser on that same phone. Android backgrounding that tab drops the host
socket and destroys 80 minutes of game. A player taking a phone call loses their
seat permanently and cannot rejoin.

The agreed minimum, scoped as its own plan:

- **Persistent player identity** — a token generated client-side and kept in
  `localStorage`, replacing `socket.id` as the identity of record. Reconnection
  is impossible without this, so it is not optional even in the minimal set.
- **Mid-game rejoin** — a returning token reclaims its existing seat rather
  than being refused by the `state !== "lobby"` gate.
- **Host disconnect becomes a grace period** rather than immediate room
  deletion; a returning host token reclaims host status.

Explicitly **not** in the minimum: writing state to disk. If the Node process
itself is killed, the game is lost. This makes `termux-wake-lock` and disabling
battery optimisation (see `docs/hosting-on-android.md`) load-bearing rather than
advisory.

This work also repairs Avalon, which has the same fragility over a
twenty-minute game.

## 3. Codebase integration

Blood on the Clocktower is larger than the platform's four existing games
combined (the biggest, `games/avalon.js`, is 410 lines). It therefore does
**not** follow the existing "one flat module plus socket wiring in
`server/index.js`" pattern, which would turn `index.js` into an unmaintainable
switchboard.

### Server

```
games/botc/
  index.js          // { meta, attach, onPlayerLeft }
  state.js          // room state shape and transitions
  nightOrder.js     // first-night and other-night order tables (data)
  grimoire.js       // seat and reminder manipulation
  voting.js         // nomination and vote rules
  characters/       // one file per character
  steps/            // pseudo-steps: minion-info, demon-info
```

The module exports exactly three things, because the platform requires all
three:

- `meta` — `registry.js:13-16` keys games by `game.meta.id` and `index.js:146`
  emits it to clients; shape follows `avalon.js:13-21`, with
  `minPlayers: 5, maxPlayers: 15`.
- `attach(io, socket, ctx)` — called from inside the existing per-connection
  closure (`index.js:105`), because a socket only exists there. `ctx` supplies
  `{ roomService, gameRegistry }`.
- `onPlayerLeft(room, io, playerId)` — invoked by `index.js:345`.

State lives in `room.gameState`, consistent with the platform (and therefore
correctly wiped by `host:reset-room`, `index.js:288-298`). The game starts on
`host:botc-start`, mirroring `host:avalon-start` (`index.js:230`); there is no
generic start event to reuse.

The four existing games are not modified. This introduces a "a game owns its own
wiring" convention that future games can adopt, without a risky up-front
refactor of working code.

### Front end

`public/host/host.js` is 866 lines of flat script with a hardcoded screens map
(`host.js:10-22`), `public/player/player.js` is 620 lines, and there is no
module system or build step. Adding a grimoire to those files directly is not
viable.

Blood on the Clocktower's UI therefore uses **native browser ES modules** —
`<script type="module">`, supported by every browser that can run the existing
player page, requiring no bundler and adding no external dependency (which the
offline deployment forbids anyway):

```
public/host/botc/    // grimoire, night panel, day panel
public/player/botc/  // role card, night prompt, vote prompt
```

Existing front-end files are untouched.

Small, focused files are a deliberate choice: edits are more reliable in files
that can be held in context whole.

## 4. State model

`games/botc/state.js` holds one room's complete position. Seats are an
**ordered array** because Empath, Chef, Fortune Teller and the voting order all
depend on adjacency.

```js
{
  phase: "setup" | "first-night" | "day-discussion" | "nomination"
       | "voting" | "dusk" | "night" | "ended",
  dayNumber: 1,
  seats: [{
    seatId,                // stable, independent of player identity
    playerToken, nickname, // token, not socket.id (see §2)
    characterId,           // the truth
    believedCharacterId,   // what the player thinks they are
    alignment: "good" | "evil",
    alive: true,
    usedDeadVote: false,
    reminders: [{
      id,
      kind: "poisoned" | "protected" | "red-herring" | "used" | "custom",
      sourceCharacterId,
      label
    }]
  }],
  nightPointer: { orderIndex, stepId },   // character id OR pseudo-step id
  day: {
    nominationsMade: [seatId],       // one nomination per player per day
    nominationsReceived: [seatId],   // one nomination of each player per day
    currentNomination: { nominatorSeatId, nomineeSeatId, votes: [seatId],
                         currentVoterSeatId } | null,
    onBlock: { seatId, votes } | null
  },
  ended: { winner: "good" | "evil", reason } | null,
  infoLog: [{ night, seatId, characterId, text, truthful }]
}
```

Why the non-obvious parts exist:

- **`believedCharacterId` separate from `characterId`** — the Drunk is an
  Outsider who believes they are a Townsfolk. Their phone must show the
  believed character while the grimoire shows the truth, and every piece of
  information they receive must be false. Without two fields the Drunk cannot
  be implemented. §5 explains how this drives night scheduling.
- **`alignment` is mutable** — the Scarlet Woman becomes the Demon; the Recluse
  registers as evil to some abilities. Alignment is not a fixed property of a
  character.
- **`reminders` are the game's working memory**, not UI decoration, and they
  carry a **typed `kind`** so that `computeCandidates` can recognise them
  programmatically. `grimoire.js` exposes `isPoisoned(seat)` and
  `isImpaired(seat)` (poisoned *or* the Drunk), which every character uses
  rather than re-deriving.
- **`nightPointer.stepId`** rather than a character id, because the first
  night's pseudo-steps belong to no character (§5).
- **`infoLog` serves the live game, not the post-mortem.** The Storyteller's
  most common mistake is contradicting information they gave on an earlier
  night. The log is displayed while choosing what to send. It joins to seats on
  `seatId`.
- **`ended`** carries the winner explicitly; §6's win conditions are Storyteller
  prompts, so the resulting verdict must be recorded somewhere the e2e tests and
  the results screen can read. On end, `room.state` is set to `"results"`,
  matching `avalon.js:287,326,378`.

**Governing principle: the grimoire is always manually overridable.** Any seat's
character, alignment, life state and reminders can be edited at any time.
Everything the app computes is a suggestion. This has no exceptions —
Storyteller discretion is the game.

## 5. Night flow

### Order is data

`nightOrder.js` exports two tables, first night and other nights. Entries are
characters or **pseudo-steps** — the first night's "the Minion learns the Demon"
and "the Demon learns the Minion plus three not-in-play good characters as
bluffs" belong to no single character. Pseudo-steps live in `steps/` and
implement the same contract as characters; the bluff step computes three good
characters absent from play.

The exact official order will be transcribed from the official night sheet
during implementation rather than written from memory; one misplaced step
corrupts a whole game.

### Scheduling runs on believed characters, not real ones

Steps auto-skip when the character is not in play, is dead, or has spent a
once-per-game ability. Applied naively this **breaks the Drunk**: a Drunk who
believes they are the Empath must be woken every night, yet the Empath is not
in play.

The rule is therefore: **night scheduling iterates `believedCharacterId`, and
the module that runs is the believed character's module.** For a seat whose
`characterId !== believedCharacterId`, `isImpaired()` is true and only false
candidates are offered. The Drunk character itself has no night step.

Skipping is only ever the default; the Storyteller can wake anyone at any time.

### Character module contract

Information-only characters need one method. Characters that *choose* a target —
Fortune Teller, Monk, Poisoner, Butler, Imp — need two more, so the contract is
three-phase:

```js
// games/botc/characters/fortuneTeller.js
module.exports = {
  id: "fortuneTeller",
  team: "townsfolk",
  night: { firstNight: true, otherNights: true },

  requiresChoice(state, seat) → { type: "select-two-players" } | null,
  applyChoice(state, seat, choice) → state mutations,
  computeCandidates(state, seat) → [{ id, label, truthful, payload }],
  renderForPlayer(payload) → "Yes — one of them is the Demon",
};
```

The Fortune Teller shows why the phases are separate: the player picks two
players first, and only then can the app compute the true yes/no answer and its
false counterpart. The Poisoner and Monk use `applyChoice` to write a typed
reminder and return no candidates at all.

The intelligence comes from this shared interface, not from bespoke logic per
character. A character file only answers "what is legal here".

### Worked example: the Washerwoman

The Washerwoman learns that one of two shown players is a specific Townsfolk.
The app produces:

- **True options** — for every in-play Townsfolk, paired with each possible
  decoy player.
- **False options** — any two players with any Townsfolk character, *including
  characters not in play*. These are the most useful lies because the player
  cannot disprove them by elimination. They surface automatically when
  `isImpaired(seat)`.
- **Registration variants** — the Recluse may register as a Minion, the Spy as
  a Townsfolk, producing differently-legal readings of the same pair. Each is
  offered and labelled.

A nine-player Washerwoman yields dozens of candidates, so the UI groups them by
which character is revealed and offers a "pick a true one at random" button.
Nobody wants to scroll a list mid-party.

### Rhythm of one step

Storyteller taps Next → host shows the current step, and its choice prompt if it
has one → the choice is made → host shows candidates → Storyteller picks one →
it is pushed to that player's phone → player taps Acknowledged → Storyteller
sees the receipt → Next.

Two realities to handle: a player whose phone is dead or disconnected can be
marked "told verbally" so the flow continues; and **read receipts are visible
only to the Storyteller** — the greatest risk of a phone night is information
leaking through who is visibly being woken.

## 6. Grimoire (host screen)

### Layout: list first, no circle

The physical grimoire is a ring of tokens, but the host device is likely the
phone running the server. A circular layout on a narrow screen compresses every
seat into an untappable dot. **An ordered top-to-bottom list preserves adjacency
just as faithfully**, provided the wrap-around is drawn explicitly, and at the
target size of 5–9 seats the whole circle fits one phone screen. A circular
layout on wide screens is a later enhancement, not part of version one.

```
1  Alice      Empath                alive
   reminders: Poisoned (Poisoner)
2  Bob        Drunk -> believes Chef  alive
3  Carol      Imp            evil    alive
   reminders: Killed tonight
4  Dave       Soldier               dead, dead vote unused
       ^ seats 1 and 4 are adjacent
```

`Drunk -> believes Chef` is deliberate: the Storyteller must see the truth and
the player's belief simultaneously, because every piece of information sent to
that seat must be framed as the Chef's yet be false.

### Seat order

The platform records join order only (`roomService.js:52`), which will not match
the physical circle people sit in. The Storyteller arranges seat order by
dragging rows on the setup screen before the first night, and can reorder later.
Everything adjacency-dependent — Empath, Chef, Fortune Teller, and the voting
sequence — reads this order.

### Setup and dealing

Character distribution is determined by player count, and **the Baron modifies
it** (+2 Outsiders, −2 Townsfolk). The working table (to be checked against the
rulebook during implementation) is:

| Players | Townsfolk | Outsiders | Minions | Demon |
| --- | --- | --- | --- | --- |
| 5 | 3 | 0 | 1 | 1 |
| 6 | 3 | 1 | 1 | 1 |
| 7 | 5 | 0 | 1 | 1 |
| 8 | 5 | 1 | 1 | 1 |
| 9 | 5 | 2 | 1 | 1 |
| 10 | 7 | 0 | 2 | 1 |
| 11 | 7 | 1 | 2 | 1 |
| 12 | 7 | 2 | 2 | 1 |
| 13 | 9 | 0 | 3 | 1 |
| 14 | 9 | 1 | 3 | 1 |
| 15 | 9 | 2 | 3 | 1 |

The full 5–15 table is stored even though 5–9 is the tuned range, because it is
just data. The app computes the required distribution, shows whether the chosen
set matches, and warns when it does not — but never blocks. This "warn, never
block" applies to *distribution*; the platform's own `minPlayers`/`maxPlayers`
gate on the start button (`avalon.js:18-19`, `host.js:161-180`) still applies and
is set to 5–15.

Both random dealing (respecting the distribution) and manual assignment are
offered. Assigning the Drunk forces the Storyteller to also pick the believed
Townsfolk, since the Drunk cannot function without it.

### Reminder tokens

Each character carries its standard typed tokens (Poisoner's `poisoned`, Monk's
`protected`, Undertaker's `used`), plus free-text `custom` tokens. Tapping a
seat adds or removes them.

### Two practical requirements

- **Every field is manually overridable** — the §4 principle realised in the UI.
- **The host screen is permanently secret.** One glance from a passing player
  ruins the game, so a large Cover button is always present: one tap blanks the
  screen, another restores it. No password — the party needs speed.

## 7. Day: nomination and execution

### Voting is sequential, not simultaneous

Blood on the Clocktower's vote is theatre with strategy inside it: starting to
the nominee's left and proceeding clockwise, each player declares in turn, and
**later voters watch the count climb before deciding**. Collecting private
simultaneous votes and revealing them at once would destroy that.

The app lights up one phone at a time in seating order while everyone watches the
running tally on the host screen. "To the nominee's left" means the next seat
clockwise from the nominee; the nominee votes last. Dead players holding an
unspent ghost vote are in the sequence.

```
Nomination: Dave (4) -> Carol (3)          7 alive, 4 votes required
Order: 4, 5, 6, 7, 1, 2, 3

 4 Dave   voted (1)
 5 Eve    voted (2)
 6 Frank  passed
 7 Grace  voted (3)
 1 Alice  voted (4)   <- threshold reached
 2 Bob    passed
 3 Carol  passed      (the nominee votes last)

 Carol goes on the block with 4 votes.
```

### Keeping the sequence moving

One locked or dropped phone must not stall the whole vote, so each voter has a
Storyteller-configurable timer (default 15 seconds) after which they are
recorded as passing. The Storyteller can additionally force-skip the current
voter or cast on their behalf. Verbal mode is available both globally and for a
single voter.

### Rules the app enforces

These are the ones Storytellers most often get wrong, and getting them wrong
changes who wins:

- One nomination per player per day, and one nomination *of* each player per
  day — the buttons lock out violations.
- A dead player has exactly one ghost vote for the whole game; it greys out
  permanently once spent.
- **`required = max(ceil(alive / 2), currentHighest + 1)`**. Ghost votes count
  toward the tally but dead players are not in the `alive` denominator. A tie
  with the current highest puts nobody on the block and removes whoever was
  already there.

That last rule is the most commonly misplayed, so the host screen permanently
displays who is on the block and with how many votes.

### The Virgin: prompt, never automatic

When a Townsfolk nominates the Virgin, the nominator is executed immediately.
Two preconditions are not the app's to judge: whether the nominator counts as a
Townsfolk (a Recluse may register as a Minion) and whether the Virgin is drunk
or poisoned. The app therefore prompts — "the Virgin was nominated; nominator
Dave currently registers as a Townsfolk — trigger?" — and acts only on
confirmation.

### Dusk

The player on the block is executed on the Storyteller's confirmation. The
Mayor's "three alive and no execution means good wins" is likewise a prompt, not
an automatic verdict. Confirming any win condition writes `ended` and sets
`room.state = "results"`.

## 8. Testing

**Pure logic unit tests** (`node --test`, matching the existing convention)
carry most of the weight: distribution maths and the Baron modifier, vote
threshold and tie rules, night-order scheduling including the Drunk's believed
character, and **each character's `computeCandidates`** — 22 characters means 22
test groups, the bulk of the suite.

**End-to-end tests** (socket.io-client, matching `test/e2e-*.js`) cover:

- A full game: first-night setup, information delivery, nomination and
  execution, night kill, Demon executed, `ended.winner === "good"`
- Scarlet Woman succession: the Imp is executed with 5+ alive, the Scarlet Woman
  becomes the Demon, play continues
- The Drunk: their information always comes from the false candidate set, and
  their believed character's night step still fires
- Poisoning: a `poisoned` reminder makes false candidates surface automatically
- A tied vote executes nobody and clears the block
- Reconnection: a player disconnects mid-game and rejoins with their token,
  reclaiming the same `seatId` with reminders and life state intact

**Not automatable**: the Storyteller's ergonomics and the pace of a phone night.
Those require a real game with real people, and the automated suite will not be
described as covering them.

Invariant to pin down: **when `isImpaired(seat)` is false and a legal true
option exists, `computeCandidates` must return at least one truthful
candidate.** False candidates expand automatically when impaired and stay
collapsed but reachable otherwise, because Recluse and Spy registrations produce
true information that looks false.

## 9. Implementation stages

| Stage | Content |
| --- | --- |
| T0 | **Prerequisite (separate plan):** durable sessions per §2 — token identity, mid-game rejoin, host grace period |
| T1 | `state.js`, grimoire seat list, seat reordering, manual override (no abilities yet) |
| T2 | Setup and dealing: distribution table, Baron modifier, Drunk's two fields |
| T3 | `nightOrder.js` and the night loop: pseudo-steps, believed-character scheduling, choice phase, read receipts — proven with two or three characters |
| T4 | **The 22 character modules**, in batches: information Townsfolk, then Minions and Demon, then the interactive ones (Virgin, Slayer, Ravenkeeper) |
| T5 | Day phase: nomination, sequential voting, timers |
| T6 | Win conditions: Scarlet Woman succession, Mayor, Demon death, `ended` |
| T7 | Live-play practicalities: cover button, verbal mode, `infoLog` sidebar |

T4 is the bulk. Once T1–T3 are proven, the remaining characters are steady
repetitive work.

Because a full run of T1–T7 is too large for one implementation plan, the work
is split in two: a **vertical slice** (T1–T3, T5–T6 with only the characters
needed to finish a game — Imp, Poisoner, Baron, Washerwoman, Empath, Soldier,
Butler) so a real game can be played and the character interface validated
early, then the **character library** (the remaining 15 characters plus T7).
Interface flaws surface at the seventh character rather than the twenty-second.

Prerequisite before implementation: transcribe the official night order sheet
and verify the distribution table against the rulebook.

## 10. Explicitly out of scope for version one

- Scripts other than Trouble Brewing
- Automated Storyteller decisions
- Persisting game state to disk (see §2 — the process dying loses the game)
- Circular grimoire layout on wide screens
- A guided mode for a first-time Storyteller
- Homebrew or custom character authoring

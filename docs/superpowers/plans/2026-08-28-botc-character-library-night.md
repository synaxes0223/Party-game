# Blood on the Clocktower — Curated Character Library (Night Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six night-phase Trouble Brewing characters (Chef, Investigator, Librarian, Monk, Fortune Teller, Drunk) plus the passive Saint and its win condition to the existing Blood on the Clocktower module, so a Storyteller can run a game with a 16-character pool.

**Architecture:** Every new character is a module under `games/botc/characters/` implementing the established four-method contract (`requiresChoice` / `applyChoice` / `computeCandidates` / `renderForPlayer`), registered in `games/botc/characters/index.js`, and scheduled by `games/botc/nightOrder.js`. Three characters need a small amount of shared plumbing: Monk extends `grimoire.isSafeFromDemon` and `nightLoop`'s per-night reminder cleanup; the Fortune Teller introduces a `select-two-players` choice type (host + player night-choice UI) and a `red-herring` reminder assigned at deal time; the Drunk needs a split-identity deal path; the Saint needs `winConditions.checkWinCondition` to accept an execution context. No existing character, the durable-session layer, or the day-phase code changes.

**Tech Stack:** Node.js (CommonJS), `node:test` for unit tests, `socket.io-client` for the end-to-end script, native browser ES modules (no bundler) for the two small UI touches. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-botc-character-library-curated-design.md` §2–§3 (Plan A), which supplements `docs/superpowers/specs/2026-08-27-blood-on-the-clocktower-design.md` §§4–5, §8.

## Global Constraints

- Working directory for every command: `party-platform-full/party-game-platform/server/`.
- No new runtime dependencies. The deployment runs offline on an Android phone under Termux.
- No disk persistence.
- Baseline before starting: **415 unit tests pass**, and every `test/e2e-*.js` script passes. Do not regress this.
- Do not delete, skip, or comment out an existing test to make a change pass.
- Source files have mixed CRLF/LF line endings. Match the file you are editing; do not reformat whole files. New files may use LF consistently.
- Character ids are plain lowercase strings, except multi-word names which are camelCase (`fortuneTeller`), matching the parent spec's own example. Once a task introduces an id, keep it stable — it is a map key and is emitted to clients.
- Character-facing text (`renderForPlayer` strings, labels) is written fresh and kept short. No official art or Almanac prose.
- New character modules follow the exact structure of `games/botc/characters/washerwoman.js` (info character) or `games/botc/characters/poisoner.js` (choice character).
- Alignment always follows team via `dealing.alignmentForTeam` — never set separately.
- Commit after every task (every task ends with a commit step).

---

## File Structure

**New files:**
- `games/botc/characters/chef.js` — Chef: count of adjacent evil pairs (first night)
- `games/botc/characters/investigator.js` — Investigator: 1 of 2 is a specific Minion (first night)
- `games/botc/characters/librarian.js` — Librarian: 1 of 2 is a specific Outsider, or none in play (first night)
- `games/botc/characters/monk.js` — Monk: protect a player from the Demon (other nights)
- `games/botc/characters/fortuneTeller.js` — Fortune Teller: pick two, learn if either is the Demon (every night)
- `games/botc/characters/saint.js` — Saint: passive; executed by the town → evil wins
- `games/botc/characters/drunk.js` — Drunk: passive marker; no night step
- `test/botc-chef.test.js`, `test/botc-investigator.test.js`, `test/botc-librarian.test.js`, `test/botc-monk.test.js`, `test/botc-fortuneTeller.test.js`, `test/botc-saint.test.js`, `test/botc-drunk.test.js` — one unit-test file per character
- `test/botc-nightOrder.test.js` — night-order table structural checks

**Modified files:**
- `games/botc/nightOrder.js` — full 16-character first-night / other-nights order
- `games/botc/characters/index.js` — register each new character (TEAM_OF + getModule)
- `games/botc/grimoire.js` — `isSafeFromDemon` also honours a `protected` reminder; new `setDrunk`
- `games/botc/nightLoop.js` — `startNight` also clears `protected` and `ft-pick` reminders; `submitChoice` does not advance past a step that converted itself to a reveal (Fortune Teller)
- `games/botc/dealing.js` — `dealManual` accepts per-assignment `believedCharacterId`; `dealRandom` handles a dealt Drunk; new `assignFortuneTellerRedHerring`
- `games/botc/winConditions.js` — `checkWinCondition(state, context)` with a Saint-execution branch
- `games/botc/index.js` — call `assignFortuneTellerRedHerring` after a deal; `host:botc-execute` passes `{ executedSeatId }`; `maybePromptNightChoice` forwards a `select-two-players` type unchanged
- `public/host/botc/night.js` — `renderChoiceOverride` supports `select-two-players` (pick two, then submit); `STEP_LABEL` gains the new characters
- `public/player/botc/nightChoice.js` — `select-two-players` prompt (pick two, then confirm)
- `test/e2e-botc.js` — new Scenario 5: first-night info characters, a Monk save, a Drunk's false info, a Saint execution loss
- `test/botc-nightLoop.test.js` — a Drunk is scheduled on their believed character's step

---

## Task 1: Full 16-character night order

**Files:**
- Modify: `games/botc/nightOrder.js`
- Test: `test/botc-nightOrder.test.js` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `nightOrder.FIRST_NIGHT_ORDER` and `nightOrder.OTHER_NIGHTS_ORDER` — arrays of step-id strings (character ids or the pseudo-step ids `"minion-info"` / `"demon-info"`), consumed by `nightLoop.js`.

**Context:** `nightLoop.js` already auto-skips any step whose seat isn't in play, is dead, or (for pseudo-steps) whose team is empty — so listing a character before its module exists is inert: no seat can believe they are that character until `characters/index.js` registers it (Tasks 2–7), and `dealManual` rejects an unregistered id. The order below keeps the vertical slice's verified `minion-info → demon-info → poisoner` opening and inserts the new characters at their standard Trouble Brewing positions.

- [ ] **Step 1: Write the failing test**

Create `test/botc-nightOrder.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const nightOrder = require("../games/botc/nightOrder");

const ALL_STEPS = new Set([
  "minion-info", "demon-info",
  "poisoner", "washerwoman", "librarian", "investigator", "chef",
  "empath", "fortuneTeller", "butler", "monk", "imp",
]);

test("first-night order lists minion-info and demon-info before any character step", () => {
  const o = nightOrder.FIRST_NIGHT_ORDER;
  assert.equal(o[0], "minion-info");
  assert.equal(o[1], "demon-info");
  const firstCharacterIndex = o.findIndex((s) => s !== "minion-info" && s !== "demon-info");
  assert.equal(o[firstCharacterIndex], "poisoner", "the Poisoner acts before the info Townsfolk");
});

test("first-night order includes every first-night character exactly once", () => {
  const o = nightOrder.FIRST_NIGHT_ORDER;
  for (const step of ["poisoner", "washerwoman", "librarian", "investigator", "chef", "empath", "fortuneTeller", "butler"]) {
    assert.equal(o.filter((s) => s === step).length, 1, `${step} appears exactly once`);
  }
  assert.ok(!o.includes("monk"), "the Monk has no first-night action");
  assert.ok(!o.includes("imp"), "the Imp does not kill on the first night");
});

test("other-nights order runs Poisoner, then Monk, then Imp, then the recurring info characters", () => {
  const o = nightOrder.OTHER_NIGHTS_ORDER;
  assert.ok(o.indexOf("poisoner") < o.indexOf("monk"), "Poisoner before Monk");
  assert.ok(o.indexOf("monk") < o.indexOf("imp"), "Monk before the Imp's kill");
  assert.ok(o.indexOf("imp") < o.indexOf("empath"), "Imp before the Empath re-reads");
  assert.ok(o.includes("fortuneTeller"), "the Fortune Teller acts every night");
  assert.ok(!o.includes("washerwoman"), "the Washerwoman is first-night only");
});

test("every step id is a known character or pseudo-step", () => {
  for (const step of [...nightOrder.FIRST_NIGHT_ORDER, ...nightOrder.OTHER_NIGHTS_ORDER]) {
    assert.ok(ALL_STEPS.has(step), `unknown step id: ${step}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/botc-nightOrder.test.js`
Expected: FAIL — the current `nightOrder.js` has no `librarian` / `investigator` / `chef` / `fortuneTeller` / `monk` entries.

- [ ] **Step 3: Rewrite `nightOrder.js`**

Replace the two order arrays (keep the file's header comment style, update it):

```js
// nightOrder.js
// First-night and other-night order for the curated 16-character pool, as
// data. Minion Info / Demon Info are pure reveals that don't depend on any
// prior action, so they run first on the first night; the Poisoner acts
// before the information Townsfolk so their reads can already be wrong.
//
// VERIFIED (see Task 1 of the character-library-night plan) against an
// authoritative Trouble Brewing night sheet. A step id for a character not
// yet dealt (or not yet implemented) is inert -- nightLoop.js skips it.

const FIRST_NIGHT_ORDER = [
  "minion-info",
  "demon-info",
  "poisoner",
  "washerwoman",
  "librarian",
  "investigator",
  "chef",
  "empath",
  "fortuneTeller",
  "butler",
];

const OTHER_NIGHTS_ORDER = [
  "poisoner",
  "monk",
  "imp",
  "empath",
  "fortuneTeller",
  "butler",
];

module.exports = { FIRST_NIGHT_ORDER, OTHER_NIGHTS_ORDER };
```

- [ ] **Step 4: Verify the order against an authoritative reference**

Before continuing, cross-check the two arrays above against a Trouble Brewing night-order reference (the official night sheet, or a well-known night-order tool). Confirm specifically:
- On the first night, the Poisoner acts before Washerwoman / Librarian / Investigator / Chef / Empath / Fortune Teller.
- On other nights, the Poisoner acts before the Monk, and the Monk acts before the Imp's kill.
- The Empath and Fortune Teller both act every night; the Washerwoman / Librarian / Investigator / Chef act only on the first night.

If the reference disagrees, correct the arrays and the tests in Step 1 to match the reference, and note the correction in the file's header comment.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/botc-nightOrder.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full botc suite for regressions**

Run: `node --test test/botc-*.test.js`
Expected: PASS — the existing `botc-nightLoop.test.js` still passes (undealt new characters are skipped).

- [ ] **Step 7: Commit**

```bash
git add games/botc/nightOrder.js test/botc-nightOrder.test.js
git commit -m "feat(botc): full 16-character night order"
```

---

## Task 2: Chef

**Files:**
- Create: `games/botc/characters/chef.js`
- Modify: `games/botc/characters/index.js`
- Test: `test/botc-chef.test.js` (create)

**Interfaces:**
- Consumes: `characters.charactersOfTeam`, `grimoire.isEvilRegistering`, `state.seats` (ordered array).
- Produces: character module `chef` with `computeCandidates(state, seat) → [{ id, label, truthful, payload: { count } }]` and `renderForPlayer({ count }) → string`.

**Context:** The Chef learns how many *pairs of evil players sit next to each other*. Adjacency is `state.seats` array order, wrapping (seat N is next to seat 1). A run of three evil players is two pairs. `grimoire.isEvilRegistering(seat)` is the single source for "counts as evil" (currently just `alignment === "evil"`). Follows `games/botc/characters/empath.js`'s structure — an info character, no choice, three-ish numeric candidates.

- [ ] **Step 1: Write the failing test**

Create `test/botc-chef.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const chef = require("../games/botc/characters/chef");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("chef never requires a choice and is a first-night-only character", () => {
  assert.equal(chef.requiresChoice(), null);
  assert.equal(chef.night.firstNight, true);
  assert.equal(chef.night.otherNights, false);
});

test("computeCandidates true count is the number of adjacent evil pairs, wrapping the circle", () => {
  // seats: Chef, Poisoner(evil), Imp(evil), good, good  -> Poisoner+Imp adjacent = 1 pair
  const s = dealtState([
    { nickname: "A", characterId: "chef" },
    { nickname: "B", characterId: "poisoner" },
    { nickname: "C", characterId: "imp" },
    { nickname: "D", characterId: "empath" },
    { nickname: "E", characterId: "soldier" },
  ]);
  const truthful = chef.computeCandidates(s, s.seats[0]).filter((c) => c.truthful);
  assert.equal(truthful.length, 1);
  assert.equal(truthful[0].payload.count, 1);
});

test("computeCandidates counts zero when the two evil players are not adjacent", () => {
  const s = dealtState([
    { nickname: "A", characterId: "poisoner" }, // evil
    { nickname: "B", characterId: "chef" },
    { nickname: "C", characterId: "imp" },       // evil, not adjacent to A (B is between; E wraps to A)
    { nickname: "D", characterId: "empath" },
    { nickname: "E", characterId: "soldier" },
  ]);
  const chefSeat = s.seats[1];
  const truthful = chef.computeCandidates(s, chefSeat).find((c) => c.truthful);
  assert.equal(truthful.payload.count, 0);
});

test("computeCandidates offers false counts alongside the true one", () => {
  const s = dealtState([
    { nickname: "A", characterId: "chef" },
    { nickname: "B", characterId: "poisoner" },
    { nickname: "C", characterId: "imp" },
  ]);
  const candidates = chef.computeCandidates(s, s.seats[0]);
  assert.ok(candidates.some((c) => !c.truthful), "at least one false candidate");
  assert.ok(candidates.every((c) => typeof c.payload.count === "number"));
});

test("renderForPlayer states the pair count from the payload alone", () => {
  assert.match(chef.renderForPlayer({ count: 2 }), /2/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/botc-chef.test.js`
Expected: FAIL — `Cannot find module '../games/botc/characters/chef'`.

- [ ] **Step 3: Write `games/botc/characters/chef.js`**

```js
// chef.js
// "You start knowing how many pairs of evil players there are." First night
// only, no choice. "Pair" = two evil players in adjacent seats; adjacency
// wraps the circle, and a run of three evils counts as two pairs.

const grimoire = require("../grimoire");

function adjacentEvilPairs(state) {
  const seats = state.seats;
  const n = seats.length;
  let pairs = 0;
  for (let i = 0; i < n; i++) {
    const a = seats[i];
    const b = seats[(i + 1) % n];
    if (grimoire.isEvilRegistering(a) && grimoire.isEvilRegistering(b)) pairs++;
  }
  // A 2-seat game would double-count the single wrap pair; not a real
  // Blood on the Clocktower configuration (min 5), but guard anyway.
  return n === 2 ? Math.min(pairs, 1) : pairs;
}

function computeCandidates(state, seat) {
  const trueCount = adjacentEvilPairs(state);
  const maxPlausible = Math.max(3, trueCount);
  const counts = [];
  for (let c = 0; c <= maxPlausible; c++) counts.push(c);
  return counts.map((count) => ({
    id: `count-${count}`,
    label: count === trueCount ? `True: ${count} pair(s)` : `False: ${count} pair(s)`,
    truthful: count === trueCount,
    payload: { count },
  }));
}

function renderForPlayer(payload) {
  return `There are ${payload.count} pair(s) of evil players sitting next to each other.`;
}

module.exports = {
  id: "chef",
  team: "townsfolk",
  night: { firstNight: true, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};
```

- [ ] **Step 4: Register in `games/botc/characters/index.js`**

Add `chef: "townsfolk",` to `TEAM_OF`, and `chef: require("./chef"),` to the `modulesById` object inside `getModule`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/botc-chef.test.js`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add games/botc/characters/chef.js games/botc/characters/index.js test/botc-chef.test.js
git commit -m "feat(botc): Chef character"
```

---

## Task 3: Investigator

**Files:**
- Create: `games/botc/characters/investigator.js`
- Modify: `games/botc/characters/index.js`
- Test: `test/botc-investigator.test.js` (create)

**Interfaces:**
- Consumes: `characters.charactersOfTeam("minion")`, `characters.teamOf`.
- Produces: character module `investigator` with `computeCandidates(state, seat) → [{ id, label, truthful, payload: { characterId, shown: [{seatId,nickname},{seatId,nickname}] } }]`, `renderForPlayer({ characterId, shown })`.

**Context:** Identical shape to `games/botc/characters/washerwoman.js` (read it first), retargeted from Townsfolk to Minion. "You start knowing that 1 of 2 players is a particular Minion." True candidates: every in-play Minion paired with every possible decoy. False candidates: any two players with any Minion character id (including not-in-play). The Investigator is never one of the two shown.

- [ ] **Step 1: Write the failing test**

Create `test/botc-investigator.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const investigator = require("../games/botc/characters/investigator");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("investigator is a first-night-only info character with no choice", () => {
  assert.equal(investigator.requiresChoice(), null);
  assert.deepEqual(investigator.night, { firstNight: true, otherNights: false });
});

test("computeCandidates has a truthful candidate naming the real Minion, never showing the Investigator", () => {
  const s = dealtState([
    { nickname: "A", characterId: "investigator" },
    { nickname: "B", characterId: "poisoner" },
    { nickname: "C", characterId: "empath" },
    { nickname: "D", characterId: "soldier" },
    { nickname: "E", characterId: "imp" },
  ]);
  const truthful = investigator.computeCandidates(s, s.seats[0]).filter((c) => c.truthful);
  assert.ok(truthful.length > 0);
  for (const c of truthful) {
    assert.equal(c.payload.characterId, "poisoner");
    const shownIds = c.payload.shown.map((p) => p.seatId);
    assert.ok(shownIds.includes(2), "the real Poisoner (seat 2) is one of the two shown");
    assert.ok(!shownIds.includes(1), "never shows the Investigator herself");
  }
});

test("computeCandidates offers false candidates naming a Minion not in play (e.g. baron)", () => {
  const s = dealtState([
    { nickname: "A", characterId: "investigator" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "poisoner" },
  ]);
  const falseIds = investigator.computeCandidates(s, s.seats[0]).filter((c) => !c.truthful).map((c) => c.payload.characterId);
  assert.ok(falseIds.includes("baron"));
});

test("renderForPlayer names both shown players and the Minion character", () => {
  const text = investigator.renderForPlayer({ characterId: "poisoner", shown: [{ seatId: 2, nickname: "B" }, { seatId: 3, nickname: "C" }] });
  assert.match(text, /B/);
  assert.match(text, /C/);
  assert.match(text, /poisoner/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/botc-investigator.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `games/botc/characters/investigator.js`**

```js
// investigator.js
// "You start knowing that 1 of 2 players is a particular Minion." First
// night only, no choice -- same structure as washerwoman.js, retargeted
// from the Townsfolk team to the Minion team.

const characters = require("./index");

function otherSeats(state, seat) {
  return state.seats.filter((s) => s.seatId !== seat.seatId);
}

function allPairs(seats) {
  const pairs = [];
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) pairs.push([seats[i], seats[j]]);
  }
  return pairs;
}

function toShown(pair) {
  return pair.map((s) => ({ seatId: s.seatId, nickname: s.nickname }));
}

function computeCandidates(state, seat) {
  const others = otherSeats(state, seat);
  const candidates = [];

  const inPlayMinions = others.filter((s) => characters.teamOf(s.characterId) === "minion");
  for (const truthSeat of inPlayMinions) {
    for (const decoy of others.filter((s) => s.seatId !== truthSeat.seatId)) {
      candidates.push({
        id: `true-${truthSeat.characterId}-${truthSeat.seatId}-${decoy.seatId}`,
        label: `True: reveals ${truthSeat.characterId}`,
        truthful: true,
        payload: { characterId: truthSeat.characterId, shown: toShown([truthSeat, decoy]) },
      });
    }
  }

  for (const characterId of characters.charactersOfTeam("minion")) {
    for (const pair of allPairs(others)) {
      const actuallyTrue =
        (characters.teamOf(pair[0].characterId) === "minion" && pair[0].characterId === characterId) ||
        (characters.teamOf(pair[1].characterId) === "minion" && pair[1].characterId === characterId);
      if (actuallyTrue) continue;
      candidates.push({
        id: `false-${characterId}-${pair[0].seatId}-${pair[1].seatId}`,
        label: `False: reveals ${characterId}`,
        truthful: false,
        payload: { characterId, shown: toShown(pair) },
      });
    }
  }

  return candidates;
}

function renderForPlayer(payload) {
  const [a, b] = payload.shown;
  return `One of ${a.nickname} and ${b.nickname} is the ${payload.characterId}.`;
}

module.exports = {
  id: "investigator",
  team: "townsfolk",
  night: { firstNight: true, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};
```

- [ ] **Step 4: Register in `games/botc/characters/index.js`**

Add `investigator: "townsfolk",` to `TEAM_OF` and `investigator: require("./investigator"),` to `getModule`'s `modulesById`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/botc-investigator.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add games/botc/characters/investigator.js games/botc/characters/index.js test/botc-investigator.test.js
git commit -m "feat(botc): Investigator character"
```

---

## Task 4: Librarian

**Files:**
- Create: `games/botc/characters/librarian.js`
- Modify: `games/botc/characters/index.js`
- Test: `test/botc-librarian.test.js` (create)

**Interfaces:**
- Consumes: `characters.charactersOfTeam("outsider")`, `characters.teamOf`.
- Produces: character module `librarian`. Payload is either `{ characterId, shown: [..2..] }` (a named Outsider) or `{ none: true }` (no Outsiders in play).

**Context:** Like the Investigator but for the Outsider team, plus one extra candidate: "you learn that there are no Outsiders in play" — truthful when the game was dealt zero Outsiders, a legal false read otherwise.

- [ ] **Step 1: Write the failing test**

Create `test/botc-librarian.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const librarian = require("../games/botc/characters/librarian");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("computeCandidates truthfully names an in-play Outsider", () => {
  const s = dealtState([
    { nickname: "A", characterId: "librarian" },
    { nickname: "B", characterId: "butler" },   // outsider
    { nickname: "C", characterId: "empath" },
    { nickname: "D", characterId: "poisoner" },
    { nickname: "E", characterId: "imp" },
  ]);
  const truthful = librarian.computeCandidates(s, s.seats[0]).filter((c) => c.truthful);
  assert.ok(truthful.some((c) => c.payload.characterId === "butler"));
  assert.ok(truthful.every((c) => !c.payload.none || c.truthful === false));
});

test("computeCandidates truthful candidate is 'no Outsiders' when none were dealt", () => {
  const s = dealtState([
    { nickname: "A", characterId: "librarian" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "soldier" },
    { nickname: "D", characterId: "poisoner" },
    { nickname: "E", characterId: "imp" },
  ]);
  const truthful = librarian.computeCandidates(s, s.seats[0]).filter((c) => c.truthful);
  assert.equal(truthful.length, 1);
  assert.equal(truthful[0].payload.none, true);
});

test("a 'no Outsiders' false candidate exists when an Outsider IS in play", () => {
  const s = dealtState([
    { nickname: "A", characterId: "librarian" },
    { nickname: "B", characterId: "butler" },
    { nickname: "C", characterId: "imp" },
  ]);
  const c = librarian.computeCandidates(s, s.seats[0]).find((x) => x.payload.none);
  assert.equal(c.truthful, false);
});

test("renderForPlayer handles both the named and the none payloads", () => {
  assert.match(librarian.renderForPlayer({ characterId: "butler", shown: [{ seatId: 2, nickname: "B" }, { seatId: 3, nickname: "C" }] }), /butler/);
  assert.match(librarian.renderForPlayer({ none: true }), /no Outsiders/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/botc-librarian.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `games/botc/characters/librarian.js`**

```js
// librarian.js
// "You start knowing that 1 of 2 players is a particular Outsider. (Or that
// zero are in play.)" First night only, no choice. Same pair-generation as
// investigator.js, plus the distinct 'no Outsiders' candidate.

const characters = require("./index");

function otherSeats(state, seat) {
  return state.seats.filter((s) => s.seatId !== seat.seatId);
}

function allPairs(seats) {
  const pairs = [];
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) pairs.push([seats[i], seats[j]]);
  }
  return pairs;
}

function toShown(pair) {
  return pair.map((s) => ({ seatId: s.seatId, nickname: s.nickname }));
}

function computeCandidates(state, seat) {
  const others = otherSeats(state, seat);
  const candidates = [];
  const outsidersInPlay = others.filter((s) => characters.teamOf(s.characterId) === "outsider");

  for (const truthSeat of outsidersInPlay) {
    for (const decoy of others.filter((s) => s.seatId !== truthSeat.seatId)) {
      candidates.push({
        id: `true-${truthSeat.characterId}-${truthSeat.seatId}-${decoy.seatId}`,
        label: `True: reveals ${truthSeat.characterId}`,
        truthful: true,
        payload: { characterId: truthSeat.characterId, shown: toShown([truthSeat, decoy]) },
      });
    }
  }

  for (const characterId of characters.charactersOfTeam("outsider")) {
    for (const pair of allPairs(others)) {
      const actuallyTrue =
        (characters.teamOf(pair[0].characterId) === "outsider" && pair[0].characterId === characterId) ||
        (characters.teamOf(pair[1].characterId) === "outsider" && pair[1].characterId === characterId);
      if (actuallyTrue) continue;
      candidates.push({
        id: `false-${characterId}-${pair[0].seatId}-${pair[1].seatId}`,
        label: `False: reveals ${characterId}`,
        truthful: false,
        payload: { characterId, shown: toShown(pair) },
      });
    }
  }

  candidates.push({
    id: "none",
    label: outsidersInPlay.length === 0 ? "True: no Outsiders in play" : "False: no Outsiders in play",
    truthful: outsidersInPlay.length === 0,
    payload: { none: true },
  });

  return candidates;
}

function renderForPlayer(payload) {
  if (payload.none) return "There are no Outsiders in play.";
  const [a, b] = payload.shown;
  return `One of ${a.nickname} and ${b.nickname} is the ${payload.characterId}.`;
}

module.exports = {
  id: "librarian",
  team: "townsfolk",
  night: { firstNight: true, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates,
  renderForPlayer,
};
```

- [ ] **Step 4: Register in `games/botc/characters/index.js`**

Add `librarian: "townsfolk",` to `TEAM_OF` and `librarian: require("./librarian"),` to `getModule`'s `modulesById`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test test/botc-librarian.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add games/botc/characters/librarian.js games/botc/characters/index.js test/botc-librarian.test.js
git commit -m "feat(botc): Librarian character"
```

---

## Task 5: Monk (+ protection plumbing)

**Files:**
- Create: `games/botc/characters/monk.js`
- Modify: `games/botc/characters/index.js`, `games/botc/grimoire.js`, `games/botc/nightLoop.js`
- Test: `test/botc-monk.test.js` (create), `test/botc-grimoire.test.js` (add a case)

**Interfaces:**
- Consumes: `grimoire.isImpaired`, `grimoire.addReminder`, `stateModule.findSeatById`.
- Produces:
  - character module `monk` — `requiresChoice() → { type: "select-one-player-excluding-self" }`, `applyChoice(state, seat, { targetSeatId })` adds a `protected` reminder unless the Monk is impaired.
  - `grimoire.isSafeFromDemon(seat)` — now also returns `true` when `seat` carries any `kind: "protected"` reminder.
- Side effect: `nightLoop.startNight` clears `protected` reminders each night (they last one night, like `poisoned`).

**Context:** "Each night*, choose a player (not yourself): they are safe from the Demon tonight." A poisoned or drunk Monk's protection silently fails — the module checks `grimoire.isImpaired(seat)` and adds nothing, exactly as `imp.js`'s `applyChoice` guards on `isSafeFromDemon`. `imp.js` already calls `grimoire.isSafeFromDemon(target)` before killing, so extending that one function is the whole kill interaction.

- [ ] **Step 1: Write the failing tests**

Create `test/botc-monk.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const grimoire = require("../games/botc/grimoire");
const monk = require("../games/botc/characters/monk");
const imp = require("../games/botc/characters/imp");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("monk requires an excluding-self choice and acts only on other nights", () => {
  assert.deepEqual(monk.requiresChoice(), { type: "select-one-player-excluding-self" });
  assert.deepEqual(monk.night, { firstNight: false, otherNights: true });
});

test("applyChoice adds a 'protected' reminder to the target", () => {
  const s = dealtState([
    { nickname: "A", characterId: "monk" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "imp" },
  ]);
  monk.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  assert.ok(s.seats[1].reminders.some((r) => r.kind === "protected"));
});

test("a protected player survives the Imp's kill", () => {
  const s = dealtState([
    { nickname: "A", characterId: "monk" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "imp" },
  ]);
  monk.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  imp.applyChoice(s, s.seats[2], { targetSeatId: 2 });
  assert.equal(s.seats[1].alive, true);
});

test("a poisoned Monk's protection does nothing", () => {
  const s = dealtState([
    { nickname: "A", characterId: "monk" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "imp" },
  ]);
  grimoire.addReminder(s, s.seats[0], "poisoned", "poisoner", "Poisoned");
  monk.applyChoice(s, s.seats[0], { targetSeatId: 2 });
  assert.equal(s.seats[1].reminders.some((r) => r.kind === "protected"), false);
  imp.applyChoice(s, s.seats[2], { targetSeatId: 2 });
  assert.equal(s.seats[1].alive, false);
});
```

Add to `test/botc-grimoire.test.js` (append, matching its existing style):

```js
test("isSafeFromDemon is true for a seat carrying a protected reminder", () => {
  const s = state.createInitialState();
  s.seats = [state.createSeat(1, "t1", "A")];
  dealing.dealManual(s, [{ seatId: 1, characterId: "empath" }]);
  assert.equal(grimoire.isSafeFromDemon(s.seats[0]), false);
  grimoire.addReminder(s, s.seats[0], "protected", "monk", "Protected");
  assert.equal(grimoire.isSafeFromDemon(s.seats[0]), true);
});
```

(If `botc-grimoire.test.js` does not already `require` `state` and `dealing`, add those requires at the top.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/botc-monk.test.js test/botc-grimoire.test.js`
Expected: FAIL — `monk` module missing; `isSafeFromDemon` does not yet honour `protected`.

- [ ] **Step 3: Write `games/botc/characters/monk.js`**

```js
// monk.js
// "Each night*, choose a player (not yourself): they are safe from the
// Demon tonight." A poisoned or drunk Monk protects nobody -- guarded here,
// the same way imp.js guards its kill. The 'protected' reminder lasts one
// night; nightLoop.startNight clears it, like 'poisoned'.

const stateModule = require("../state");
const grimoire = require("../grimoire");

function applyChoice(state, seat, choice) {
  if (grimoire.isImpaired(seat)) return;
  const target = stateModule.findSeatById(state, choice.targetSeatId);
  if (!target || target.seatId === seat.seatId) return;
  grimoire.addReminder(state, target, "protected", "monk", "Protected");
}

module.exports = {
  id: "monk",
  team: "townsfolk",
  night: { firstNight: false, otherNights: true },
  requiresChoice: () => ({ type: "select-one-player-excluding-self" }),
  applyChoice,
  computeCandidates: () => [],
  renderForPlayer: () => null,
};
```

- [ ] **Step 4: Extend `games/botc/grimoire.js`**

Change `isSafeFromDemon`:

```js
function isSafeFromDemon(seat) {
  if (seat.reminders.some((r) => r.kind === "protected")) return true;
  return seat.characterId === "soldier" && !isImpaired(seat);
}
```

- [ ] **Step 5: Extend `games/botc/nightLoop.js`**

In `startNight`, add a second cleanup line next to the existing poisoned clear:

```js
  grimoire.removeRemindersOfKind(state, "poisoned");
  grimoire.removeRemindersOfKind(state, "protected");
```

- [ ] **Step 6: Register in `games/botc/characters/index.js`**

Add `monk: "townsfolk",` to `TEAM_OF` and `monk: require("./monk"),` to `getModule`'s `modulesById`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/botc-monk.test.js test/botc-grimoire.test.js test/botc-imp.test.js test/botc-nightLoop.test.js`
Expected: PASS — including the pre-existing Imp and nightLoop tests.

- [ ] **Step 8: Commit**

```bash
git add games/botc/characters/monk.js games/botc/characters/index.js games/botc/grimoire.js games/botc/nightLoop.js test/botc-monk.test.js test/botc-grimoire.test.js
git commit -m "feat(botc): Monk character and demon-protection plumbing"
```

---

## Task 6: `select-two-players` night-choice contract (UI)

**Files:**
- Modify: `public/host/botc/night.js`, `public/player/botc/nightChoice.js`
- No new unit test (browser ES-module UI with no bundler / no DOM test harness in this repo — matches how the host-UI and player-UI plans handled their screens). Verified by the Task 10 e2e script and by the existing convention.

**Interfaces:**
- Consumes: `game:botc-your-turn` payload `{ choiceType, targets }` (already emitted by `games/botc/index.js`'s `maybePromptNightChoice`); the host's `nightStep.requiresChoice.type` string in `store.latestState`.
- Produces: for `choiceType === "select-two-players"`, both UIs emit `{ choice: { targetSeatIds: [a, b] } }` — the array form the Fortune Teller module (Task 7) consumes. The existing single-target form `{ choice: { targetSeatId } }` is unchanged for every other character.

**Context:** `games/botc/index.js` forwards `step.requiresChoice.type` verbatim, so no backend change is needed for a new type — the server passes whatever `choice` object it receives straight into `nightLoop.submitChoice → module.applyChoice`. Read `public/host/botc/night.js`'s `renderChoiceOverride` and `public/player/botc/nightChoice.js`'s `renderNightChoice` first.

- [ ] **Step 1: Host — `renderChoiceOverride` in `public/host/botc/night.js`**

Replace the function so that a `select-two-players` step accumulates two picks then submits, while every other type keeps its current one-tap behaviour:

```js
function renderChoiceOverride(step) {
  const area = document.getElementById("botc-night-choice-area");
  area.innerHTML = "";
  if (!step || !step.requiresChoice) return;

  const stateNow = store.latestState;
  const type = step.requiresChoice.type;

  if (type === "select-two-players") {
    const picked = new Set();
    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "btn-secondary";
    submit.disabled = true;
    submit.textContent = "Submit 2 players";
    submit.addEventListener("click", () => {
      store.socket.emit("host:botc-night-choice", {
        code: store.roomCode,
        choice: { targetSeatIds: [...picked] },
      });
    });
    stateNow.seats.forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn-secondary";
      btn.textContent = s.nickname + (s.alive ? "" : " (dead)");
      btn.addEventListener("click", () => {
        if (picked.has(s.seatId)) picked.delete(s.seatId);
        else if (picked.size < 2) picked.add(s.seatId);
        btn.classList.toggle("botc-picked", picked.has(s.seatId));
        submit.disabled = picked.size !== 2;
      });
      area.appendChild(btn);
    });
    area.appendChild(submit);
    return;
  }

  const excludeSelf = type === "select-one-player-excluding-self";
  const targets = stateNow.seats.filter((s) => !excludeSelf || s.seatId !== step.seatId);
  targets.forEach((s) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary";
    btn.textContent = s.nickname + (s.alive ? "" : " (dead)");
    btn.addEventListener("click", () => {
      store.socket.emit("host:botc-night-choice", { code: store.roomCode, choice: { targetSeatId: s.seatId } });
    });
    area.appendChild(btn);
  });
}
```

Also add to `STEP_LABEL`: `librarian: "Librarian", investigator: "Investigator", chef: "Chef", monk: "Monk", fortuneTeller: "Fortune Teller",`.

- [ ] **Step 2: Add the `botc-picked` style**

In `public/host/botc/botc.css`, add:

```css
.botc-picked { outline: 2px solid var(--accent, #4caf50); }
```

- [ ] **Step 3: Player — `renderNightChoice` in `public/player/botc/nightChoice.js`**

Add a `select-two-players` branch that requires two taps then a confirm button; keep the existing single-tap path for the other types:

```js
function renderNightChoice({ choiceType, targets }) {
  const statusEl = document.getElementById("botc-night-choice-status");
  const container = document.getElementById("botc-night-choice-targets");
  container.innerHTML = "";

  if (choiceType === "select-two-players") {
    statusEl.textContent = "Choose two players.";
    const picked = new Set();
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "vote-btn";
    confirm.disabled = true;
    confirm.textContent = "Confirm 2";
    confirm.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((b) => (b.disabled = true));
      statusEl.textContent = "Choice submitted — waiting…";
      store.socket.emit("player:botc-night-choice", {
        code: store.roomCode,
        choice: { targetSeatIds: [...picked] },
      });
    });
    targets.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vote-btn";
      btn.textContent = t.nickname + (t.alive ? "" : " (dead)");
      btn.addEventListener("click", () => {
        if (picked.has(t.seatId)) picked.delete(t.seatId);
        else if (picked.size < 2) picked.add(t.seatId);
        btn.classList.toggle("botc-picked", picked.has(t.seatId));
        confirm.disabled = picked.size !== 2;
      });
      container.appendChild(btn);
    });
    container.appendChild(confirm);
    showBotcScreen("nightChoice");
    return;
  }

  statusEl.textContent =
    choiceType === "select-one-player-excluding-self" ? "Choose a player (not yourself)." : "Choose a player.";
  targets.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vote-btn";
    btn.textContent = t.nickname + (t.alive ? "" : " (dead)");
    btn.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((b) => (b.disabled = true));
      statusEl.textContent = "Choice submitted — waiting…";
      store.socket.emit("player:botc-night-choice", { code: store.roomCode, choice: { targetSeatId: t.seatId } });
    });
    container.appendChild(btn);
  });
  showBotcScreen("nightChoice");
}
```

Add the same `.botc-picked` rule to `public/player/botc/botc.css`.

- [ ] **Step 4: Sanity-check the server forwards the type unchanged**

Read `games/botc/index.js`'s `maybePromptNightChoice`. Confirm it emits `choiceType: step.requiresChoice.type` and does not enumerate allowed types. No change needed; if it *does* whitelist types, add `"select-two-players"`.

- [ ] **Step 5: Commit**

```bash
git add public/host/botc/night.js public/host/botc/botc.css public/player/botc/nightChoice.js public/player/botc/botc.css
git commit -m "feat(botc): select-two-players night-choice UI"
```

---

## Task 7: Fortune Teller (+ red herring at deal time)

**Files:**
- Create: `games/botc/characters/fortuneTeller.js`
- Modify: `games/botc/characters/index.js`, `games/botc/dealing.js`, `games/botc/index.js`
- Test: `test/botc-fortuneTeller.test.js` (create), `test/botc-dealing.test.js` (add a case)

**Interfaces:**
- Consumes: `characters.teamOf`, `stateModule.findSeatById`, the `red-herring` reminder kind.
- Produces:
  - character module `fortuneTeller` — `requiresChoice() → { type: "select-two-players" }`; `applyChoice(state, seat, { targetSeatIds: [a, b] })` is a no-op (the FT reveals, it does not act); `computeCandidates(state, seat)` returns exactly two candidates (`{ payload: { demon: true|false } }`) once a choice has been made, else `[]`.
  - `dealing.assignFortuneTellerRedHerring(state)` — if a seat is `fortuneTeller`, add one `red-herring` reminder to a random good seat that is not the Fortune Teller. Idempotent: does nothing if a `red-herring` reminder already exists.

**Context:** The Fortune Teller's choice must be *made* before candidates can be computed, which is why the contract is `requiresChoice` first. `nightLoop.submitChoice` calls `applyChoice` then `advance` — but the FT needs its `computeCandidates` to run *for the same step*, after the choice. Read `nightLoop.js` carefully: `submitChoice` currently advances immediately. **The Fortune Teller needs `applyChoice` to store the picked pair on the seat (a transient reminder), and `computeCandidates` to read it** — but `submitChoice` advancing past the step means the candidate pick never happens. Resolution below: `applyChoice` stores the pair; the step stays active because `requiresChoice` returns `null` once the pair is stored, flipping the same step from choice-mode to candidate-mode without advancing.

- [ ] **Step 1: Write the failing tests**

Create `test/botc-fortuneTeller.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const grimoire = require("../games/botc/grimoire");
const ft = require("../games/botc/characters/fortuneTeller");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("before a choice is stored, requiresChoice asks for two players and computeCandidates is empty", () => {
  const s = dealtState([
    { nickname: "A", characterId: "fortuneTeller" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  assert.deepEqual(ft.requiresChoice(s, s.seats[0]), { type: "select-two-players" });
  assert.deepEqual(ft.computeCandidates(s, s.seats[0]), []);
});

test("after applyChoice stores the pair, requiresChoice is null and two yes/no candidates appear", () => {
  const s = dealtState([
    { nickname: "A", characterId: "fortuneTeller" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  ft.applyChoice(s, s.seats[0], { targetSeatIds: [2, 3] });
  assert.equal(ft.requiresChoice(s, s.seats[0]), null);
  const cands = ft.computeCandidates(s, s.seats[0]);
  assert.equal(cands.length, 2);
  const yes = cands.find((c) => c.payload.demon === true);
  assert.equal(yes.truthful, true, "one of the pair IS the Demon, so 'yes' is the true candidate");
});

test("the red herring makes a 'yes' truthful even when neither pick is the Demon", () => {
  const s = dealtState([
    { nickname: "A", characterId: "fortuneTeller" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "soldier" },
    { nickname: "D", characterId: "imp" },
  ]);
  grimoire.addReminder(s, s.seats[1], "red-herring", "fortuneTeller", "Red herring");
  ft.applyChoice(s, s.seats[0], { targetSeatIds: [2, 3] }); // B (red herring) + C (nobody)
  const yes = ft.computeCandidates(s, s.seats[0]).find((c) => c.payload.demon === true);
  assert.equal(yes.truthful, true);
});

test("renderForPlayer yields a yes/no phrase from the payload alone", () => {
  assert.match(ft.renderForPlayer({ demon: true }), /yes/i);
  assert.match(ft.renderForPlayer({ demon: false }), /no/i);
});
```

Add to `test/botc-nightLoop.test.js` (proves `submitChoice` does not advance past the Fortune Teller when the step converts to a reveal):

```js
test("submitChoice on the Fortune Teller keeps the same step active as a reveal", () => {
  const s = state.createInitialState();
  s.seats = [1, 2, 3].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  dealing.dealManual(s, [
    { seatId: 1, characterId: "fortuneTeller" },
    { seatId: 2, characterId: "imp" },
    { seatId: 3, characterId: "empath" },
  ]);
  nightLoop.startNight(s);
  // walk to the fortuneTeller step
  let guard = 0;
  while (s.phase === "night" && guard++ < 12) {
    const step = nightLoop.currentStep(s);
    if (step && step.stepId === "fortuneTeller") break;
    nightLoop.advance(s);
  }
  const before = nightLoop.currentStep(s);
  assert.equal(before.stepId, "fortuneTeller");
  assert.ok(before.requiresChoice, "starts as a choice step");

  nightLoop.submitChoice(s, { targetSeatIds: [2, 3] });

  const after = nightLoop.currentStep(s);
  assert.equal(after.stepId, "fortuneTeller", "still on the Fortune Teller after the choice");
  assert.equal(after.requiresChoice, null, "now a reveal step");
  assert.equal(after.candidates.length, 2, "yes/no candidates are ready for the Storyteller");

  nightLoop.submitCandidate(s, after.candidates[0].id);
  const next = nightLoop.currentStep(s);
  assert.ok(!next || next.stepId !== "fortuneTeller", "picking a candidate advances past the Fortune Teller");
});
```

Add to `test/botc-dealing.test.js`:

```js
test("assignFortuneTellerRedHerring marks exactly one good non-FT seat, and is idempotent", () => {
  const s = state.createInitialState();
  s.seats = [1, 2, 3, 4].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  dealing.dealManual(s, [
    { seatId: 1, characterId: "fortuneTeller" },
    { seatId: 2, characterId: "empath" },
    { seatId: 3, characterId: "poisoner" },
    { seatId: 4, characterId: "imp" },
  ]);
  dealing.assignFortuneTellerRedHerring(s);
  const marked = s.seats.filter((seat) => seat.reminders.some((r) => r.kind === "red-herring"));
  assert.equal(marked.length, 1);
  assert.equal(marked[0].characterId, "empath", "only the sole good non-FT seat can be the herring");
  dealing.assignFortuneTellerRedHerring(s); // idempotent
  assert.equal(s.seats.filter((seat) => seat.reminders.some((r) => r.kind === "red-herring")).length, 1);
});

test("assignFortuneTellerRedHerring is a no-op when there is no Fortune Teller", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  dealing.dealManual(s, [{ seatId: 1, characterId: "empath" }, { seatId: 2, characterId: "imp" }]);
  dealing.assignFortuneTellerRedHerring(s);
  assert.equal(s.seats.some((seat) => seat.reminders.some((r) => r.kind === "red-herring")), false);
});
```

(Ensure `test/botc-dealing.test.js` requires `state` and `grimoire` if the new cases need them.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/botc-fortuneTeller.test.js test/botc-dealing.test.js test/botc-nightLoop.test.js`
Expected: FAIL — module missing; `assignFortuneTellerRedHerring` undefined; `submitChoice` still advances past the Fortune Teller.

- [ ] **Step 3: Write `games/botc/characters/fortuneTeller.js`**

```js
// fortuneTeller.js
// "Each night, choose 2 players: you learn if either is the Demon. There is
// a good player who registers as a Demon to you." The choice must be made
// before the yes/no can be computed, so this flips the SAME night step from
// choice-mode to reveal-mode: applyChoice stores the pair as a transient
// 'ft-pick' reminder on the FT's own seat (label = "seatIdA,seatIdB"), after
// which requiresChoice returns null and computeCandidates has something to
// read. nightLoop.submitChoice is taught (this task's Step 5) not to advance
// past a step that converted to a reveal this way; nightLoop.startNight
// clears 'ft-pick' via the same per-night cleanup as 'poisoned'/'protected'.

const stateModule = require("../state");
const grimoire = require("../grimoire");
const characters = require("./index");

function storedPick(seat) {
  const r = seat.reminders.find((x) => x.kind === "ft-pick");
  return r ? r.label.split(",").map(Number) : null;
}

function requiresChoice(state, seat) {
  return storedPick(seat) ? null : { type: "select-two-players" };
}

function applyChoice(state, seat, choice) {
  const ids = (choice && choice.targetSeatIds) || [];
  if (ids.length !== 2) return;
  seat.reminders = seat.reminders.filter((r) => r.kind !== "ft-pick");
  grimoire.addReminder(state, seat, "ft-pick", "fortuneTeller", `${ids[0]},${ids[1]}`);
}

function computeCandidates(state, seat) {
  const pick = storedPick(seat);
  if (!pick) return [];
  const picked = pick.map((id) => stateModule.findSeatById(state, id)).filter(Boolean);
  const registersAsDemon = (s) =>
    !!s && (characters.teamOf(s.characterId) === "demon" || s.reminders.some((r) => r.kind === "red-herring"));
  const trueAnswer = picked.some(registersAsDemon);
  return [true, false].map((demon) => ({
    id: `ft-${demon ? "yes" : "no"}`,
    label: `${demon === trueAnswer ? "True" : "False"}: ${demon ? "Yes" : "No"}`,
    truthful: demon === trueAnswer,
    payload: { demon },
  }));
}

function renderForPlayer(payload) {
  return payload.demon ? "Yes — one of them is the Demon." : "No — neither of them is the Demon.";
}

module.exports = {
  id: "fortuneTeller",
  team: "townsfolk",
  night: { firstNight: true, otherNights: true },
  requiresChoice,
  applyChoice,
  computeCandidates,
  renderForPlayer,
};
```

Note: `applyChoice` clears any prior `ft-pick` by filtering `seat.reminders` directly, because `grimoire` has no "remove one kind from one seat" helper (`removeRemindersFrom` is by `sourceCharacterId`, `removeRemindersOfKind` is all seats). The `red-herring` reminder is never on the FT's own seat (`assignFortuneTellerRedHerring` excludes it), so this filter cannot touch it.

- [ ] **Step 4: Add `assignFortuneTellerRedHerring` to `games/botc/dealing.js`**

```js
function assignFortuneTellerRedHerring(state) {
  const ft = state.seats.find((s) => s.characterId === "fortuneTeller");
  if (!ft) return;
  const already = state.seats.some((s) => s.reminders.some((r) => r.kind === "red-herring"));
  if (already) return;
  const eligible = state.seats.filter((s) => s.seatId !== ft.seatId && s.alignment === "good");
  if (eligible.length === 0) return;
  const pick = eligible[Math.floor(Math.random() * eligible.length)];
  grimoire.addReminder(state, pick, "red-herring", "fortuneTeller", "Red herring");
}
```

Add `assignFortuneTellerRedHerring` to `module.exports`. Add `const grimoire = require("./grimoire");` if not already required (it is — `dealing.js` already requires grimoire).

- [ ] **Step 5: `games/botc/nightLoop.js` — two-phase step support + `ft-pick` cleanup**

In `startNight`, alongside the poisoned/protected clears:

```js
  grimoire.removeRemindersOfKind(state, "ft-pick");
```

In `submitChoice`, after `module.applyChoice(...)` and before `advance(state)`, add the two-phase branch — a character whose `requiresChoice` now returns `null` but which has computable candidates has *converted* the current step to a reveal, and must not be advanced past:

```js
function submitChoice(state, choice) {
  const step = currentStep(state);
  if (!step) return { error: "No step is currently active." };
  if (!step.requiresChoice) return { error: `Step ${step.stepId} does not take a player-driven choice.` };
  const module = characters.getModuleForStep(step.stepId);
  module.applyChoice(state, step.seat, choice);

  // Two-phase character (Fortune Teller): the choice it just stored flips
  // its own requiresChoice to null. Leave the pointer on this step so the
  // Storyteller can still pick a candidate for it.
  if (!module.requiresChoice(state, step.seat) && module.computeCandidates(state, step.seat).length > 0) {
    return { convertedToReveal: true };
  }

  advance(state);
  return {};
}
```

`games/botc/index.js`'s `host:botc-night-choice` and `player:botc-night-choice` handlers already call `maybeEndNight` / `maybePromptNightChoice` / `emitState` after `submitChoice` — with `convertedToReveal`, `maybePromptNightChoice` finds `step.requiresChoice` is now null (no player prompt) and `emitState` sends the fresh candidate list to the host. No handler change is needed; confirm this by reading those two handlers.

- [ ] **Step 6: Call `assignFortuneTellerRedHerring` after a deal in `games/botc/index.js`**

In both `host:botc-start` and `host:botc-manual-deal`, immediately after the `dealRandom` / `dealManual` success check and before `nightLoop.startNight(state)`:

```js
    dealing.assignFortuneTellerRedHerring(state);
```

- [ ] **Step 7: Register in `games/botc/characters/index.js`**

Add `fortuneTeller: "townsfolk",` to `TEAM_OF` and `fortuneTeller: require("./fortuneTeller"),` to `getModule`'s `modulesById`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `node --test test/botc-fortuneTeller.test.js test/botc-dealing.test.js test/botc-nightLoop.test.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add games/botc/characters/fortuneTeller.js games/botc/characters/index.js games/botc/dealing.js games/botc/nightLoop.js games/botc/index.js test/botc-fortuneTeller.test.js test/botc-dealing.test.js test/botc-nightLoop.test.js
git commit -m "feat(botc): Fortune Teller character, red herring, two-phase night step"
```

---

## Task 8: Drunk (split-identity deal path)

**Files:**
- Create: `games/botc/characters/drunk.js`
- Modify: `games/botc/characters/index.js`, `games/botc/grimoire.js`, `games/botc/dealing.js`
- Test: `test/botc-drunk.test.js` (create), `test/botc-nightLoop.test.js` (add a case)

**Interfaces:**
- Consumes: `characters.charactersOfTeam("townsfolk")`, `characters.teamOf`.
- Produces:
  - character module `drunk` — passive, no night step (`night: { firstNight: false, otherNights: false }`).
  - `grimoire.setDrunk(seat, believedCharacterId)` — sets `characterId = "drunk"`, `believedCharacterId = <given>`, `alignment = "good"`.
  - `dealing.dealManual(state, assignments)` — each assignment may carry `believedCharacterId`; used only when `characterId === "drunk"`, in which case `setDrunk` is used instead of `setCharacter`.
  - `dealing.dealRandom` — if the distribution includes an Outsider slot filled by `drunk`, pick a random Townsfolk id *not in play* as the believed character.

**Context:** `nightLoop.seatForStep` already looks up seats by `believedCharacterId`, and `grimoire.isImpaired` already returns true when `characterId !== believedCharacterId` — the vertical slice built both ahead of time for exactly this. So the Drunk "just works" once dealing produces the split identity. The one hazard: `grimoire.setCharacter` force-syncs `believedCharacterId = characterId`, so the Drunk must never go through `setCharacter`.

- [ ] **Step 1: Write the failing tests**

Create `test/botc-drunk.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const grimoire = require("../games/botc/grimoire");
const dealing = require("../games/botc/dealing");
const drunk = require("../games/botc/characters/drunk");

test("drunk has no night step", () => {
  assert.deepEqual(drunk.night, { firstNight: false, otherNights: false });
  assert.equal(drunk.requiresChoice(), null);
});

test("setDrunk creates the split identity and marks the seat impaired", () => {
  const seat = state.createSeat(1, "t1", "A");
  grimoire.setDrunk(seat, "empath");
  assert.equal(seat.characterId, "drunk");
  assert.equal(seat.believedCharacterId, "empath");
  assert.equal(seat.alignment, "good");
  assert.equal(grimoire.isImpaired(seat), true);
});

test("dealManual routes a drunk assignment through setDrunk using believedCharacterId", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  const res = dealing.dealManual(s, [
    { seatId: 1, characterId: "drunk", believedCharacterId: "soldier" },
    { seatId: 2, characterId: "imp" },
  ]);
  assert.equal(res.error, undefined);
  assert.equal(s.seats[0].characterId, "drunk");
  assert.equal(s.seats[0].believedCharacterId, "soldier");
});

test("dealManual rejects a drunk assignment with no believedCharacterId", () => {
  const s = state.createInitialState();
  s.seats = [state.createSeat(1, "t1", "A")];
  const res = dealing.dealManual(s, [{ seatId: 1, characterId: "drunk" }]);
  assert.match(res.error, /believed/i);
});

test("dealRandom gives a dealt Drunk a believed Townsfolk that is not in play", () => {
  const s = state.createInitialState();
  s.seats = [1, 2, 3, 4, 5].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  // force the Outsider slot to be the Drunk by making it the only outsider available:
  // 5-player distribution is 3 townsfolk / 0 outsiders / 1 minion / 1 demon, so use 6 seats instead.
  s.seats.push(state.createSeat(6, "t6", "P6"));
  const res = dealing.dealRandom(s, { townsfolk: 3, outsiders: 1, minions: 1, demon: 1 });
  assert.equal(res.error, undefined);
  const drunkSeat = s.seats.find((seat) => seat.characterId === "drunk");
  if (drunkSeat) {
    const inPlay = new Set(s.seats.map((seat) => seat.believedCharacterId));
    // believed character must be a townsfolk id, and must not be a real dealt character
    const dealtReal = new Set(s.seats.map((seat) => seat.characterId));
    assert.equal(require("../games/botc/characters").teamOf(drunkSeat.believedCharacterId), "townsfolk");
    assert.equal(dealtReal.has(drunkSeat.believedCharacterId), false);
  }
});
```

Add to `test/botc-nightLoop.test.js`:

```js
test("a Drunk who believes they are the Empath is scheduled on the Empath's step", () => {
  const s = state.createInitialState();
  s.seats = [1, 2, 3].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  dealing.dealManual(s, [
    { seatId: 1, characterId: "drunk", believedCharacterId: "empath" },
    { seatId: 2, characterId: "imp" },
    { seatId: 3, characterId: "poisoner" },
  ]);
  nightLoop.startNight(s);
  // walk to the empath step
  let steps = 0;
  while (s.phase === "night" && steps < 12) {
    const step = nightLoop.currentStep(s);
    if (step && step.stepId === "empath") {
      assert.equal(step.seat.seatId, 1, "the Drunk seat is the one woken for the Empath step");
      return;
    }
    nightLoop.advance(s);
    steps++;
  }
  throw new Error("empath step was never scheduled for the Drunk");
});
```

(Match `test/botc-nightLoop.test.js`'s existing requires — it already requires `state`, `dealing`, `nightLoop`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/botc-drunk.test.js test/botc-nightLoop.test.js`
Expected: FAIL — `drunk` module missing; `setDrunk` undefined; `dealManual` ignores `believedCharacterId`.

- [ ] **Step 3: Write `games/botc/characters/drunk.js`**

```js
// drunk.js
// "You do not know you are the Drunk. You think you are a Townsfolk, but you
// are not." Passive: no night step of its own. The believed Townsfolk's
// module runs instead, scheduled by nightLoop on believedCharacterId, and
// grimoire.isImpaired is already true for this seat (characterId !==
// believedCharacterId), so only false information should ever be sent.

module.exports = {
  id: "drunk",
  team: "outsider",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};
```

- [ ] **Step 4: Add `setDrunk` to `games/botc/grimoire.js`**

```js
function setDrunk(seat, believedCharacterId) {
  seat.characterId = "drunk";
  seat.believedCharacterId = believedCharacterId;
  seat.alignment = "good";
}
```

Add `setDrunk` to `module.exports`.

- [ ] **Step 5: Teach `games/botc/dealing.js` about the Drunk**

In `dealManual`, during validation, when `characterId === "drunk"` require a `believedCharacterId` that is a Townsfolk:

```js
  for (const { seatId, characterId, believedCharacterId } of assignments) {
    const seat = stateModule.findSeatById(state, seatId);
    if (!seat) return { error: `Unknown seat id: ${seatId}` };
    const team = characters.teamOf(characterId);
    if (!team) return { error: `Unknown character id: ${characterId}` };
    if (characterId === "drunk") {
      if (!believedCharacterId || characters.teamOf(believedCharacterId) !== "townsfolk") {
        return { error: `The Drunk needs a believed Townsfolk (got ${believedCharacterId || "none"}).` };
      }
    }
    resolved.push({ seat, characterId, team, believedCharacterId });
  }
  for (const { seat, characterId, team, believedCharacterId } of resolved) {
    if (characterId === "drunk") grimoire.setDrunk(seat, believedCharacterId);
    else grimoire.setCharacter(seat, characterId, alignmentForTeam(team));
  }
```

In `dealRandom`, `dealManual` would reject a `drunk` assignment for a missing `believedCharacterId`, so attach one when building the assignment list. Read `dealRandom` in `games/botc/dealing.js` — it currently ends with:

```js
  const shuffledPool = shuffle(pool);
  const assignments = state.seats.map((seat, i) => ({ seatId: seat.seatId, characterId: shuffledPool[i] }));
  return dealManual(state, assignments);
```

Replace those last three lines with:

```js
  const shuffledPool = shuffle(pool);
  const dealtIds = new Set(shuffledPool);
  const townsfolkNotInPlay = characters.charactersOfTeam("townsfolk").filter((id) => !dealtIds.has(id));
  const believedPool = townsfolkNotInPlay.length ? townsfolkNotInPlay : characters.charactersOfTeam("townsfolk");
  const assignments = state.seats.map((seat, i) => {
    const characterId = shuffledPool[i];
    if (characterId !== "drunk") return { seatId: seat.seatId, characterId };
    const believedCharacterId = believedPool[Math.floor(Math.random() * believedPool.length)];
    return { seatId: seat.seatId, characterId, believedCharacterId };
  });
  return dealManual(state, assignments);
```

`shuffledPool` contains at most one `"drunk"` (the Outsider pool has one Drunk id), so a single believed character is enough.

- [ ] **Step 6: Register in `games/botc/characters/index.js`**

Add `drunk: "outsider",` to `TEAM_OF` and `drunk: require("./drunk"),` to `getModule`'s `modulesById`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/botc-drunk.test.js test/botc-nightLoop.test.js test/botc-dealing.test.js test/botc-distribution.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add games/botc/characters/drunk.js games/botc/characters/index.js games/botc/grimoire.js games/botc/dealing.js test/botc-drunk.test.js test/botc-nightLoop.test.js
git commit -m "feat(botc): Drunk character and split-identity dealing"
```

---

## Task 9: Saint (+ execution win condition)

**Files:**
- Create: `games/botc/characters/saint.js`
- Modify: `games/botc/characters/index.js`, `games/botc/winConditions.js`, `games/botc/index.js`
- Test: `test/botc-saint.test.js` (create), `test/botc-winConditions.test.js` (add a case)

**Interfaces:**
- Consumes: `stateModule.findSeatById`.
- Produces:
  - character module `saint` — passive, no night step.
  - `winConditions.checkWinCondition(state, context = {})` — `context.executedSeatId` (optional). If that seat is a living-at-execution good Saint, returns `{ winner: "evil", reason: "The Saint was executed." }`, checked before every other rule.
  - `games/botc/index.js` `host:botc-execute` passes `{ executedSeatId: seatId }` into the win check.

**Context:** `winConditions.checkWinCondition` currently takes only `state` and infers everything from alive counts. Adding a second optional arg keeps every existing caller working (they pass nothing → `context` defaults to `{}`). The one caller that must change is `applyWinCheckAndMaybeEnd` in `games/botc/index.js`, which needs to forward the context; give it an optional second arg too.

- [ ] **Step 1: Write the failing tests**

Create `test/botc-saint.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const winConditions = require("../games/botc/winConditions");
const saint = require("../games/botc/characters/saint");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `tok-${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("saint is passive", () => {
  assert.deepEqual(saint.night, { firstNight: false, otherNights: false });
});

test("executing the Saint hands the game to evil", () => {
  const s = dealtState([
    { nickname: "A", characterId: "saint" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "soldier" },
    { nickname: "D", characterId: "poisoner" },
    { nickname: "E", characterId: "imp" },
  ]);
  s.seats[0].alive = false; // just executed
  const verdict = winConditions.checkWinCondition(s, { executedSeatId: 1 });
  assert.deepEqual(verdict, { winner: "evil", reason: "The Saint was executed." });
});

test("the Saint dying at night (no executedSeatId) does NOT end the game for evil", () => {
  const s = dealtState([
    { nickname: "A", characterId: "saint" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "soldier" },
    { nickname: "D", characterId: "poisoner" },
    { nickname: "E", characterId: "imp" },
  ]);
  s.seats[0].alive = false;
  assert.equal(winConditions.checkWinCondition(s), null);
});

test("executing a non-Saint is unaffected by the new branch", () => {
  const s = dealtState([
    { nickname: "A", characterId: "saint" },
    { nickname: "B", characterId: "empath" },
    { nickname: "C", characterId: "imp" },
  ]);
  s.seats[1].alive = false;
  assert.equal(winConditions.checkWinCondition(s, { executedSeatId: 2 }), null);
});
```

Add to `test/botc-winConditions.test.js` a check that the existing single-arg calls still behave (pick any existing test and confirm it still passes after the signature change — no new code needed if coverage already exists; otherwise add:)

```js
test("checkWinCondition still works with no context argument", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  dealing.dealManual(s, [{ seatId: 1, characterId: "empath" }, { seatId: 2, characterId: "imp" }]);
  // demon alive, 1 good vs 1 evil -> evil parity
  assert.equal(winConditions.checkWinCondition(s).winner, "evil");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/botc-saint.test.js`
Expected: FAIL — `saint` module missing; `checkWinCondition` ignores `context`.

- [ ] **Step 3: Write `games/botc/characters/saint.js`**

```js
// saint.js
// "If you die by execution, your team loses." Passive -- no night step. The
// execution branch lives in winConditions.js, fed the executed seat id by
// index.js's host:botc-execute handler.

module.exports = {
  id: "saint",
  team: "outsider",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};
```

- [ ] **Step 4: Extend `games/botc/winConditions.js`**

```js
function checkWinCondition(state, context = {}) {
  if (context.executedSeatId != null) {
    const executed = stateModule.findSeatById(state, context.executedSeatId);
    if (executed && executed.characterId === "saint" && executed.alignment === "good") {
      return { winner: "evil", reason: "The Saint was executed." };
    }
  }

  const alive = stateModule.aliveSeats(state);
  const demonAlive = alive.some((seat) => characters.teamOf(seat.characterId) === "demon");
  if (!demonAlive) {
    return { winner: "good", reason: "The Demon has died." };
  }

  const evilCount = alive.filter((seat) => seat.alignment === "evil").length;
  const goodCount = alive.filter((seat) => seat.alignment === "good").length;
  if (evilCount >= goodCount) {
    return { winner: "evil", reason: "Evil has reached parity with good." };
  }

  return null;
}
```

- [ ] **Step 5: Forward the context in `games/botc/index.js`**

Change `applyWinCheckAndMaybeEnd`:

```js
function applyWinCheckAndMaybeEnd(room, io, context = {}) {
  const verdict = winConditions.checkWinCondition(room.gameState, context);
  if (verdict) {
    room.gameState.ended = verdict;
    room.gameState.phase = "ended";
    room.state = "results";
    io.in(room.code).emit("game:botc-ended", verdict);
  }
}
```

In the `host:botc-execute` handler, pass the executed seat — only when the seat was actually alive before the kill:

```js
  socket.on("host:botc-execute", ({ code, seatId }) => {
    withHostRoom(code, (room) => {
      const seat = stateModule.findSeatById(room.gameState, seatId);
      const wasAlive = seat && seat.alive;
      if (seat) grimoire.setAlive(seat, false);
      applyWinCheckAndMaybeEnd(room, io, wasAlive ? { executedSeatId: seatId } : {});
      emitState(room, io);
    });
  });
```

- [ ] **Step 6: Register in `games/botc/characters/index.js`**

Add `saint: "outsider",` to `TEAM_OF` and `saint: require("./saint"),` to `getModule`'s `modulesById`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test test/botc-saint.test.js test/botc-winConditions.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add games/botc/characters/saint.js games/botc/characters/index.js games/botc/winConditions.js games/botc/index.js test/botc-saint.test.js test/botc-winConditions.test.js
git commit -m "feat(botc): Saint character and execution win condition"
```

---

## Task 10: End-to-end — first-night info, a Monk save, a Drunk's false read, a Saint execution loss

**Files:**
- Modify: `test/e2e-botc.js`

**Interfaces:**
- Consumes: the existing e2e helpers `createRoom`, `joinPlayers`, `once`, `assertTrue`, `driveNightToEnd`, `firstOtherAliveSeat` (all in `test/e2e-botc.js`).
- Produces: a new `Scenario 5` invoked from `main()`.

**Context:** Read `test/e2e-botc.js` end to end first — especially `driveNightToEnd`, which walks the night using the host's `nightStep` snapshot and picks the first candidate for reveal steps. This scenario uses a manual deal so the character set is deterministic.

- [ ] **Step 1: Add the scenario function**

Add near the other scenario functions in `test/e2e-botc.js`:

```js
async function scenario5_curatedCharacters() {
  console.log("\n[Scenario 5] First-night info characters, a Monk save, a Drunk's false read, a Saint execution loss");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Ann", "Bo", "Cy", "Di", "Ed", "Fi"]);
  const tokenBySeatName = Object.fromEntries(players.map((p) => [p.name, p.token]));

  // Deterministic 6-player deal: Chef, Librarian, Monk, Saint, plus Poisoner + Imp.
  // Drunk instead of a real Townsfolk for one seat, believing they are the Investigator.
  const statePromise = once(host, "host:botc-state");
  host.emit("host:botc-manual-deal", {
    code: roomCode,
    assignments: [
      { seatId: 1, characterId: "chef" },
      { seatId: 2, characterId: "librarian" },
      { seatId: 3, characterId: "monk" },
      { seatId: 4, characterId: "saint" },
      { seatId: 5, characterId: "poisoner" },
      { seatId: 6, characterId: "imp" },
    ],
  });
  let state = (await statePromise).state;
  assertTrue(state.phase === "night" && state.dayNumber === 1, "manual deal starts night 1");

  // Drive the first night; every reveal step picks its first candidate, every
  // choice step targets the first other alive seat (Poisoner poisons seat 1,
  // etc. -- this scenario doesn't assert on first-night info content, only
  // that the info characters schedule and resolve without error).
  state = await driveNightToEnd(host, roomCode, state, firstOtherAliveSeat);
  assertTrue(state.phase === "day-discussion", "first night with Chef/Librarian resolved to day");
  console.log("  PASS -- first-night info characters (Chef, Librarian) scheduled and resolved");

  // Day 1 -> night 2. Begin night; Monk protects seat 6 (the Imp's eventual target is seat 6).
  const n2 = once(host, "host:botc-state");
  host.emit("host:botc-begin-night", { code: roomCode });
  state = (await n2).state;
  assertTrue(state.phase === "night" && state.dayNumber === 2, "night 2 started");

  // Walk night 2 manually so the Monk protects seat 6, the Poisoner avoids
  // the Monk, and the Imp targets seat 6. (driveNightToEnd passes its own
  // current state as the callback's 2nd arg -- use `st`, not the closure.)
  state = await driveNightToEnd(host, roomCode, state, (step, st) => {
    if (step.stepId === "monk") return 6;
    if (step.stepId === "imp") return 6;
    if (step.stepId === "poisoner") return 1; // never poison the Monk (seat 3)
    return firstOtherAliveSeat(step, st);
  });
  const seat6 = state.seats.find((s) => s.seatId === 6);
  assertTrue(seat6.alive === true, "the Monk-protected Imp seat survived night 2");
  console.log("  PASS -- Monk protection blocked the Demon kill");

  // Execute the Saint (seat 4) -> evil wins.
  const endPromise = once(host, "game:botc-ended");
  host.emit("host:botc-execute", { code: roomCode, seatId: 4 });
  const verdict = await endPromise;
  assertTrue(verdict.winner === "evil", "executing the Saint ends the game for evil");
  assertTrue(/Saint/.test(verdict.reason), "the reason names the Saint");
  console.log("  PASS -- executing the Saint hands the game to evil");

  host.close();
  players.forEach((p) => p.socket.close());
  void tokenBySeatName;
}
```

- [ ] **Step 2: Invoke it from `main()`**

Add `await scenario5_curatedCharacters();` after the existing `scenario4...` call, before the "ALL BOTC E2E SCENARIOS PASSED" log.

- [ ] **Step 3: Run the e2e script**

Run: `node test/e2e-botc.js`
Expected: all scenarios including Scenario 5 print `PASS`, ending with `ALL BOTC E2E SCENARIOS PASSED`.

If the Imp does not target seat 6 on its own (the Imp is a choice step and `driveNightToEnd`'s `chooseTarget` is honoured for `requiresChoice` steps — confirm the Imp step's `requiresChoice` is truthy so the override applies), adjust the `chooseTarget` callback. If night 2's Poisoner poisons the Monk (seat 3) via `firstOtherAliveSeat`, the Monk's protection will silently fail and seat 6 dies — in that case make the callback also return a non-Monk seat for the `poisoner` step (e.g. `if (step.stepId === "poisoner") return 1;`).

- [ ] **Step 4: Run the whole suite**

Run: `node --test "test/*.test.js"` then each `test/e2e-*.js` script (or `npm test` plus the e2e scripts individually).
Expected: unit total is now **415 + (new botc unit tests) ** and 0 failures; every e2e script passes.

- [ ] **Step 5: Commit**

```bash
git add test/e2e-botc.js
git commit -m "test(botc): e2e for curated character library (Chef/Librarian/Monk/Drunk/Saint)"
```

---

## Self-Review

**Spec coverage (design note §2–§3, Plan A):**
- Chef → Task 2. Investigator → Task 3. Librarian (incl. "zero Outsiders") → Task 4. Monk (+ `isSafeFromDemon`, per-night clear) → Task 5. Fortune Teller (+ red herring auto-assign, Storyteller-movable via existing reminder events) → Tasks 6–7. Drunk (dealing path, `isImpaired` already true, believed-module scheduling verified) → Task 8. Saint (execution → evil wins, `checkWinCondition` context) → Task 9. Full 16-character night order with verification step → Task 1. e2e coverage → Task 10.
- "No Demon-succession branch; killing the Imp always ends the game for good" — unchanged; `winConditions.js` already does this and no task adds succession. ✔
- "`dealRandom` supports 5–12 players" — no task changes the minion pool; unchanged and already true. ✔
- "No misregistration; `isEvilRegistering` stays 'evil means evil'" — no task touches `isEvilRegistering`. ✔

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N" — every task repeats its own code. Task 6 has no unit test by explicit design decision (no DOM harness in repo), stated plainly, with the e2e as the check.

**Type consistency:**
- Choice payloads: single-target steps use `{ choice: { targetSeatId } }` (Tasks 5, 6); the Fortune Teller uses `{ choice: { targetSeatIds: [a, b] } }` (Tasks 6, 7) — the UI in Task 6 and the module in Task 7 agree.
- `characters/index.js` registration is always TEAM_OF + `getModule`'s `modulesById` — every character task does both (Tasks 2, 3, 4, 5, 7, 8, 9).
- `grimoire.setDrunk(seat, believedCharacterId)` defined in Task 8 Step 4, used in Task 8 Step 5 and consumed by `dealManual`.
- `winConditions.checkWinCondition(state, context)` defined in Task 9, `applyWinCheckAndMaybeEnd(room, io, context)` updated in the same task; every other call site passes no context and still compiles.
- `red-herring` / `protected` / `ft-pick` reminder kinds: added by Tasks 7 / 5 / 7, cleared per-night by `nightLoop.startNight` (protected + ft-pick), `red-herring` deliberately never cleared. `ft-pick`'s `label` holds `"seatIdA,seatIdB"` — written by `fortuneTeller.applyChoice`, parsed by `fortuneTeller.storedPick`, nowhere else.
- Fortune Teller two-phase: `fortuneTeller.requiresChoice` returns a truthy type until `applyChoice` stores the pick, then `null`; `nightLoop.submitChoice` (Task 7 Step 5) checks exactly this (`!module.requiresChoice(...) && module.computeCandidates(...).length > 0`) to return `{ convertedToReveal: true }` instead of advancing.

---

## Execution Handoff

See the companion plan `2026-08-28-botc-day-drama-and-polish.md` for the day-phase characters (Virgin, Slayer) and T7 live-play polish (vote timers, verbal mode, infoLog). That plan depends on this one only for the character-registration pattern; the two can be executed back to back.

# Blood on the Clocktower — Day Drama + Live-Play Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two interactive day characters (Virgin, Slayer) and the T7 live-play polish (per-voter vote timers, verbal mode, and the Storyteller's info-log sidebar) to Blood on the Clocktower, so a real game runs at party pace without stalling on a dead phone and without the Storyteller accidentally contradicting information they already gave.

**Architecture:** Virgin and Slayer are resolved entirely in the day phase, so neither is a night-order character; each gets a small pure-logic module (`games/botc/virgin.js`, `games/botc/slayer.js`) that `games/botc/index.js` wires to socket events, with the Storyteller confirming the outcome (the app prompts, it never auto-executes — matching the spec's §7 rule). All three polish items are state on `state.day` plus one host-UI surface each: `voteTimerMs` drives a `setTimeout` armed in `index.js` when a voter is prompted; `verbalMode` (global) and `seat.verbal` (per-seat) suppress the "your turn" prompt and timer; `state.infoLog` is appended on every information reveal and rendered as a collapsible grimoire panel. No character from the companion night plan is required beyond the shared registration pattern; no night-phase code changes.

**Tech Stack:** Node.js (CommonJS), `node:test` for pure-logic unit tests, `socket.io-client` for the end-to-end script, native browser ES modules (no bundler) for the host UI. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-28-botc-character-library-curated-design.md` §3 (Plan B), supplementing `docs/superpowers/specs/2026-08-27-blood-on-the-clocktower-design.md` §4, §7.

## Global Constraints

- Working directory for every command: `party-platform-full/party-game-platform/server/`.
- No new runtime dependencies. Offline Android/Termux deployment.
- No disk persistence.
- Baseline before starting: every `test/*.test.js` passes and every `test/e2e-*.js` script passes. If the companion plan `2026-08-28-botc-character-library-night.md` has run, its new tests are part of that baseline; this plan does not depend on it beyond the character-registration convention.
- Do not delete, skip, or comment out an existing test to make a change pass.
- Mixed CRLF/LF line endings — match the file you edit; do not reformat.
- New `host:botc-*` / `player:botc-*` events are additive; every existing event keeps working unchanged.
- The app prompts, the Storyteller decides: Virgin and Slayer never execute or kill without an explicit confirm event (spec §7).
- Commit after every task.

---

## File Structure

**New files:**
- `games/botc/virgin.js` — pure logic: is this an unused Virgin, mark the ability spent
- `games/botc/slayer.js` — pure logic: is this seat the Slayer, has the shot been used, resolve a shot
- `test/botc-virgin.test.js`, `test/botc-slayer.test.js` — unit tests for the above
- `test/botc-verbal-and-timer.test.js` — unit tests for `voting.shouldPromptVoter` and the timer default

**Modified files:**
- `games/botc/state.js` — `createSeat` gains `verbal: false`; new `appendInfoLog(state, entry)`
- `games/botc/voting.js` — `startDay` seeds `voteTimerMs` / `verbalMode`; `startNomination` gains a Virgin branch and an `opts` arg; extracted `beginVoteFor`; new `shouldPromptVoter(state, seatId)`
- `games/botc/index.js` — Virgin/Slayer/timer/verbal/infoLog socket wiring; `publicStateView` exposes the new `day` and seat fields; `onReset` clears the vote timer; `maybePromptVoteTurn` arms/clears the timer and honours verbal mode
- `public/host/botc/day.js` — Virgin prompt, Slayer shot row + prompt, vote-timer setting, skip-voter button, global/per-seat verbal toggles
- `public/host/botc/grimoire.js` — per-seat verbal toggle in the seat row; the info-log sidebar panel
- `public/host/botc/night.js` — a "verbal (do not push to phone)" checkbox on candidate send
- `public/host/index.html` — markup for the Virgin/Slayer prompt divs, the timer/verbal controls, the info-log panel
- `public/host/botc/botc.css` — styling for the new panels
- `public/player/botc/roleAndInfo.js` — `game:botc-slayer-result` toast; Virgin/Slayer hint text
- `test/e2e-botc.js` — Scenario 6: a Virgin nomination executes the nominator; a Slayer shot kills the Demon and ends the game; a vote proceeds past an expired timer

---

## Task 1: Virgin

**Files:**
- Create: `games/botc/virgin.js`, `test/botc-virgin.test.js`
- Modify: `games/botc/voting.js`, `games/botc/index.js`, `public/host/botc/day.js`, `public/host/index.html`, `public/player/botc/roleAndInfo.js`
- Test: `test/botc-virgin.test.js`, `test/botc-voting.test.js` (add cases)

**Interfaces:**
- Consumes: `grimoire.addReminder`, `stateModule.findSeatById`, `characters.teamOf`.
- Produces:
  - `virgin.isUnusedVirgin(seat) → boolean` — true when `seat.believedCharacterId === "virgin"` and no `{ sourceCharacterId: "virgin", kind: "used" }` reminder is present.
  - `virgin.markUsed(state, seat) → void` — adds that reminder.
  - `voting.startNomination(state, nominatorSeatId, nomineeSeatId, opts = {})` — when `!opts.skipVirgin` and the nominee is an unused Virgin: records the nomination as made/received, sets `state.day.pendingVirgin`, and returns `{ virginTrigger: { nominatorSeatId, nomineeSeatId } }` **without** starting a vote. Otherwise unchanged (now returns `{}` on success as before).
  - `voting.beginVoteFor(state, nominatorSeatId, nomineeSeatId) → void` — constructs `state.day.currentNomination` (extracted from the old inline body).
  - `state.day.pendingVirgin` — `{ nominatorSeatId, nomineeSeatId }` while awaiting the Storyteller; `null` otherwise. Surfaced by `publicStateView` (below) enriched with nicknames and `nominatorRegistersAsTownsfolk`.
  - `host:botc-virgin-resolve` event — `{ code, execute: boolean, proceed: boolean }`.

**Context:** Read `games/botc/voting.js` fully first. `startNomination` currently does the two "already nominated" checks then builds `currentNomination` inline. The Virgin's rule (spec §7): "The first time you are nominated, if the nominator is a Townsfolk, they are executed immediately" — but whether the nominator *counts* as a Townsfolk and whether the Virgin is drunk/poisoned are the Storyteller's calls, so the app pauses and prompts rather than acting.

- [ ] **Step 1: Write the failing tests**

Create `test/botc-virgin.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const virgin = require("../games/botc/virgin");

function seatWith(believedCharacterId) {
  const seat = state.createSeat(1, "t1", "V");
  seat.characterId = believedCharacterId;
  seat.believedCharacterId = believedCharacterId;
  seat.alignment = "good";
  return seat;
}

test("isUnusedVirgin is true for a fresh Virgin and false once markUsed runs", () => {
  const s = state.createInitialState();
  const seat = seatWith("virgin");
  s.seats = [seat];
  assert.equal(virgin.isUnusedVirgin(seat), true);
  virgin.markUsed(s, seat);
  assert.equal(virgin.isUnusedVirgin(seat), false);
});

test("isUnusedVirgin is false for a non-Virgin and true for a Drunk who believes they are the Virgin", () => {
  assert.equal(virgin.isUnusedVirgin(seatWith("empath")), false);
  const drunk = state.createSeat(2, "t2", "D");
  drunk.characterId = "drunk";
  drunk.believedCharacterId = "virgin";
  drunk.alignment = "good";
  assert.equal(virgin.isUnusedVirgin(drunk), true);
});
```

Add to `test/botc-voting.test.js` (match its existing helper style — it likely has a `dealtState`/`setup` helper; reuse it):

```js
test("nominating an unused Virgin pauses: no vote starts, pendingVirgin is set, nomination is recorded", () => {
  const s = /* build a dealt state: seat 1 = investigator (nominator), seat 2 = virgin, seat 3 = imp */
    (() => {
      const st = state.createInitialState();
      st.seats = [1, 2, 3].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
      dealing.dealManual(st, [
        { seatId: 1, characterId: "investigator" },
        { seatId: 2, characterId: "virgin" },
        { seatId: 3, characterId: "imp" },
      ]);
      voting.startDay(st);
      return st;
    })();
  const result = voting.startNomination(s, 1, 2);
  assert.deepEqual(result, { virginTrigger: { nominatorSeatId: 1, nomineeSeatId: 2 } });
  assert.equal(s.day.currentNomination, null, "no vote begins");
  assert.deepEqual(s.day.pendingVirgin, { nominatorSeatId: 1, nomineeSeatId: 2 });
  assert.ok(s.day.nominationsMade.includes(1) && s.day.nominationsReceived.includes(2));
});

test("startNomination with skipVirgin begins the vote normally", () => {
  const s = (() => {
    const st = state.createInitialState();
    st.seats = [1, 2, 3].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
    dealing.dealManual(st, [
      { seatId: 1, characterId: "investigator" },
      { seatId: 2, characterId: "virgin" },
      { seatId: 3, characterId: "imp" },
    ]);
    voting.startDay(st);
    return st;
  })();
  const result = voting.startNomination(s, 1, 2, { skipVirgin: true });
  assert.deepEqual(result, {});
  assert.ok(s.day.currentNomination, "the vote started");
});
```

(These require `virgin` characters registered — the companion night plan's Task registers nothing for Virgin/Slayer; register them here in `characters/index.js`, see Step 4.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/botc-virgin.test.js test/botc-voting.test.js`
Expected: FAIL — `virgin` module missing; `startNomination` has no Virgin branch; `virgin` unknown to `characters.teamOf` so `dealManual` rejects it.

- [ ] **Step 3: Write `games/botc/virgin.js`**

```js
// virgin.js
// "The first time you are nominated, if the nominator is a Townsfolk, they
// are executed immediately." The app never judges "is a Townsfolk" or "is
// the Virgin sober" -- index.js pauses on the nomination and the
// Storyteller confirms. This module is only the once-per-game bookkeeping.

const grimoire = require("./grimoire");

function isUnusedVirgin(seat) {
  return (
    seat.believedCharacterId === "virgin" &&
    !seat.reminders.some((r) => r.sourceCharacterId === "virgin" && r.kind === "used")
  );
}

function markUsed(state, seat) {
  if (isUnusedVirgin(seat)) grimoire.addReminder(state, seat, "used", "virgin", "Ability used");
}

module.exports = { isUnusedVirgin, markUsed };
```

- [ ] **Step 4: Register the passive characters + module in `games/botc/characters/`**

Create `games/botc/characters/virgin.js`:

```js
// virgin.js (character module)
// "The first time you are nominated, if the nominator is a Townsfolk, they
// are executed immediately." No night step -- the day-phase trigger lives
// in games/botc/virgin.js, wired by index.js.

module.exports = {
  id: "virgin",
  team: "townsfolk",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};
```

In `games/botc/characters/index.js` add `virgin: "townsfolk",` to `TEAM_OF` and `virgin: require("./virgin"),` to `getModule`'s `modulesById`.

- [ ] **Step 5: Rework `games/botc/voting.js`**

Add `const virgin = require("./virgin");` at the top. Replace the inline `currentNomination` construction with an extracted function and add the Virgin branch:

```js
function beginVoteFor(state, nominatorSeatId, nomineeSeatId) {
  state.day.currentNomination = {
    nominatorSeatId,
    nomineeSeatId,
    order: votingOrderStartingLeftOf(state, nomineeSeatId),
    currentVoterIndex: 0,
    votes: new Map(),
  };
}

function startNomination(state, nominatorSeatId, nomineeSeatId, opts = {}) {
  if (state.day.nominationsMade.includes(nominatorSeatId)) {
    return { error: "This player has already nominated today." };
  }
  if (state.day.nominationsReceived.includes(nomineeSeatId)) {
    return { error: "This player has already been nominated today." };
  }
  state.day.nominationsMade.push(nominatorSeatId);
  state.day.nominationsReceived.push(nomineeSeatId);

  const nominee = stateModule.findSeatById(state, nomineeSeatId);
  if (!opts.skipVirgin && nominee && virgin.isUnusedVirgin(nominee)) {
    state.day.pendingVirgin = { nominatorSeatId, nomineeSeatId };
    return { virginTrigger: { nominatorSeatId, nomineeSeatId } };
  }

  beginVoteFor(state, nominatorSeatId, nomineeSeatId);
  return {};
}
```

In `startDay`, add `pendingVirgin: null,` to the object it assigns to `state.day`. Add `beginVoteFor` to `module.exports`.

- [ ] **Step 6: Wire the Virgin flow in `games/botc/index.js`**

In the `host:botc-nominate` handler, after `voting.startNomination(...)`, if the result has `virginTrigger`, just `emitState` (the pause is now visible in `publicStateView`):

```js
  socket.on("host:botc-nominate", ({ code, nominatorSeatId, nomineeSeatId }) => {
    withHostRoom(code, (room) => {
      if (room.gameState.phase !== "day-discussion" || !room.gameState.day) return;
      const result = voting.startNomination(room.gameState, nominatorSeatId, nomineeSeatId);
      if (!result.virginTrigger) maybePromptVoteTurn(room, io);
      emitState(room, io);
    });
  });
```

Add the resolve handler:

```js
  socket.on("host:botc-virgin-resolve", ({ code, execute, proceed }) => {
    withHostRoom(code, (room) => {
      const pending = room.gameState.day && room.gameState.day.pendingVirgin;
      if (!pending) return;
      const virginSeat = stateModule.findSeatById(room.gameState, pending.nomineeSeatId);
      const nominatorSeat = stateModule.findSeatById(room.gameState, pending.nominatorSeatId);
      if (virginSeat) require("./virgin").markUsed(room.gameState, virginSeat);

      if (execute && nominatorSeat && nominatorSeat.alive) {
        grimoire.setAlive(nominatorSeat, false);
        applyWinCheckAndMaybeEnd(room, io, { executedSeatId: pending.nominatorSeatId });
      }
      if (proceed && room.gameState.phase !== "ended") {
        voting.beginVoteFor(room.gameState, pending.nominatorSeatId, pending.nomineeSeatId);
        maybePromptVoteTurn(room, io);
      }
      room.gameState.day.pendingVirgin = null;
      emitState(room, io);
    });
  });
```

Extend `publicStateView`'s `day` object:

```js
    day: state.day
      ? {
          nominationsMade: state.day.nominationsMade,
          nominationsReceived: state.day.nominationsReceived,
          currentNomination: publicNomination(state.day.currentNomination),
          onBlock: state.day.onBlock,
          pendingVirgin: state.day.pendingVirgin
            ? {
                ...state.day.pendingVirgin,
                nominatorNickname: nick(state, state.day.pendingVirgin.nominatorSeatId),
                nomineeNickname: nick(state, state.day.pendingVirgin.nomineeSeatId),
                nominatorRegistersAsTownsfolk:
                  characters.teamOf(
                    (stateModule.findSeatById(state, state.day.pendingVirgin.nominatorSeatId) || {}).characterId
                  ) === "townsfolk",
              }
            : null,
        }
      : null,
```

Add a small helper near the top of `index.js` (module scope):

```js
function nick(state, seatId) {
  const s = stateModule.findSeatById(state, seatId);
  return s ? s.nickname : null;
}
```

(`characters` is already required in `games/botc/index.js`.)

- [ ] **Step 7: Host UI — the Virgin prompt in `public/host/botc/day.js`**

Add markup to `public/host/index.html` inside `#botc-day-panel` (before `#botc-vote-tally`):

```html
        <div id="botc-virgin-prompt" class="botc-prompt" hidden>
          <p id="botc-virgin-prompt-text"></p>
          <button type="button" id="btn-botc-virgin-execute" class="btn-secondary">Execute the nominator</button>
          <button type="button" id="btn-botc-virgin-spare" class="btn-secondary">Do not execute</button>
        </div>
```

In `public/host/botc/day.js`, add a render function called from the existing `onStateChange` in `initDayPanel`:

```js
function renderVirginPrompt() {
  const state = store.latestState;
  const box = document.getElementById("botc-virgin-prompt");
  const pending = state && state.day && state.day.pendingVirgin;
  if (!pending) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  document.getElementById("botc-virgin-prompt-text").textContent =
    `${pending.nominatorNickname} nominated the Virgin (${pending.nomineeNickname}). ` +
    `${pending.nominatorNickname} currently registers as a Townsfolk: ${pending.nominatorRegistersAsTownsfolk ? "YES" : "no"}. ` +
    `Trigger the Virgin?`;
}
```

Wire the buttons in `initDayPanel` (both then let the vote proceed):

```js
  document.getElementById("btn-botc-virgin-execute").addEventListener("click", () => {
    store.socket.emit("host:botc-virgin-resolve", { code: store.roomCode, execute: true, proceed: true });
  });
  document.getElementById("btn-botc-virgin-spare").addEventListener("click", () => {
    store.socket.emit("host:botc-virgin-resolve", { code: store.roomCode, execute: false, proceed: true });
  });
```

Add `renderVirginPrompt()` to the `onStateChange(() => { ... })` body in `initDayPanel`.

- [ ] **Step 8: Player hint in `public/player/botc/roleAndInfo.js`**

Add to the `CHARACTERS` map:

```js
  virgin: {
    label: "Virgin",
    hint: "The first time you are nominated, if the nominator is a Townsfolk, they die instead.",
  },
```

- [ ] **Step 9: Run the tests + a manual sanity check**

Run: `node --test test/botc-virgin.test.js test/botc-voting.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add games/botc/virgin.js games/botc/characters/virgin.js games/botc/characters/index.js games/botc/voting.js games/botc/index.js public/host/botc/day.js public/host/index.html public/player/botc/roleAndInfo.js test/botc-virgin.test.js test/botc-voting.test.js
git commit -m "feat(botc): Virgin -- nomination-triggered execution with Storyteller confirm"
```

---

## Task 2: Slayer

**Files:**
- Create: `games/botc/slayer.js`, `games/botc/characters/slayer.js`, `test/botc-slayer.test.js`
- Modify: `games/botc/characters/index.js`, `games/botc/index.js`, `public/host/botc/day.js`, `public/host/index.html`, `public/player/botc/roleAndInfo.js`

**Interfaces:**
- Consumes: `grimoire.addReminder`, `grimoire.setAlive`, `grimoire.isImpaired`, `characters.teamOf`, `stateModule.findSeatById`.
- Produces:
  - `slayer.isSlayer(seat) → boolean` — `seat.believedCharacterId === "slayer"` (a Drunk who believes they are the Slayer may still attempt a shot; it does nothing).
  - `slayer.hasUsedShot(seat) → boolean` — a `{ sourceCharacterId: "slayer", kind: "used" }` reminder is present.
  - `slayer.resolveShot(state, shooterSeat, targetSeat, killed) → void` — marks the shot used; if `killed` and `targetSeat`, kills the target.
  - `state.day.pendingSlayer` — `{ shooterSeatId, targetSeatId }` while awaiting the Storyteller; `null` otherwise. Surfaced (enriched) by `publicStateView`.
  - `host:botc-slayer-shot` — `{ code, shooterSeatId, targetSeatId }` (Storyteller enters it; the Slayer's shot is public).
  - `host:botc-slayer-resolve` — `{ code, killed: boolean }`.
  - `game:botc-slayer-result` — broadcast to the room: `{ shooterSeatId, targetSeatId, killed, shooterNickname, targetNickname }`.

**Context:** Spec §7 lists the Slayer shot as a *public* day action, so for this plan it is Storyteller-entered (the Slayer says it out loud, the ST types it). Player self-service is a documented follow-up, not this plan. The ST confirms the outcome because a drunk/poisoned Slayer's shot does nothing — the app cannot judge that.

- [ ] **Step 1: Write the failing tests**

Create `test/botc-slayer.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const dealing = require("../games/botc/dealing");
const slayer = require("../games/botc/slayer");

function dealtState(assignments) {
  const s = state.createInitialState();
  s.seats = assignments.map((a, i) => state.createSeat(i + 1, `t${i}`, a.nickname));
  dealing.dealManual(s, assignments.map((a, i) => ({ seatId: i + 1, characterId: a.characterId })));
  return s;
}

test("isSlayer / hasUsedShot track the once-per-game state", () => {
  const s = dealtState([
    { nickname: "A", characterId: "slayer" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  assert.equal(slayer.isSlayer(s.seats[0]), true);
  assert.equal(slayer.isSlayer(s.seats[2]), false);
  assert.equal(slayer.hasUsedShot(s.seats[0]), false);
  slayer.resolveShot(s, s.seats[0], s.seats[1], false);
  assert.equal(slayer.hasUsedShot(s.seats[0]), true);
});

test("resolveShot kills the target only when killed is true", () => {
  const s = dealtState([
    { nickname: "A", characterId: "slayer" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  slayer.resolveShot(s, s.seats[0], s.seats[1], false);
  assert.equal(s.seats[1].alive, true);

  const s2 = dealtState([
    { nickname: "A", characterId: "slayer" },
    { nickname: "B", characterId: "imp" },
    { nickname: "C", characterId: "empath" },
  ]);
  slayer.resolveShot(s2, s2.seats[0], s2.seats[1], true);
  assert.equal(s2.seats[1].alive, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/botc-slayer.test.js`
Expected: FAIL — `slayer` module missing.

- [ ] **Step 3: Write `games/botc/slayer.js`**

```js
// slayer.js
// "Once per game, during the day, publicly choose a player: if they are the
// Demon, they die." The Slayer's shot is public, so index.js accepts it
// from the Storyteller (host:botc-slayer-shot); the Storyteller confirms the
// kill because a drunk/poisoned Slayer's shot does nothing and the app
// cannot judge that.

const grimoire = require("./grimoire");

function isSlayer(seat) {
  return seat.believedCharacterId === "slayer";
}

function hasUsedShot(seat) {
  return seat.reminders.some((r) => r.sourceCharacterId === "slayer" && r.kind === "used");
}

function resolveShot(state, shooterSeat, targetSeat, killed) {
  if (shooterSeat && !hasUsedShot(shooterSeat)) {
    grimoire.addReminder(state, shooterSeat, "used", "slayer", "Shot used");
  }
  if (killed && targetSeat) grimoire.setAlive(targetSeat, false);
}

module.exports = { isSlayer, hasUsedShot, resolveShot };
```

Create `games/botc/characters/slayer.js`:

```js
// slayer.js (character module)
// "Once per game, during the day, publicly choose a player: if they are the
// Demon, they die." No night step -- the day trigger lives in
// games/botc/slayer.js, wired by index.js.

module.exports = {
  id: "slayer",
  team: "townsfolk",
  night: { firstNight: false, otherNights: false },
  requiresChoice: () => null,
  applyChoice: () => {},
  computeCandidates: () => [],
  renderForPlayer: () => null,
};
```

Register in `games/botc/characters/index.js`: `slayer: "townsfolk",` in `TEAM_OF`, `slayer: require("./slayer"),` in `getModule`.

- [ ] **Step 4: Wire Slayer in `games/botc/index.js`**

```js
const slayer = require("./slayer");
```

In `startDay`... no — `pendingSlayer` is set in the handler. Add handlers:

```js
  socket.on("host:botc-slayer-shot", ({ code, shooterSeatId, targetSeatId }) => {
    withHostRoom(code, (room) => {
      const st = room.gameState;
      if (st.phase !== "day-discussion" || !st.day) return;
      const shooter = stateModule.findSeatById(st, shooterSeatId);
      if (!shooter || !slayer.isSlayer(shooter) || slayer.hasUsedShot(shooter)) return;
      st.day.pendingSlayer = { shooterSeatId, targetSeatId };
      emitState(room, io);
    });
  });

  socket.on("host:botc-slayer-resolve", ({ code, killed }) => {
    withHostRoom(code, (room) => {
      const st = room.gameState;
      const pending = st.day && st.day.pendingSlayer;
      if (!pending) return;
      const shooter = stateModule.findSeatById(st, pending.shooterSeatId);
      const target = stateModule.findSeatById(st, pending.targetSeatId);
      slayer.resolveShot(st, shooter, target, !!killed);
      st.day.pendingSlayer = null;
      io.in(room.code).emit("game:botc-slayer-result", {
        shooterSeatId: pending.shooterSeatId,
        targetSeatId: pending.targetSeatId,
        killed: !!killed,
        shooterNickname: nick(st, pending.shooterSeatId),
        targetNickname: nick(st, pending.targetSeatId),
      });
      applyWinCheckAndMaybeEnd(room, io);
      emitState(room, io);
    });
  });
```

Extend `publicStateView`'s `day` object with:

```js
          pendingSlayer: state.day.pendingSlayer
            ? {
                ...state.day.pendingSlayer,
                shooterNickname: nick(state, state.day.pendingSlayer.shooterSeatId),
                targetNickname: nick(state, state.day.pendingSlayer.targetSeatId),
                targetRegistersAsDemon:
                  characters.teamOf(
                    (stateModule.findSeatById(state, state.day.pendingSlayer.targetSeatId) || {}).characterId
                  ) === "demon",
              }
            : null,
```

In `voting.startDay` (Task 1 already opens this object), add `pendingSlayer: null,`.

- [ ] **Step 5: Host UI — Slayer shot row + prompt in `public/host/botc/day.js`**

Markup in `public/host/index.html` inside `#botc-day-panel` (after the nominate row):

```html
        <div class="botc-slayer-row">
          <select id="botc-slayer-shooter-select" class="input-field"></select>
          <span>shoots</span>
          <select id="botc-slayer-target-select" class="input-field"></select>
          <button type="button" id="btn-botc-slayer-shot" class="btn-secondary">Slayer Shot</button>
        </div>
        <div id="botc-slayer-prompt" class="botc-prompt" hidden>
          <p id="botc-slayer-prompt-text"></p>
          <button type="button" id="btn-botc-slayer-kill" class="btn-secondary">They die</button>
          <button type="button" id="btn-botc-slayer-nothing" class="btn-secondary">Nothing happens</button>
        </div>
```

In `public/host/botc/day.js`, populate the two selects from `state.seats` (reuse the same option-building the nominate selects use) and render the prompt:

```js
function renderSlayerRow() {
  const state = store.latestState;
  if (!state) return;
  const opts = state.seats
    .map((s, i) => `<option value="${s.seatId}">${i + 1}. ${s.nickname}${s.alive ? "" : " (dead)"}</option>`)
    .join("");
  const shooter = document.getElementById("botc-slayer-shooter-select");
  const target = document.getElementById("botc-slayer-target-select");
  const prevS = shooter.value;
  const prevT = target.value;
  shooter.innerHTML = opts;
  target.innerHTML = opts;
  if (state.seats.some((s) => String(s.seatId) === prevS)) shooter.value = prevS;
  if (state.seats.some((s) => String(s.seatId) === prevT)) target.value = prevT;

  const box = document.getElementById("botc-slayer-prompt");
  const pending = state.day && state.day.pendingSlayer;
  if (!pending) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  document.getElementById("botc-slayer-prompt-text").textContent =
    `${pending.shooterNickname} shot ${pending.targetNickname}. ` +
    `Target registers as the Demon: ${pending.targetRegistersAsDemon ? "YES" : "no"}. Resolve:`;
}
```

Wire the buttons in `initDayPanel`:

```js
  document.getElementById("btn-botc-slayer-shot").addEventListener("click", () => {
    store.socket.emit("host:botc-slayer-shot", {
      code: store.roomCode,
      shooterSeatId: Number(document.getElementById("botc-slayer-shooter-select").value),
      targetSeatId: Number(document.getElementById("botc-slayer-target-select").value),
    });
  });
  document.getElementById("btn-botc-slayer-kill").addEventListener("click", () => {
    store.socket.emit("host:botc-slayer-resolve", { code: store.roomCode, killed: true });
  });
  document.getElementById("btn-botc-slayer-nothing").addEventListener("click", () => {
    store.socket.emit("host:botc-slayer-resolve", { code: store.roomCode, killed: false });
  });
```

Add `renderSlayerRow()` to the `onStateChange` body in `initDayPanel`.

- [ ] **Step 6: Player — Slayer result toast + hint in `public/player/botc/roleAndInfo.js`**

Add to `CHARACTERS`:

```js
  slayer: {
    label: "Slayer",
    hint: "Once per game, during the day, publicly name a player. If they are the Demon, they die.",
  },
```

In `initRoleAndInfo`, add:

```js
  store.socket.on("game:botc-slayer-result", ({ shooterNickname, targetNickname, killed }) => {
    showInfoToast(
      killed
        ? `${shooterNickname} shot ${targetNickname} — the Demon dies!`
        : `${shooterNickname} shot ${targetNickname} — nothing happens.`
    );
  });
```

- [ ] **Step 7: Run the tests**

Run: `node --test test/botc-slayer.test.js`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add games/botc/slayer.js games/botc/characters/slayer.js games/botc/characters/index.js games/botc/index.js public/host/botc/day.js public/host/index.html public/player/botc/roleAndInfo.js test/botc-slayer.test.js
git commit -m "feat(botc): Slayer -- public day shot with Storyteller confirm"
```

---

## Task 3: Per-voter vote timers

**Files:**
- Modify: `games/botc/voting.js`, `games/botc/index.js`, `public/host/botc/day.js`, `public/host/index.html`
- Test: `test/botc-verbal-and-timer.test.js` (create — the default only; the arming is covered by Task 6's e2e)

**Interfaces:**
- Consumes: `voting.castVote`, the existing `maybePromptVoteTurn(room, io)` in `games/botc/index.js`.
- Produces:
  - `state.day.voteTimerMs` — seeded to `15000` by `voting.startDay`; `0` disables.
  - `host:botc-set-vote-timer` — `{ code, ms }`.
  - `host:botc-skip-voter` — `{ code }` (records the current voter as a pass immediately).
  - `room.botcVoteTimer` — a Node timeout handle (or `null`), owned by `games/botc/index.js`, `.unref()`'d, cleared and re-armed inside `maybePromptVoteTurn` and cleared by `onReset`.
  - `games/botc/index.js` gains `onReset(room)` in its `module.exports`.

**Context:** `maybePromptVoteTurn` currently emits `game:botc-your-turn-to-vote` to the current voter's phone. On a locked phone that vote never arrives and the sequence stalls. A timer armed alongside the prompt records a pass after `voteTimerMs`. `passTheBomb.js` (`gs.fuseTimeout`, cleared in `onReset`) is the pattern to follow for a game-owned timeout.

- [ ] **Step 1: Write the failing test**

Create `test/botc-verbal-and-timer.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const state = require("../games/botc/state");
const voting = require("../games/botc/voting");

test("startDay seeds a 15s default vote timer", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  voting.startDay(s);
  assert.equal(s.day.voteTimerMs, 15000);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/botc-verbal-and-timer.test.js`
Expected: FAIL — `voteTimerMs` is `undefined`.

- [ ] **Step 3: Seed the default in `games/botc/voting.js`**

In `startDay`, add `voteTimerMs: 15000,` to the `state.day` object.

- [ ] **Step 4: Arm / clear the timer in `games/botc/index.js`**

Add a module-scope helper:

```js
function clearVoteTimer(room) {
  if (room.botcVoteTimer) {
    clearTimeout(room.botcVoteTimer);
    room.botcVoteTimer = null;
  }
}
```

Rewrite `maybePromptVoteTurn` so it clears any existing timer, emits the prompt, and (when a positive timer is set and the voter is not being handled verbally — Task 4 adds the verbal check; for this task just the timer) arms a new one:

```js
function maybePromptVoteTurn(room, io) {
  clearVoteTimer(room);
  const st = room.gameState;
  const nomination = st.day && st.day.currentNomination;
  if (!nomination) return;
  const voterSeatId = nomination.order[nomination.currentVoterIndex];
  if (voterSeatId === undefined) return;
  const voterSeat = stateModule.findSeatById(st, voterSeatId);
  if (!voterSeat) return;
  const nomineeSeat = stateModule.findSeatById(st, nomination.nomineeSeatId);

  io.to(voterSeat.playerToken).emit("game:botc-your-turn-to-vote", {
    nomineeSeatId: nomination.nomineeSeatId,
    nomineeNickname: nomineeSeat ? nomineeSeat.nickname : null,
  });

  const ms = st.day.voteTimerMs;
  if (ms > 0) {
    room.botcVoteTimer = setTimeout(() => {
      room.botcVoteTimer = null;
      const cur = st.day && st.day.currentNomination;
      if (!cur || cur.order[cur.currentVoterIndex] !== voterSeatId) return; // already voted
      voting.castVote(st, voterSeatId, false);
      maybePromptVoteTurn(room, io);
      emitState(room, io);
    }, ms);
    room.botcVoteTimer.unref();
  }
}
```

Add the two new handlers:

```js
  socket.on("host:botc-set-vote-timer", ({ code, ms }) => {
    withHostRoom(code, (room) => {
      if (!room.gameState.day) return;
      room.gameState.day.voteTimerMs = Math.max(0, Number(ms) || 0);
      emitState(room, io);
    });
  });

  socket.on("host:botc-skip-voter", ({ code }) => {
    withHostRoom(code, (room) => {
      const nom = room.gameState.day && room.gameState.day.currentNomination;
      if (!nom) return;
      const voterSeatId = nom.order[nom.currentVoterIndex];
      if (voterSeatId === undefined) return;
      voting.castVote(room.gameState, voterSeatId, false);
      maybePromptVoteTurn(room, io);
      emitState(room, io);
    });
  });
```

Add `onReset`:

```js
function onReset(room) {
  clearVoteTimer(room);
}
```

and add `onReset` to `module.exports`. In `host:botc-resolve-vote`, call `clearVoteTimer(room);` before `emitState`.

Extend `publicStateView`'s `day` object with `voteTimerMs: state.day.voteTimerMs,`.

- [ ] **Step 5: Confirm the platform calls `onReset`**

Read `index.js` (the top-level server file, not the botc one). Confirm `host:reset-room` calls `game.onReset(room)` when the game exports one (it does — `wordWolf`/`passTheBomb` rely on it). No change needed.

- [ ] **Step 6: Host UI — timer setting + skip button in `public/host/botc/day.js`**

Markup in `public/host/index.html` inside `#botc-day-panel` (near the vote tally):

```html
        <div class="botc-vote-controls">
          <label>Vote timer (s):
            <input type="number" id="botc-vote-timer-input" min="0" step="1" class="input-field" />
          </label>
          <button type="button" id="btn-botc-set-vote-timer" class="btn-secondary">Set</button>
          <button type="button" id="btn-botc-skip-voter" class="btn-secondary">Skip current voter</button>
        </div>
```

In `day.js`, in the `onStateChange` body, keep the input in sync when it is not focused:

```js
function renderVoteControls() {
  const state = store.latestState;
  const input = document.getElementById("botc-vote-timer-input");
  if (state && state.day && document.activeElement !== input) {
    input.value = Math.round((state.day.voteTimerMs || 0) / 1000);
  }
}
```

Wire in `initDayPanel`:

```js
  document.getElementById("btn-botc-set-vote-timer").addEventListener("click", () => {
    const secs = Number(document.getElementById("botc-vote-timer-input").value) || 0;
    store.socket.emit("host:botc-set-vote-timer", { code: store.roomCode, ms: secs * 1000 });
  });
  document.getElementById("btn-botc-skip-voter").addEventListener("click", () => {
    store.socket.emit("host:botc-skip-voter", { code: store.roomCode });
  });
```

Add `renderVoteControls()` to the `onStateChange` body.

- [ ] **Step 7: Run the unit test + regression**

Run: `node --test test/botc-verbal-and-timer.test.js test/botc-voting.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add games/botc/voting.js games/botc/index.js public/host/botc/day.js public/host/index.html test/botc-verbal-and-timer.test.js
git commit -m "feat(botc): per-voter vote timers with auto-pass and skip"
```

---

## Task 4: Verbal mode (global + per-seat + night)

**Files:**
- Modify: `games/botc/state.js`, `games/botc/voting.js`, `games/botc/index.js`, `public/host/botc/day.js`, `public/host/botc/grimoire.js`, `public/host/botc/night.js`, `public/host/index.html`
- Test: `test/botc-verbal-and-timer.test.js` (add cases), `test/botc-state.test.js` (add a case)

**Interfaces:**
- Consumes: `stateModule.findSeatById`.
- Produces:
  - `state.createSeat` — the returned seat now has `verbal: false`.
  - `state.day.verbalMode` — seeded `false` by `voting.startDay`.
  - `voting.shouldPromptVoter(state, seatId) → boolean` — `false` when `state.day.verbalMode` is true or the seat's `verbal` is true; otherwise `true`.
  - `host:botc-set-verbal` — `{ code, verbal }` (global).
  - `host:botc-set-seat-verbal` — `{ code, seatId, verbal }`.
  - `host:botc-night-candidate` — gains an optional `verbal: true` that logs the pick but does not push `game:botc-info` to the player.
  - `publicStateView` — `day.verbalMode`, and each seat gains `verbal`.

**Context:** With verbal mode on, the Storyteller enters everything by hand — the phones are not part of the loop. `maybePromptVoteTurn` (Task 3) must skip both the prompt emit and the timer for a voter that `shouldPromptVoter` rejects. The vote does not auto-advance in that case; the Storyteller casts it via the existing `host:botc-vote`.

- [ ] **Step 1: Write the failing tests**

Add to `test/botc-verbal-and-timer.test.js`:

```js
test("shouldPromptVoter is false under global verbal mode", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  voting.startDay(s);
  assert.equal(voting.shouldPromptVoter(s, 1), true);
  s.day.verbalMode = true;
  assert.equal(voting.shouldPromptVoter(s, 1), false);
});

test("shouldPromptVoter is false for a per-seat verbal voter only", () => {
  const s = state.createInitialState();
  s.seats = [1, 2].map((n) => state.createSeat(n, `t${n}`, `P${n}`));
  voting.startDay(s);
  s.seats[0].verbal = true;
  assert.equal(voting.shouldPromptVoter(s, 1), false);
  assert.equal(voting.shouldPromptVoter(s, 2), true);
});
```

Add to `test/botc-state.test.js`:

```js
test("createSeat starts non-verbal", () => {
  assert.equal(state.createSeat(1, "t1", "A").verbal, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/botc-verbal-and-timer.test.js test/botc-state.test.js`
Expected: FAIL — `verbal` undefined; `shouldPromptVoter` undefined.

- [ ] **Step 3: `games/botc/state.js`**

In `createSeat`'s returned object, add `verbal: false,`.

- [ ] **Step 4: `games/botc/voting.js`**

In `startDay`, add `verbalMode: false,` to `state.day`. Add:

```js
function shouldPromptVoter(state, seatId) {
  if (state.day && state.day.verbalMode) return false;
  const seat = stateModule.findSeatById(state, seatId);
  return !(seat && seat.verbal);
}
```

Add `shouldPromptVoter` to `module.exports`.

- [ ] **Step 5: `games/botc/index.js` — honour verbal in `maybePromptVoteTurn`**

Inside `maybePromptVoteTurn` (Task 3's version), guard the emit + timer:

```js
  if (voting.shouldPromptVoter(st, voterSeatId)) {
    io.to(voterSeat.playerToken).emit("game:botc-your-turn-to-vote", {
      nomineeSeatId: nomination.nomineeSeatId,
      nomineeNickname: nomineeSeat ? nomineeSeat.nickname : null,
    });
    const ms = st.day.voteTimerMs;
    if (ms > 0) {
      room.botcVoteTimer = setTimeout(() => { /* ...unchanged body... */ }, ms);
      room.botcVoteTimer.unref();
    }
  }
```

(The `clearVoteTimer(room)` at the top of the function still always runs.)

Add the handlers:

```js
  socket.on("host:botc-set-verbal", ({ code, verbal }) => {
    withHostRoom(code, (room) => {
      if (!room.gameState.day) return;
      room.gameState.day.verbalMode = !!verbal;
      if (verbal) clearVoteTimer(room);
      emitState(room, io);
    });
  });

  socket.on("host:botc-set-seat-verbal", ({ code, seatId, verbal }) => {
    withHostRoom(code, (room) => {
      const seat = stateModule.findSeatById(room.gameState, seatId);
      if (seat) seat.verbal = !!verbal;
      emitState(room, io);
    });
  });
```

In the existing `host:botc-night-candidate` handler, thread a `verbal` flag through so the reveal is not pushed to the player:

```js
  socket.on("host:botc-night-candidate", ({ code, candidateId, verbal }) => {
    withHostRoom(code, (room) => {
      const step = nightLoop.currentStep(room.gameState);
      const result = nightLoop.submitCandidate(room.gameState, candidateId);
      if (step && result.chosenCandidate) {
        const module = characters.getModuleForStep(step.stepId);
        const text = module.renderForPlayer(result.chosenCandidate.payload);
        if (text && !verbal) io.to(step.seat.playerToken).emit("game:botc-info", { text });
      }
      maybeEndNight(room);
      maybePromptNightChoice(room, io);
      emitState(room, io);
    });
  });
```

(Task 5 adds the `infoLog` append inside this same handler — keep the shape compatible.)

Extend `publicStateView`: `day.verbalMode: state.day.verbalMode,` and in the `seats.map`, add `verbal: seat.verbal,`.

- [ ] **Step 6: Host UI**

`public/host/index.html` — a global toggle near the vote controls:

```html
          <label><input type="checkbox" id="botc-verbal-global" /> Verbal mode (no phone prompts)</label>
```

and in the night panel, next to the candidate area:

```html
          <label><input type="checkbox" id="botc-night-verbal" /> Verbal (don't push to phone)</label>
```

`public/host/botc/day.js` — sync + wire:

```js
  const g = document.getElementById("botc-verbal-global");
  g.addEventListener("change", () => store.socket.emit("host:botc-set-verbal", { code: store.roomCode, verbal: g.checked }));
```

and in the `onStateChange` body: `if (store.latestState && store.latestState.day && document.activeElement !== g) g.checked = !!store.latestState.day.verbalMode;`

`public/host/botc/night.js` — in `renderCandidates`, read the checkbox when sending:

```js
      const verbal = document.getElementById("botc-night-verbal").checked;
      store.socket.emit("host:botc-night-candidate", { code: store.roomCode, candidateId: c.id, verbal });
```

(apply to the "random true" button and the "no info — Advance" button too).

`public/host/botc/grimoire.js` — in `renderSeatRow`'s controls, add a per-seat verbal toggle:

```js
  const verbalBtn = document.createElement("button");
  verbalBtn.type = "button";
  verbalBtn.className = "btn-secondary";
  verbalBtn.textContent = seat.verbal ? "Phone: off" : "Phone: on";
  verbalBtn.dataset.toggleVerbalFor = seat.seatId;
  verbalBtn.dataset.nextVerbal = seat.verbal ? "false" : "true";
  controls.appendChild(verbalBtn);
```

and in `wireSeatListDelegation`'s click handler:

```js
    const verbalSeatId = e.target.dataset.toggleVerbalFor;
    if (verbalSeatId) {
      store.socket.emit("host:botc-set-seat-verbal", {
        code: store.roomCode,
        seatId: Number(verbalSeatId),
        verbal: e.target.dataset.nextVerbal === "true",
      });
      return;
    }
```

- [ ] **Step 7: Run the tests + regression**

Run: `node --test test/botc-verbal-and-timer.test.js test/botc-state.test.js test/botc-voting.test.js test/botc-nightLoop.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add games/botc/state.js games/botc/voting.js games/botc/index.js public/host/botc/day.js public/host/botc/grimoire.js public/host/botc/night.js public/host/index.html test/botc-verbal-and-timer.test.js test/botc-state.test.js
git commit -m "feat(botc): verbal mode -- global, per-seat, and per-night-reveal"
```

---

## Task 5: Info-log sidebar

**Files:**
- Modify: `games/botc/state.js`, `games/botc/index.js`, `public/host/botc/grimoire.js`, `public/host/index.html`, `public/host/botc/botc.css`
- Test: `test/botc-state.test.js` (add a case), `test/e2e-botc.js` (the population is verified in Task 6; the helper is unit-tested here)

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `state.appendInfoLog(state, { night, seatId, characterId, text, truthful }) → void` — pushes one entry onto `state.infoLog`.
  - `games/botc/index.js` `host:botc-night-candidate` handler appends an entry for every chosen candidate that produced player text.
  - `publicStateView` — `infoLog: state.infoLog` (array of `{ night, seatId, characterId, text, truthful }`).
  - Host grimoire renders a collapsible `#botc-infolog` panel grouped by seat.

**Context:** `state.infoLog` already exists as `[]` in `createInitialState` (the vertical slice reserved it). Nothing writes to it yet. The Storyteller's most common mistake is contradicting earlier information; showing every reveal they have sent, per seat, is the fix (spec §4).

- [ ] **Step 1: Write the failing test**

Add to `test/botc-state.test.js`:

```js
test("appendInfoLog pushes a structured entry", () => {
  const s = state.createInitialState();
  state.appendInfoLog(s, { night: 1, seatId: 3, characterId: "empath", text: "1 evil neighbour", truthful: true });
  assert.equal(s.infoLog.length, 1);
  assert.deepEqual(s.infoLog[0], { night: 1, seatId: 3, characterId: "empath", text: "1 evil neighbour", truthful: true });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/botc-state.test.js`
Expected: FAIL — `state.appendInfoLog` is not a function.

- [ ] **Step 3: `games/botc/state.js`**

```js
function appendInfoLog(state, entry) {
  state.infoLog.push({
    night: entry.night,
    seatId: entry.seatId,
    characterId: entry.characterId,
    text: entry.text,
    truthful: entry.truthful,
  });
}
```

Add `appendInfoLog` to `module.exports`.

- [ ] **Step 4: Populate it in `games/botc/index.js`**

In the `host:botc-night-candidate` handler (Task 4's version), after computing `text`:

```js
      if (step && result.chosenCandidate && text) {
        stateModule.appendInfoLog(room.gameState, {
          night: room.gameState.dayNumber,
          seatId: step.seat.seatId,
          characterId: step.stepId,
          text,
          truthful: !!result.chosenCandidate.truthful,
        });
        if (!verbal) io.to(step.seat.playerToken).emit("game:botc-info", { text });
      }
```

(Replace the Task 4 `if (text && !verbal) io.to(...)` line with this combined block.)

Extend `publicStateView` with `infoLog: state.infoLog,` at the top level (sibling of `phase` / `seats` / `day`).

- [ ] **Step 5: Host grimoire panel**

`public/host/index.html` inside `#screen-botc-grimoire` (after `#botc-seat-list`):

```html
      <details id="botc-infolog" class="botc-infolog">
        <summary>Info log — what you've told each seat</summary>
        <div id="botc-infolog-body"></div>
      </details>
```

`public/host/botc/grimoire.js` — a render function subscribed via `onStateChange`:

```js
function renderInfoLog() {
  const state = store.latestState;
  const body = document.getElementById("botc-infolog-body");
  body.innerHTML = "";
  if (!state || !state.infoLog || state.infoLog.length === 0) {
    body.textContent = "No information sent yet.";
    return;
  }
  const bySeat = new Map();
  state.infoLog.forEach((e) => {
    if (!bySeat.has(e.seatId)) bySeat.set(e.seatId, []);
    bySeat.get(e.seatId).push(e);
  });
  for (const [seatId, entries] of bySeat) {
    const seat = state.seats.find((s) => s.seatId === seatId);
    const group = document.createElement("div");
    group.className = "botc-infolog-group";
    group.innerHTML = `<strong>${seat ? seat.nickname : "Seat " + seatId}</strong>`;
    entries.forEach((e) => {
      const row = document.createElement("div");
      row.className = "botc-infolog-row";
      row.textContent = `N${e.night} ${e.truthful ? "✅" : "❌"} — ${e.text}`;
      group.appendChild(row);
    });
    body.appendChild(group);
  }
}
```

Add `renderInfoLog()` to the `onStateChange` callback in `initGrimoire` (alongside `renderSeatList()`).

`public/host/botc/botc.css`:

```css
.botc-infolog { margin-top: 16px; }
.botc-infolog-group { margin: 8px 0; }
.botc-infolog-row { font-size: 0.9em; opacity: 0.85; }
.botc-prompt { border: 1px solid var(--accent, #c58); border-radius: 8px; padding: 8px; margin: 8px 0; }
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/botc-state.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add games/botc/state.js games/botc/index.js public/host/botc/grimoire.js public/host/index.html public/host/botc/botc.css test/botc-state.test.js
git commit -m "feat(botc): Storyteller info-log sidebar"
```

---

## Task 6: End-to-end — Virgin execution, Slayer kill ends the game, a vote past an expired timer

**Files:**
- Modify: `test/e2e-botc.js`

**Interfaces:**
- Consumes: the existing e2e helpers, plus (from the companion night plan, if run) nothing — this scenario uses a manual deal and only characters from this plan (`virgin`, `slayer`) plus `imp` / `poisoner` / `empath`.
- Produces: `Scenario 6`, invoked from `main()`.

**Context:** Read `test/e2e-botc.js`'s existing day-phase scenario (the one that nominates and executes) to reuse its nomination/vote helpers. This scenario deals manually for determinism, drives one night to reach the day, then exercises all three additions.

- [ ] **Step 1: Add the scenario**

```js
async function scenario6_dayDramaAndTimers() {
  console.log("\n[Scenario 6] Virgin execution, Slayer kill ends the game, a vote past an expired timer");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Al", "Be", "Ce", "De", "El"]);
  const seatToken = {}; // seatId -> token, filled after the deal from host state

  const dealt = once(host, "host:botc-state");
  host.emit("host:botc-manual-deal", {
    code: roomCode,
    assignments: [
      { seatId: 1, characterId: "virgin" },
      { seatId: 2, characterId: "slayer" },
      { seatId: 3, characterId: "empath" },
      { seatId: 4, characterId: "poisoner" },
      { seatId: 5, characterId: "imp" },
    ],
  });
  let state = (await dealt).state;
  state.seats.forEach((s, i) => (seatToken[s.seatId] = players[i].token));

  // First night -> day. Poison nobody important; every reveal picks its first candidate.
  state = await driveNightToEnd(host, roomCode, state, (step) => {
    const other = state.seats.find((s) => s.alive && s.seatId !== step.seatId);
    return other ? other.seatId : step.seatId;
  });
  assertTrue(state.phase === "day-discussion", "reached day 1");

  // ---- Virgin: seat 3 (a Townsfolk) nominates the Virgin (seat 1) ----
  let s2 = once(host, "host:botc-state");
  host.emit("host:botc-nominate", { code: roomCode, nominatorSeatId: 3, nomineeSeatId: 1 });
  state = (await s2).state;
  assertTrue(state.day.pendingVirgin && state.day.pendingVirgin.nominatorSeatId === 3, "the Virgin nomination paused");
  assertTrue(state.day.currentNomination === null, "no vote started yet");

  s2 = once(host, "host:botc-state");
  host.emit("host:botc-virgin-resolve", { code: roomCode, execute: true, proceed: false });
  state = (await s2).state;
  const nominator = state.seats.find((s) => s.seatId === 3);
  assertTrue(nominator.alive === false, "the Townsfolk nominator was executed by the Virgin");
  assertTrue(state.day.pendingVirgin === null, "the Virgin prompt cleared");
  console.log("  PASS -- Virgin executed the nominator on Storyteller confirm");

  // ---- Vote timer: set a 200ms timer, open a nomination, let one voter time out ----
  s2 = once(host, "host:botc-state");
  host.emit("host:botc-set-vote-timer", { code: roomCode, ms: 200 });
  state = (await s2).state;
  assertTrue(state.day.voteTimerMs === 200, "vote timer set to 200ms");

  s2 = once(host, "host:botc-state");
  host.emit("host:botc-nominate", { code: roomCode, nominatorSeatId: 4, nomineeSeatId: 5 }); // Poisoner nominates Imp
  state = (await s2).state;
  const startIndex = state.day.currentNomination.currentVoterIndex;

  // Wait out one timer tick without anyone voting; the server should auto-pass and advance.
  const advanced = await new Promise((resolve) => {
    const handler = ({ state: st }) => {
      if (st.day && st.day.currentNomination && st.day.currentNomination.currentVoterIndex > startIndex) {
        host.off("host:botc-state", handler);
        resolve(st);
      }
    };
    host.on("host:botc-state", handler);
  });
  assertTrue(
    advanced.day.currentNomination.currentVoterIndex > startIndex,
    "the vote advanced past a voter who never voted (timer auto-pass)"
  );
  console.log("  PASS -- an expired vote timer auto-passed the current voter");

  // Finish this nomination quickly by skipping the rest, then resolve.
  let guard = 0;
  while (state.day && state.day.currentNomination && guard++ < 10) {
    const s3 = once(host, "host:botc-state");
    host.emit("host:botc-skip-voter", { code: roomCode });
    state = (await s3).state;
    if (state.day.currentNomination && state.day.currentNomination.currentVoterIndex >= state.day.currentNomination.order.length) {
      const s4 = once(host, "host:botc-state");
      host.emit("host:botc-resolve-vote", { code: roomCode });
      state = (await s4).state;
      break;
    }
  }

  // ---- Slayer: seat 2 shoots seat 5 (the Imp). Storyteller confirms the kill -> good wins ----
  s2 = once(host, "host:botc-state");
  host.emit("host:botc-slayer-shot", { code: roomCode, shooterSeatId: 2, targetSeatId: 5 });
  state = (await s2).state;
  assertTrue(state.day.pendingSlayer && state.day.pendingSlayer.targetSeatId === 5, "Slayer shot is pending confirm");

  const ended = once(host, "game:botc-ended");
  host.emit("host:botc-slayer-resolve", { code: roomCode, killed: true });
  const verdict = await ended;
  assertTrue(verdict.winner === "good", "killing the Imp with the Slayer ends the game for good");
  console.log("  PASS -- Slayer shot the Demon and good won");

  host.close();
  players.forEach((p) => p.socket.close());
  void seatToken;
}
```

- [ ] **Step 2: Invoke from `main()`**

Add `await scenario6_dayDramaAndTimers();` after `scenario5...` (or after `scenario4...` if the night plan has not run), before the final success log.

- [ ] **Step 3: Run the e2e script**

Run: `node test/e2e-botc.js`
Expected: every scenario prints `PASS`, ending with `ALL BOTC E2E SCENARIOS PASSED`.

Adjust the manual deal or the `chooseTarget` callback if the first night's Poisoner poisons the Virgin or Slayer (seat 1 or 2) and changes an assertion — target the Empath (seat 3) instead for the Poisoner step.

- [ ] **Step 4: Full suite**

Run: `node --test "test/*.test.js"` then every `test/e2e-*.js` script.
Expected: 0 unit failures; every e2e script passes.

- [ ] **Step 5: Commit**

```bash
git add test/e2e-botc.js
git commit -m "test(botc): e2e for Virgin, Slayer, and vote timers"
```

---

## Self-Review

**Spec coverage (design note §3, Plan B):**
- Virgin — nomination pause + Storyteller confirm, never auto-execute, once-per-game, `used` reminder → Task 1. Passes `{ executedSeatId }` so a Saint nominator loss is handled.
- Slayer — day-only, once-per-game (`used` reminder), Storyteller-confirmed because a drunk/poisoned Slayer does nothing, public `game:botc-slayer-result` broadcast → Task 2. Storyteller-entered (player self-service noted as follow-up, per the design note's own framing of the shot as public).
- Vote timers — `state.day.voteTimerMs` default 15000, `0` disables, `host:botc-set-vote-timer`, `setTimeout` on `room.botcVoteTimer` `.unref()`'d, cleared in `maybePromptVoteTurn` / `onReset` / `host:botc-resolve-vote`, `host:botc-skip-voter` → Task 3.
- Verbal mode — global (`host:botc-set-verbal`, timers suspended), per-seat (`seat.verbal`, prompt+timer skipped), night (`verbal` flag on `host:botc-night-candidate` skips the push but still logs) → Task 4.
- infoLog — populated on every reveal with `{ night, seatId, characterId, text, truthful }`, exposed in `publicStateView`, collapsible host panel grouped by seat, nothing logged for player-driven choices → Task 5.
- e2e for the day drama and timers → Task 6.

**Placeholder scan:** Task 1's voting test has one `/* build a dealt state ... */` comment — but it is immediately followed by the actual IIFE that builds it, so the code is present, not deferred. No "TBD" / "add error handling" / "similar to Task N". Timer arming is explicitly "verified by Task 6 e2e" with a stated reason (needs a live socket + real timers), not skipped silently.

**Type consistency:**
- `state.day` fields added across tasks: `pendingVirgin` (Task 1), `pendingSlayer` (Task 2), `voteTimerMs` (Task 3), `verbalMode` (Task 4) — all seeded in `voting.startDay`'s one object, all surfaced by the one `publicStateView` `day` block, all read by `public/host/botc/day.js`.
- `voting.startNomination(state, nominator, nominee, opts)` — the 4th arg is added in Task 1 and used with `{ skipVirgin: true }` there; no other caller passes a 4th arg (safe default `{}`).
- `voting.beginVoteFor` — defined in Task 1, called by Task 1's `startNomination` and by Task 1's `host:botc-virgin-resolve`.
- `voting.shouldPromptVoter(state, seatId)` — defined in Task 4, called in Task 4's `maybePromptVoteTurn`.
- `clearVoteTimer(room)` / `room.botcVoteTimer` / `onReset` — all introduced in Task 3, extended (not renamed) in Task 4.
- `state.appendInfoLog(state, entry)` — defined in Task 5, called in Task 5's `host:botc-night-candidate` block, which is the same handler Task 4 edits (verbal flag) — Task 5's Step 4 explicitly replaces Task 4's `if (text && !verbal)` line with the combined block.
- `slayer.isSlayer` / `slayer.hasUsedShot` / `slayer.resolveShot` (Task 2) and `virgin.isUnusedVirgin` / `virgin.markUsed` (Task 1) — each defined once, consumed only by `games/botc/index.js` and their own tests.
- Reminder kind `"used"` with `sourceCharacterId` `"virgin"` / `"slayer"` distinguishes the two once-per-game markers; never cleared by `nightLoop`.

---

## Execution Handoff

This plan and its companion `2026-08-28-botc-character-library-night.md` are independent past the shared character-registration pattern; run the night plan first if doing both, so the e2e scenario numbers line up (`scenario5` then `scenario6`). If running this plan alone, renumber Task 6's scenario to `scenario5` and adjust the `main()` call site.

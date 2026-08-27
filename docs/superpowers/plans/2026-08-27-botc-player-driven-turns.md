# Blood on the Clocktower — Player-Driven Turns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Blood on the Clocktower player act on their own phone for the two interaction types the design spec says are player-driven — a night choice (Poisoner/Butler/Imp picking a target) and a day vote — while keeping the existing Storyteller-entered events working unchanged, matching the spec's Governing Principle that the grimoire is always manually overridable.

**Architecture:** `games/botc/index.js` (already built, reviewed, and merged) currently only lets the *Storyteller* submit night choices (`host:botc-night-choice`) and votes (`host:botc-vote`) on a player's behalf. The design spec (§5, §7) describes the opposite for these two interaction types: "the player picks two players first" (a choice-based character's own decision), and "the app lights up one phone at a time" for voting — the Storyteller only picks *among computed candidates* for information-reveal steps (Washerwoman, Empath, the two first-night pseudo-steps), never for a choice or a vote. This plan adds `player:botc-night-choice` and `player:botc-vote` as new, additive socket events alongside the existing host-entered ones, plus the targeted "it's your turn" push prompts a real phone needs to know when to act — matching the spec's own framing of a prompt lighting up one phone at a time, not a general state broadcast (which would also leak grimoire-only information like reminders to every player).

**Tech Stack:** Node.js (CommonJS), Socket.io 4, `node:test` for any pure-logic unit tests, `socket.io-client` for the end-to-end script — identical to the rest of this codebase. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-blood-on-the-clocktower-design.md` §5 ("Rhythm of one step", "Character module contract" — "the player picks two players first"), §7 ("The app lights up one phone at a time in seating order"), §4 ("Governing principle: the grimoire is always manually overridable")

## Global Constraints

- Working directory for every command: `party-platform-full/party-game-platform/server/`.
- No new runtime dependencies.
- Every change in this plan lives in `games/botc/index.js` and `test/e2e-botc.js` only — no task touches `games/botc/state.js`, `grimoire.js`, `dealing.js`, `distribution.js`, `characters/**`, `steps/**`, `nightLoop.js`, `voting.js`, or `winConditions.js` (all already reviewed and merged; this plan is purely additive socket wiring on top of them).
- The existing `host:botc-night-choice` and `host:botc-vote` events (and every other existing `host:botc-*` event) must keep working exactly as they do today — this plan adds alternatives, it does not replace or gate anything behind them.
- A "your turn" prompt is sent to exactly the one player whose turn it is (`io.to(seat.playerToken).emit(...)`), never broadcast to the room — broadcasting would leak information a player isn't entitled to (who else's turn is coming, or general grimoire state).
- A `player:*` event must independently verify it is genuinely that player's turn before acting — never trust that receiving a "your turn" prompt earlier is proof of anything, since prompts and actions travel over independent socket messages that could arrive out of order or be replayed.
- Source files have mixed CRLF/LF line endings. This plan only modifies existing CRLF files (`games/botc/index.js`, `test/e2e-botc.js`) — match their existing convention, do not reformat whole files.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `games/botc/index.js` (modify) | Add `maybePromptNightChoice`/`maybePromptVoteTurn` helpers, wire them into every existing state-advancing handler, and add the two new `player:botc-night-choice`/`player:botc-vote` events. |
| `test/e2e-botc.js` (modify) | Add a scenario proving a player can act on their own turn via the new events, and that an off-turn player's attempt is silently rejected. |

---

### Task 1: Night-choice turn prompts

**Files:**
- Modify: `games/botc/index.js`
- Test: manual verification via Step 4 below (no dedicated unit test — this is pure socket wiring with no new branching logic beyond a null-check, fully exercised by Task 5's e2e scenario)

**Interfaces:**
- Consumes: `nightLoop.currentStep(state)` (already exported), `room.gameState.seats`, `io.to(token).emit(...)`
- Produces: `maybePromptNightChoice(room, io) → void` (a private helper inside `attach`, not exported — matches `maybeEndNight`'s existing scoping), a new client-facing event `game:botc-your-turn`

Add this helper immediately after the existing `maybeEndNight` function (currently the first thing defined inside `attach`, right before `host:botc-night-choice`'s handler):

```js
  // Fires whenever the current night step needs a player-driven choice, so
  // that player's phone gets a targeted, minimal prompt -- matching the
  // spec's own framing ("the app lights up one phone at a time") rather
  // than a general state broadcast, which would also leak grimoire-only
  // information (reminders, other players' alignment) to every player.
  // Pseudo-steps (minion-info/demon-info) never require a choice, so this
  // never fires for them.
  function maybePromptNightChoice(room, io) {
    if (room.gameState.phase !== "night") return;
    const step = nightLoop.currentStep(room.gameState);
    if (!step || !step.requiresChoice) return;
    io.to(step.seat.playerToken).emit("game:botc-your-turn", {
      choiceType: step.requiresChoice.type,
      targets: room.gameState.seats.map((s) => ({ seatId: s.seatId, nickname: s.nickname, alive: s.alive })),
    });
  }
```

Call it, in this exact order relative to the existing code, at every place the night's current step can change:

- [ ] **Step 1: After dealing starts the first night**

In `host:botc-start`'s handler, immediately after the existing `nightLoop.startNight(state);` line and before `emitState(room, io);`, add:

```js
    maybePromptNightChoice(room, io);
```

Do the identical addition in `host:botc-manual-deal`'s handler, at the same relative position (after its own `nightLoop.startNight(state);`, before its own `emitState(room, io);`).

- [ ] **Step 2: After a Storyteller-entered choice advances the night**

In `host:botc-night-choice`'s handler, immediately after the existing `maybeEndNight(room);` line and before `emitState(room, io);`, add:

```js
      maybePromptNightChoice(room, io);
```

- [ ] **Step 3: After a Storyteller-entered candidate pick advances the night**

In `host:botc-night-candidate`'s handler, at the identical relative position (after `maybeEndNight(room);`, before `emitState(room, io);`), add the same line.

- [ ] **Step 4: After the Storyteller begins a new night**

In `host:botc-begin-night`'s handler, immediately after `nightLoop.startNight(room.gameState);` and before `emitState(room, io);`, add the same line.

- [ ] **Step 5: Verify by reading, then confirm the server still boots**

Read the full modified `games/botc/index.js` once to confirm all four call sites were added correctly and nothing else changed. Run: `node --check games/botc/index.js && node --test "test/*.test.js"` (from `party-platform-full/party-game-platform/server`) — expect syntax OK and the current unit baseline (268 tests) unaffected, since this task adds no unit tests and doesn't change any function another test calls directly.

- [ ] **Step 6: Commit**

```bash
git add games/botc/index.js
git commit -m "feat(botc): push a targeted night-choice prompt to the acting player"
```

---

### Task 2: `player:botc-night-choice`

**Files:**
- Modify: `games/botc/index.js`
- Test: covered end-to-end by Task 5

**Interfaces:**
- Consumes: `nightLoop.currentStep`/`submitChoice` (already exported), `socket.data.token` (the durable-sessions identity), `maybePromptNightChoice` (Task 1)
- Produces: new client event `player:botc-night-choice`

Add this handler inside `attach`, immediately after the existing `host:botc-night-choice` handler (so the two sibling implementations of "submit a night choice" sit next to each other in the file):

```js
  // The player-driven counterpart to host:botc-night-choice. A "your turn"
  // prompt (Task 1) is not proof of anything by itself -- this independently
  // re-derives whose turn it currently is and rejects anyone else, exactly
  // as if the prompt had never been sent.
  socket.on("player:botc-night-choice", ({ code, choice }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameState || room.gameId !== meta.id) return;
    const step = nightLoop.currentStep(room.gameState);
    if (!step || !step.requiresChoice) return;
    if (step.seat.playerToken !== socket.data.token) return;
    nightLoop.submitChoice(room.gameState, choice);
    applyWinCheckAndMaybeEnd(room, io);
    maybeEndNight(room);
    maybePromptNightChoice(room, io);
    emitState(room, io);
  });
```

- [ ] **Step 1: Write the failing test scenario in `test/e2e-botc.js`**

This is deliberately deferred to Task 5, not written here — Task 5 builds one coherent player-driven scenario covering both this task's event and Task 4's, since they're naturally exercised together in a single game flow (a night choice, then a day vote). Writing a throwaway scenario now and rewriting it in Task 5 would waste effort; skip straight to the implementation.

- [ ] **Step 2: Write the implementation**

Add the handler exactly as shown above.

- [ ] **Step 3: Verify the server still boots**

Run: `node --check games/botc/index.js && node --test "test/*.test.js"` — expect syntax OK, 268 tests unaffected.

- [ ] **Step 4: Commit**

```bash
git add games/botc/index.js
git commit -m "feat(botc): let a player submit their own night choice"
```

---

### Task 3: Voting turn prompts

**Files:**
- Modify: `games/botc/index.js`
- Test: manual verification via Step 5 below (same reasoning as Task 1 — pure wiring, exercised by Task 5's e2e scenario)

**Interfaces:**
- Consumes: `room.gameState.day.currentNomination` (voting.js's shape, already established), `stateModule.findSeatById`
- Produces: `maybePromptVoteTurn(room, io) → void` (private helper), new client-facing event `game:botc-your-turn-to-vote`

Add this helper immediately after Task 1's `maybePromptNightChoice`:

```js
  // Fires whenever it's a specific seat's turn to vote on the current
  // nomination, targeting just that player's phone with the minimal
  // context needed to decide (who's nominated) -- matching Task 1's
  // night-choice prompt's same "lights up one phone" design.
  // nomination.currentVoterIndex is voting.js's own single source of truth
  // for whose turn it is; this only reads it, never advances it.
  function maybePromptVoteTurn(room, io) {
    const nomination = room.gameState.day && room.gameState.day.currentNomination;
    if (!nomination) return;
    const voterSeatId = nomination.order[nomination.currentVoterIndex];
    if (voterSeatId === undefined) return; // every seat in this nomination has already voted
    const voterSeat = stateModule.findSeatById(room.gameState, voterSeatId);
    if (!voterSeat) return;
    const nomineeSeat = stateModule.findSeatById(room.gameState, nomination.nomineeSeatId);
    io.to(voterSeat.playerToken).emit("game:botc-your-turn-to-vote", {
      nomineeSeatId: nomination.nomineeSeatId,
      nomineeNickname: nomineeSeat ? nomineeSeat.nickname : null,
    });
  }
```

- [ ] **Step 1: After a nomination opens**

In `host:botc-nominate`'s handler, immediately after the existing `voting.startNomination(room.gameState, nominatorSeatId, nomineeSeatId);` line and before `emitState(room, io);`, add:

```js
      maybePromptVoteTurn(room, io);
```

This is safe to call unconditionally even if `startNomination` silently failed (e.g. a player already nominated today) — `maybePromptVoteTurn`'s own `if (!nomination) return;` guard correctly no-ops when there's nothing to prompt.

- [ ] **Step 2: After a Storyteller-entered vote advances to the next voter**

In `host:botc-vote`'s handler, immediately after the existing `voting.castVote(room.gameState, seatId, voted);` line and before `emitState(room, io);`, add the same line.

- [ ] **Step 3: Verify by reading, then confirm the server still boots**

Read the full modified file once to confirm both call sites were added correctly. Run: `node --check games/botc/index.js && node --test "test/*.test.js"` — expect syntax OK, 268 tests unaffected.

- [ ] **Step 4: Commit**

```bash
git add games/botc/index.js
git commit -m "feat(botc): push a targeted vote-turn prompt to the current voter"
```

---

### Task 4: `player:botc-vote`

**Files:**
- Modify: `games/botc/index.js`
- Test: covered end-to-end by Task 5

**Interfaces:**
- Consumes: `voting.castVote` (already exported), `stateModule.findSeatByToken`, `socket.data.token`, `maybePromptVoteTurn` (Task 3)
- Produces: new client event `player:botc-vote`

Add this handler immediately after the existing `host:botc-vote` handler:

```js
  // The player-driven counterpart to host:botc-vote. Re-derives whose turn
  // it is directly from state.day.currentNomination -- the one source of
  // truth voting.js itself uses -- rather than trusting the client's claim
  // about which seat they are, so a stale or spoofed request from the wrong
  // player is silently ignored exactly like an out-of-turn host:botc-vote
  // targeting the wrong seatId would be.
  socket.on("player:botc-vote", ({ code, voted }) => {
    const room = roomService.getRoom(code);
    if (!room || !room.gameState || room.gameId !== meta.id) return;
    if (!room.gameState.day || !room.gameState.day.currentNomination) return;
    const nomination = room.gameState.day.currentNomination;
    const currentSeatId = nomination.order[nomination.currentVoterIndex];
    const seat = stateModule.findSeatByToken(room.gameState, socket.data.token);
    if (!seat || seat.seatId !== currentSeatId) return;
    voting.castVote(room.gameState, seat.seatId, voted);
    maybePromptVoteTurn(room, io);
    emitState(room, io);
  });
```

- [ ] **Step 1: Write the implementation**

Add the handler exactly as shown above.

- [ ] **Step 2: Verify the server still boots**

Run: `node --check games/botc/index.js && node --test "test/*.test.js"` — expect syntax OK, 268 tests unaffected.

- [ ] **Step 3: Commit**

```bash
git add games/botc/index.js
git commit -m "feat(botc): let a player cast their own vote on their turn"
```

---

### Task 5: End-to-end proof of the player-driven flow

**Files:**
- Modify: `test/e2e-botc.js`

**Interfaces:**
- Consumes: everything from Tasks 1-4
- Produces: nothing other tasks depend on

This adds one new, mostly self-contained scenario to the existing script (its own fresh room and players, not woven into the existing host-driven scenario's exact state) — proving, against the real server: a player receives `game:botc-your-turn` and can act on it via `player:botc-night-choice` with the same effect a Storyteller-entered choice would have; a player receives `game:botc-your-turn-to-vote` and can act on it via `player:botc-vote`; and an off-turn player's `player:botc-vote` attempt is silently ignored rather than accepted.

- [ ] **Step 1: Read the existing script's helpers first**

Read `test/e2e-botc.js` in full — this task reuses its existing `connect()`, `nextToken()`, `once()`, `assertTrue()`, `createRoom()`, `joinPlayers()`, and `driveNightToEnd()`/`firstOtherAliveSeat()` helpers rather than redefining them. Confirm their exact current signatures before writing new code that calls them.

- [ ] **Step 2: Write the new scenario**

Add this as a new top-level scenario inside `main()`'s `try` block, after the existing Scenario 1's `console.log("\nALL BOTC E2E SCENARIOS PASSED");` line is moved to the very end (i.e., this new scenario runs *before* that final success line, not after it — restructure so `"ALL BOTC E2E SCENARIOS PASSED"` and `process.exit(0)` remain the last things the script does):

```js
    // ---- Scenario 2: player-driven night choice and vote, plus an off-turn vote is rejected ----
    console.log("\n[Scenario 2] A player acts on their own turn via player:botc-night-choice and player:botc-vote");
    const room2 = await createRoom();
    const players2 = await joinPlayers(room2.roomCode, ["Poisoner2", "Empath2", "Soldier2", "Butler2", "Imp2"]);

    // Registered before dealing even happens -- this deal includes both a
    // Minion and a Demon, so minion-info and demon-info both run BEFORE the
    // Poisoner (see nightOrder.js's FIRST_NIGHT_ORDER), and neither is a
    // choice step, so no prompt fires for them. Registering the listener
    // this early means it can't be missed no matter how many non-choice
    // steps precede the Poisoner's actual turn.
    const yourTurnPromise = once(players2[0].socket, "game:botc-your-turn"); // Poisoner2, seat 1
    const dealStatePromise = once(room2.host, "host:botc-state");
    room2.host.emit("host:botc-manual-deal", {
      code: room2.roomCode,
      assignments: [
        { seatId: 1, characterId: "poisoner" },
        { seatId: 2, characterId: "empath" },
        { seatId: 3, characterId: "soldier" },
        { seatId: 4, characterId: "butler" },
        { seatId: 5, characterId: "imp" },
      ],
    });
    let state2 = (await dealStatePromise).state;

    // Drive past minion-info and demon-info (candidate-based, no
    // player-turn prompt) via the host, until nightStep reaches the
    // Poisoner -- exactly like Task 13's driveNightToEnd would, but done
    // manually here since this scenario needs to stop partway through the
    // night rather than drive it to completion in one call.
    let pseudoStepGuard = 0;
    while (state2.nightStep && state2.nightStep.stepId !== "poisoner" && pseudoStepGuard < 5) {
      pseudoStepGuard++;
      const p = once(room2.host, "host:botc-state");
      const candidates = state2.nightStep.candidates;
      room2.host.emit("host:botc-night-candidate", { code: room2.roomCode, candidateId: candidates.length ? candidates[0].id : null });
      state2 = (await p).state;
    }
    assertTrue(state2.nightStep && state2.nightStep.stepId === "poisoner", "the Poisoner's turn comes right after the pseudo-steps in this deal");

    const yourTurn = await yourTurnPromise;
    assertTrue(yourTurn.choiceType === "select-one-player", "the prompt names the correct choice type");
    assertTrue(yourTurn.targets.length === 5, "the prompt lists every seat as a potential target");
    console.log("  PASS -- the Poisoner's phone receives a targeted game:botc-your-turn prompt");

    const empathSeat2Id = state2.seats.find((s) => s.nickname === "Empath2").seatId;
    const afterChoicePromise = once(room2.host, "host:botc-state");
    players2[0].socket.emit("player:botc-night-choice", { code: room2.roomCode, choice: { targetSeatId: empathSeat2Id } });
    state2 = (await afterChoicePromise).state;
    const empathAfter = state2.seats.find((s) => s.seatId === empathSeat2Id);
    assertTrue(empathAfter.reminders.some((r) => r.kind === "poisoned"), "the player-submitted choice applied the poison, same as a host-submitted one would");
    console.log("  PASS -- player:botc-night-choice has the same effect as the host-entered equivalent");

    state2 = await driveNightToEnd(room2.host, room2.roomCode, state2, (step, s) => firstOtherAliveSeat(step, s));
    assertTrue(state2.phase === "day-discussion", "the first night completes normally after the player-submitted step");

    const impSeat2 = state2.seats.find((s) => s.nickname === "Imp2");
    const poisonerSeat2 = state2.seats.find((s) => s.nickname === "Poisoner2");
    const voteTurnPromise = once(players2[0].socket, "game:botc-your-turn-to-vote"); // Poisoner2 votes first per seating order from seat 5 (Imp) as nominee -> starts at seat 1
    const nominatePromise = once(room2.host, "host:botc-state");
    room2.host.emit("host:botc-nominate", { code: room2.roomCode, nominatorSeatId: empathSeat2Id, nomineeSeatId: impSeat2.seatId });
    const voteTurn = await voteTurnPromise;
    state2 = (await nominatePromise).state;
    assertTrue(voteTurn.nomineeSeatId === impSeat2.seatId, "the vote-turn prompt names the correct nominee");
    console.log("  PASS -- the first voter's phone receives a targeted game:botc-your-turn-to-vote prompt");

    // An off-turn player (Butler2, not the current voter) tries to vote --
    // must be silently ignored, not accepted.
    const butlerSeat2 = state2.seats.find((s) => s.nickname === "Butler2");
    const butlerSocket2 = players2.find((p) => p.name === "Butler2").socket;
    butlerSocket2.emit("player:botc-vote", { code: room2.roomCode, voted: true });
    await new Promise((r) => setTimeout(r, 150)); // give a wrongly-accepted vote time to land before we check
    const stateAfterOffTurnAttempt = await new Promise((resolve) => {
      room2.host.once("host:botc-state", resolve);
      room2.host.emit("host:botc-vote", { code: room2.roomCode, seatId: poisonerSeat2.seatId, voted: true }); // the real current voter votes, forcing a fresh state emit to inspect
    });
    const votesSoFar = stateAfterOffTurnAttempt.state.day.currentNomination.votes;
    assertTrue(!votesSoFar.some((v) => v.seatId === butlerSeat2.seatId), "the off-turn player's vote was rejected, not recorded");
    assertTrue(votesSoFar.some((v) => v.seatId === poisonerSeat2.seatId), "the genuine current voter's vote (submitted via host:botc-vote here) was recorded");
    console.log("  PASS -- an off-turn player:botc-vote attempt is silently rejected");

    room2.host.disconnect();
    players2.forEach((p) => p.socket.close());
```

Confirmed against the actual current file: `createRoom()` returns `{ host, hostToken, roomCode }`; `joinPlayers(roomCode, names)` returns an array of `{ name, socket, token }`; `firstOtherAliveSeat(step, state)` and `driveNightToEnd(host, roomCode, initialState, chooseTarget)` have the signatures the snippet above uses. Still read the file yourself in Step 1 before writing — this plan's snapshot could drift if another change lands on `test/e2e-botc.js` first — but no adaptation is expected to be needed.

- [ ] **Step 3: Run it**

Run: `node test/e2e-botc.js` (from `party-platform-full/party-game-platform/server`) — expect Scenario 1's existing 10 PASS lines, then Scenario 2's 4 new PASS lines, then `ALL BOTC E2E SCENARIOS PASSED`, exit 0.

If any event name or payload shape doesn't match what Tasks 1-4's real code actually emits, fix the script to match the real implementation — do not weaken an assertion, and do not change Tasks 1-4's already-committed code to match a guess made before this script was run.

- [ ] **Step 4: Full regression**

Run:

```bash
node --test "test/*.test.js" \
  && node test/e2e-rounds.js && node test/e2e-audio-sources.js && node test/e2e-word-wolf.js \
  && node test/e2e-slip-up.js && node test/e2e-wheel.js && node test/e2e-avalon.js \
  && node test/e2e-reconnect.js && node test/e2e-botc.js
```

Expect the unit suite unchanged (268, this plan adds no unit tests) and all eight e2e scripts to pass.

- [ ] **Step 5: Commit**

```bash
git add test/e2e-botc.js
git commit -m "test: prove a player can act on their own night-choice and vote turns"
```

---

## Known limitations of this plan

- **Information-reveal steps (Washerwoman, Empath, minion-info, demon-info) are still Storyteller-picked, by design.** The spec's own character-module contract only describes player-driven input for *choice*-based characters (Poisoner, Butler, Imp — and, in the full character library, Fortune Teller and Monk); an information-only character's `computeCandidates` output is a menu the Storyteller picks from to decide what to tell the player, which this plan correctly leaves untouched (`host:botc-night-candidate` is unchanged).
- **No UI.** This plan, like the backend it extends, is entirely `socket.io-client`-testable. The grimoire/player UI is a separate follow-up plan, which now has real player-driven events to build screens around instead of needing to invent a Storyteller-only interaction model.
- **A player's `game:botc-your-turn`/`game:botc-your-turn-to-vote` prompt is not re-sent on reconnection.** `games/botc/index.js`'s existing `onPlayerRejoined` (already reviewed) re-sends role and full state, but not a fresh turn prompt — a player who reconnects mid-turn will see their role and the host's public state, but won't get a second push notification telling them it's still their turn. This is a reasonable, small gap for the UI follow-up plan to close (e.g., by having `onPlayerRejoined` also call `maybePromptNightChoice`/`maybePromptVoteTurn` scoped to just that player, if it's genuinely their turn) — not addressed here to keep this plan's diff minimal and focused on the two new events themselves.

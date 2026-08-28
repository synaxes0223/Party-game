# Blood on the Clocktower — Host UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Storyteller-facing grimoire UI (setup/dealing, night panel, day panel, manual overrides, cover button) for the already-built Blood on the Clocktower vertical-slice backend (7 characters: Washerwoman, Empath, Soldier, Butler, Poisoner, Baron, Imp), so a real game can be run end-to-end from a browser with no player-side UI yet required (the Storyteller can act on a player's behalf via manual override, per the spec's governing principle).

**Architecture:** `games/botc/index.js` already has every event needed to *drive* a game (`test/e2e-botc.js` proves this via `socket.io-client`), but its state broadcast and event set were built for that backend test, not a real grimoire: `publicStateView` hides each seat's true character/alignment from the host itself, `onPlayerRejoined` leaks that same host-only view to a *player* on reconnect, there is no way to reorder seats before the first night, and none of `grimoire.js`'s manual-override primitives (`setCharacter`, `setAlive`, `addReminder`, `removeReminder`, `reorderSeats`) are wired to any socket event. This plan closes those backend gaps first (Tasks 1-2), then builds the UI as native browser ES modules under `public/host/botc/` (spec §3) — small, focused files, no bundler, no new dependency. `public/host/host.js` and `public/host/index.html` need two narrow, additive hooks to hand off into the new UI when Blood on the Clocktower is selected (see "UI hookup" ruling below); no other existing front-end file changes.

**Tech Stack:** Node.js (CommonJS) for the backend tasks, native browser ES modules (`<script type="module">`) with no bundler for the UI tasks, `socket.io-client` for e2e verification of every new/changed backend event — identical conventions to the rest of this codebase. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-blood-on-the-clocktower-design.md` — §3 (codebase integration, native ES modules, "existing front-end files are untouched"), §4 (state model, "the grimoire is always manually overridable"), §5 (night flow rhythm), §6 (grimoire host screen: seat list, seat order, setup/dealing, reminder tokens, cover button), §7 (day: nomination, sequential voting, tally, execution)

## Ruling: UI hookup into host.js/host/index.html

The spec's literal "existing front-end files are untouched" cannot be honored at 100%: `host.js`'s Start-game button branches to a screen purely by a hardcoded `if/else` on `selectedGameId`, with no `"botc"` case, and `selectedGameId`/`roomCode` are private top-level variables in `host.js`'s own classic-script scope that no separate `<script type="module">` can read. Without *some* hook, nothing could ever show a botc screen at all.

Decision (confirmed with the user): add exactly two minimal, generic lines to `host.js` (never any botc-specific *logic* — that all lives in the new `public/host/botc/` files):
1. Expose the existing socket connection: `window.__hostSocket = socket;` — this lets the botc module reuse the *same* authenticated connection instead of opening a fragile second one (a second connection would re-trigger `player:join-room`/`host:reclaim-room`-style rejoin events observable by the *other* connection too, racing against `host.js`'s own screen-management).
2. One new branch in the Start-game handler: `else if (selectedGameId === "botc") { if (window.__botcEnterSetup) window.__botcEnterSetup(roomCode); }` — a generic "hand off to whatever registered itself" call, not grimoire logic.

`player.js` needs **zero** changes: its own screen routing is already purely event-driven (`socket.on("game:...", () => showScreen(...))`), never gated by `selectedGameId`/`currentGameId`, so the (separate, later) player-UI plan can add its own listeners on `window.__playerSocket` without touching `player.js` at all. (`player.js` still needs the one `window.__playerSocket = socket;` exposure line for that later plan — out of scope for *this* plan, which is host-only, but documented here so the future plan does not have to re-discover it.)

`public/host/index.html` gains new `<section class="screen">` elements for the botc screens (real markup, not "front-end logic") plus one `<link>` and one `<script type="module">` tag — index.html is markup/wiring, not the flat-script files the spec's reasoning was about ("Adding a grimoire to those files directly is not viable... would turn host.js into an unmaintainable switchboard").

## Global Constraints

- Working directory for every command: `party-platform-full/party-game-platform/server/`.
- No new runtime dependencies, no bundler.
- Front-end UI files use native `<script type="module">` — no build step.
- New host UI files live under `public/host/botc/`; the only existing front-end files touched are `public/host/host.js` (the two lines above) and `public/host/index.html` (new markup + link/script tags). `public/player/*` is untouched by this plan.
- Backend changes are confined to `games/botc/index.js` and `games/botc/dealing.js` — no task touches `state.js`, `grimoire.js`, `nightOrder.js`, `nightLoop.js`, `voting.js`, `winConditions.js`, `distribution.js`, or any file under `characters/`/`steps/` (all already reviewed and merged; this plan only adds new callers of their existing exports).
- Every existing `host:botc-*`/`player:botc-*` event and `test/e2e-botc.js`'s existing 2 scenarios (14 PASS lines) must keep passing unchanged — this plan adds new events/fields, it does not remove or change the meaning of existing ones, except the one documented, necessary exception: `onPlayerRejoined` no longer sends `host:botc-state` to a player (Task 1 — this was a real information-leak bug once Task 1 also extends that view with true character/alignment, and no existing test currently asserts on that specific line's behavior — confirmed by reading `test/e2e-botc.js` in full before this plan was written).
- Source files in this repo have mixed CRLF/LF line endings, and this repo has `core.autocrlf=true`: the real working-tree copy of every file this plan modifies is CRLF; `git show`/`git diff` normalize the stored blob to LF, which is expected and not a defect (confirmed independently three times across the two prior BotC plans). New files created by this plan should use LF (Node/npm-authored `.js`/`.css`/`.html` files in this repo are typically saved as LF by editors; match whatever your editor does by default — do not hand-craft CRLF).
- The Storyteller-facing UI is tuned for information density and speed (spec §1, decision 4) — no onboarding/tutorial copy, no confirmation dialogs on routine actions (only on execution and win-condition confirmation, per spec §7's "Dusk" section, which is a later plan's T6 scope — this plan's vertical slice does not yet implement automatic win-condition *prompts* beyond the backend's existing automatic `game:botc-ended` on Demon-death/evil-majority; see Task 7's scope note).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `games/botc/index.js` (modify) | Host-truth state view, safe rejoin, on-demand state request, seat-order-aware dealing, manual-override events, `distributionTable` in `meta`. |
| `games/botc/dealing.js` (modify) | Export `alignmentForTeam` so `index.js`'s manual-override handler can derive alignment from character id without duplicating the lookup table. |
| `public/host/host.js` (modify) | Two lines: expose `window.__hostSocket`, add the `"botc"` branch to the Start-game handler. |
| `public/host/index.html` (modify) | New `<section>` markup for the botc setup/grimoire screens; `<link>` + `<script type="module">` tags. |
| `public/host/botc/botc.css` (create) | Botc-specific styles, reusing the CSS custom properties already defined by `style.css`'s `:root` (same document, no re-declaration needed). |
| `public/host/botc/store.js` (create) | Tiny shared state + pub/sub (`socket`, `roomCode`, `roster`, `distributionTable`, `latestState`) so every other botc host file reacts to the same data without prop-drilling through `main.js`. |
| `public/host/botc/main.js` (create, then extended) | Entry point: socket event wiring, screen show/hide, `window.__botcEnterSetup` registration. |
| `public/host/botc/setup.js` (create) | Setup screen: seat-order reordering, random deal, manual deal. |
| `public/host/botc/grimoire.js` (create) | Persistent seat-list rendering, manual overrides (character/alive/reminders), Cover button. |
| `public/host/botc/night.js` (create) | Night panel: current step display, candidate picker, choice override, Begin Night. |
| `public/host/botc/day.js` (create) | Day panel: nomination, live tally, execute, win banner. |
| `test/e2e-botc.js` (modify) | New Scenario 3 covering every event/field this plan adds. |

---

### Task 1: Host-truth state view, safe rejoin, on-demand state request

**Files:**
- Modify: `games/botc/index.js`
- Test: `test/e2e-botc.js` (Step 4 below)

**Interfaces:**
- Consumes: `nightLoop.currentStep` (existing), `stateModule.findSeatById` (existing) — no new backend module dependencies.
- Produces: `publicStateView(state)`'s seat objects now include `characterId`, `believedCharacterId`, `alignment`; a new `host:botc-request-state` event; `onPlayerRejoined` no longer emits `host:botc-state` to a player.

Three of `attach()`'s inner functions (`maybeEndNight`, `maybePromptNightChoice`, `maybePromptVoteTurn`) never actually reference `socket` or `ctx` — they only use their own `(room, io)` parameters. They were defined inside `attach()` purely because that's where the file's `host:botc-*` handlers live, not because they need to be. `onPlayerRejoined` is a **module-level** function (called directly by the platform's `index.js`, never through `attach()`), so it cannot call them where they are today. This task hoists all three to module scope — same bodies, same call sites (JS resolves them identically whether defined at module scope or inside `attach()`, since `attach()`'s nested functions can see outer-scope names either way) — so `onPlayerRejoined` can call them too.

Replace the entire contents of `games/botc/index.js` with:

```js
// index.js (games/botc)
// Socket wiring for Blood on the Clocktower.

const stateModule = require("./state");
const grimoire = require("./grimoire");
const dealing = require("./dealing");
const distribution = require("./distribution");
const characters = require("./characters");
const nightLoop = require("./nightLoop");
const voting = require("./voting");
const winConditions = require("./winConditions");

const meta = {
  id: "botc",
  name: "Blood on the Clocktower",
  description: "A human Storyteller runs a game of hidden roles, night information, and sequential day voting.",
  minPlayers: 5,
  maxPlayers: 15,
  supportedModes: ["multiplayer"],
  // Sent to every client via the existing gameRegistry.listGames() ->
  // host:room-created/host:room-reclaimed payload, with zero new wiring --
  // the host UI's setup screen needs this table to warn (never block, per
  // spec's governing principle) when a deal doesn't match expectations,
  // and duplicating these 11 rows client-side would risk silently drifting
  // from distribution.js's own copy.
  distributionTable: distribution.BASE_TABLE,
};

// state.day.currentNomination.votes is a Map (voting.js's internal
// representation) -- a Map does not survive socket.io's JSON serialization
// (it silently arrives client-side as `{}`), so it must be converted to a
// plain array before this view is emitted.
function publicNomination(nomination) {
  if (!nomination) return null;
  return {
    nominatorSeatId: nomination.nominatorSeatId,
    nomineeSeatId: nomination.nomineeSeatId,
    order: nomination.order,
    currentVoterIndex: nomination.currentVoterIndex,
    votes: Array.from(nomination.votes.entries()).map(([seatId, voted]) => ({ seatId, voted })),
  };
}

// Without this, the Storyteller (and this task's e2e test) has no way to
// know whether the currently-active night step needs a player-driven
// choice (host:botc-night-choice) or a candidate pick (host:botc-night-
// candidate) -- or who it's currently running for. This is the one piece
// of "what do I do next" state a real grimoire UI absolutely needs, so it
// belongs in this plan's snapshot even though the rest of the UI does not.
function publicNightStep(state) {
  if (state.phase !== "night") return null;
  const step = nightLoop.currentStep(state);
  if (!step) return null;
  return {
    stepId: step.stepId,
    seatId: step.seat.seatId,
    nickname: step.seat.nickname,
    requiresChoice: step.requiresChoice,
    candidates: step.candidates,
  };
}

// The host is the Storyteller: the one party in the whole game entitled to
// every seat's TRUE character, believed character, and alignment. This is
// the grimoire itself -- withholding it here (as the earlier backend-only
// snapshot did, since it only needed phase/day/nightStep for its own e2e
// test) makes a real grimoire UI impossible to build. onPlayerRejoined
// below is what makes sure this richer view never reaches an actual player.
function publicStateView(state) {
  return {
    phase: state.phase,
    dayNumber: state.dayNumber,
    seats: state.seats.map((seat) => ({
      seatId: seat.seatId,
      nickname: seat.nickname,
      characterId: seat.characterId,
      believedCharacterId: seat.believedCharacterId,
      alignment: seat.alignment,
      alive: seat.alive,
      usedDeadVote: seat.usedDeadVote,
      reminders: seat.reminders.map((r) => ({ id: r.id, kind: r.kind, label: r.label })),
    })),
    day: state.day
      ? {
          nominationsMade: state.day.nominationsMade,
          nominationsReceived: state.day.nominationsReceived,
          currentNomination: publicNomination(state.day.currentNomination),
          onBlock: state.day.onBlock,
        }
      : null,
    nightStep: publicNightStep(state),
    ended: state.ended,
  };
}

function emitState(room, io) {
  io.to(room.hostId).emit("host:botc-state", { state: publicStateView(room.gameState) });
}

function applyWinCheckAndMaybeEnd(room, io) {
  const verdict = winConditions.checkWinCondition(room.gameState);
  if (verdict) {
    room.gameState.ended = verdict;
    room.gameState.phase = "ended";
    room.state = "results";
    io.in(room.code).emit("game:botc-ended", verdict);
  }
}

// Hoisted to module scope (see this task's description) so onPlayerRejoined
// can call them too -- none of the three ever referenced socket/ctx, only
// their own (room, io) parameters, so this is a pure relocation.
function maybeEndNight(room) {
  if (room.gameState.phase === "night" && nightLoop.isNightOver(room.gameState)) {
    room.gameState.phase = "day-discussion";
    voting.startDay(room.gameState);
  }
}

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

// Fires whenever it's a specific seat's turn to vote on the current
// nomination, targeting just that player's phone with the minimal
// context needed to decide (who's nominated) -- matching
// maybePromptNightChoice's same "lights up one phone" design.
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

// Seat order is normally just room.players' Map insertion (join) order, but
// spec §6 requires the Storyteller to be able to arrange seat order BEFORE
// the first night (physical seating rarely matches join order), and both
// host:botc-start/host:botc-manual-deal assign seatId 1..N in one shot at
// deal time with no later opportunity to change it before night 1 begins.
// seatOrder (an array of player tokens) is optional and purely additive --
// every existing caller (including test/e2e-botc.js's Scenario 1/2) omits
// it and gets today's exact behavior back via the fallback.
function orderedPlayerEntries(room, seatOrder) {
  const all = Array.from(room.players.values());
  if (!Array.isArray(seatOrder) || seatOrder.length !== all.length) return all;
  const byToken = new Map(all.map((p) => [p.id, p]));
  const ordered = seatOrder.map((token) => byToken.get(token)).filter(Boolean);
  // A seatOrder containing a duplicate token (e.g. [A, A, C] for players
  // A/B/C) would resolve to the right LENGTH (3) while silently dropping B
  // and seating A twice -- checking the count of UNIQUE tokens too catches
  // that, alongside the already-covered "unknown token" case.
  const uniqueTokenCount = new Set(seatOrder).size;
  return ordered.length === all.length && uniqueTokenCount === all.length ? ordered : all;
}

function attach(io, socket, ctx) {
  const { roomService } = ctx;

  function withHostRoom(code, fn) {
    const room = roomService.getRoom(code);
    if (!room || room.hostId !== socket.data.token) return;
    if (!room.gameState) return;
    fn(room);
  }

  socket.on("host:botc-start", ({ code, seatOrder }) => {
    const room = roomService.getRoom(code);
    if (!room || room.hostId !== socket.data.token) return;

    const state = stateModule.createInitialState();
    const playerEntries = orderedPlayerEntries(room, seatOrder);
    state.seats = playerEntries.map((p, i) => stateModule.createSeat(i + 1, p.id, p.nickname));

    const base = distribution.baseDistributionFor(state.seats.length);
    if (!base) {
      socket.emit("host:botc-error", { error: `Blood on the Clocktower needs 5-15 players (got ${state.seats.length}).` });
      return;
    }
    const dealResult = dealing.dealRandom(state, base);
    if (dealResult.error) {
      socket.emit("host:botc-error", { error: dealResult.error });
      return;
    }

    room.gameId = meta.id;
    room.gameState = state;
    room.state = "in-progress";

    for (const seat of state.seats) {
      io.to(seat.playerToken).emit("game:botc-role", { characterId: seat.believedCharacterId, alignment: seat.alignment });
    }

    nightLoop.startNight(state);
    maybePromptNightChoice(room, io);
    emitState(room, io);
  });

  socket.on("host:botc-manual-deal", ({ code, assignments, seatOrder }) => {
    // Not routed through withHostRoom -- gameState doesn't exist yet at this
    // point, and withHostRoom's own guard requires it to already be set.
    const room = roomService.getRoom(code);
    if (!room || room.hostId !== socket.data.token) return;

    const state = stateModule.createInitialState();
    const playerEntries = orderedPlayerEntries(room, seatOrder);
    state.seats = playerEntries.map((p, i) => stateModule.createSeat(i + 1, p.id, p.nickname));

    const dealResult = dealing.dealManual(state, assignments);
    if (dealResult.error) {
      socket.emit("host:botc-error", { error: dealResult.error });
      return;
    }

    room.gameId = meta.id;
    room.gameState = state;
    room.state = "in-progress";

    for (const seat of state.seats) {
      io.to(seat.playerToken).emit("game:botc-role", { characterId: seat.believedCharacterId, alignment: seat.alignment });
    }

    nightLoop.startNight(state);
    maybePromptNightChoice(room, io);
    emitState(room, io);
  });

  // Lets a (re)connecting host pull the current snapshot on demand --
  // host:room-reclaimed carries no botc state at all today, so without this
  // a host who refreshes or reconnects mid-game sees nothing until the next
  // mutation happens to fire emitState naturally.
  socket.on("host:botc-request-state", ({ code }) => {
    withHostRoom(code, (room) => {
      emitState(room, io);
    });
  });

  socket.on("host:botc-night-choice", ({ code, choice }) => {
    withHostRoom(code, (room) => {
      nightLoop.submitChoice(room.gameState, choice);
      applyWinCheckAndMaybeEnd(room, io);
      maybeEndNight(room);
      maybePromptNightChoice(room, io);
      emitState(room, io);
    });
  });

  // The player-driven counterpart to host:botc-night-choice. A "your turn"
  // prompt is not proof of anything by itself -- this independently
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

  socket.on("host:botc-night-candidate", ({ code, candidateId }) => {
    withHostRoom(code, (room) => {
      const step = nightLoop.currentStep(room.gameState);
      const result = nightLoop.submitCandidate(room.gameState, candidateId);
      if (step && result.chosenCandidate) {
        const module = characters.getModuleForStep(step.stepId);
        const text = module.renderForPlayer(result.chosenCandidate.payload);
        if (text) io.to(step.seat.playerToken).emit("game:botc-info", { text });
      }
      maybeEndNight(room);
      maybePromptNightChoice(room, io);
      emitState(room, io);
    });
  });

  socket.on("host:botc-nominate", ({ code, nominatorSeatId, nomineeSeatId }) => {
    withHostRoom(code, (room) => {
      if (room.gameState.phase !== "day-discussion" || !room.gameState.day) return;
      voting.startNomination(room.gameState, nominatorSeatId, nomineeSeatId);
      maybePromptVoteTurn(room, io);
      emitState(room, io);
    });
  });

  socket.on("host:botc-vote", ({ code, seatId, voted }) => {
    withHostRoom(code, (room) => {
      if (!room.gameState.day || !room.gameState.day.currentNomination) return;
      voting.castVote(room.gameState, seatId, voted);
      maybePromptVoteTurn(room, io);
      emitState(room, io);
    });
  });

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

  socket.on("host:botc-resolve-vote", ({ code }) => {
    withHostRoom(code, (room) => {
      if (!room.gameState.day || !room.gameState.day.currentNomination) return;
      voting.resolveNomination(room.gameState);
      emitState(room, io);
    });
  });

  socket.on("host:botc-execute", ({ code, seatId }) => {
    withHostRoom(code, (room) => {
      const seat = stateModule.findSeatById(room.gameState, seatId);
      if (seat) grimoire.setAlive(seat, false);
      applyWinCheckAndMaybeEnd(room, io);
      emitState(room, io);
    });
  });

  // The Storyteller calls this once dusk/execution is done and the game
  // hasn't ended, to move into the next night. nightLoop.startNight is only
  // otherwise called at game start (host:botc-start/host:botc-manual-deal),
  // so without this event the game would be stuck in "day-discussion"
  // forever after day 1 -- there is no automatic day-to-night transition.
  socket.on("host:botc-begin-night", ({ code }) => {
    withHostRoom(code, (room) => {
      if (room.gameState.phase === "ended") return;
      nightLoop.startNight(room.gameState);
      maybePromptNightChoice(room, io);
      emitState(room, io);
    });
  });
}

function onPlayerLeft(room, io, playerId) {
  // Seats are stable board positions; nothing to clean up on a lobby-only
  // departure (which is the only case index.js ever calls this for -- a
  // mid-game disconnect keeps the seat, per the durable-sessions plan).
}

// A returning player has lost every private message the game sent them.
// They get their own role again -- and, if it's genuinely their turn right
// now, a fresh copy of whichever prompt they would have otherwise missed.
// They do NOT get a state snapshot: publicStateView is the host's grimoire
// view (true characterId/believedCharacterId/alignment for every seat,
// including other players' evil identities) and must never reach a player.
// Calling the same maybePromptNightChoice/maybePromptVoteTurn the
// Storyteller's own actions use (rather than writing seat-scoped variants)
// means a harmless, occasional duplicate prompt to whichever OTHER seat
// currently holds the turn if a different player is the one reconnecting --
// accepted as simpler and safer than a second, parallel prompt-computation
// path that could drift from these two's logic over time.
function onPlayerRejoined(room, io, playerId) {
  const state = room.gameState;
  if (!state) return;
  const seat = stateModule.findSeatByToken(state, playerId);
  if (!seat) return;
  io.to(playerId).emit("game:botc-role", { characterId: seat.believedCharacterId, alignment: seat.alignment });
  maybePromptNightChoice(room, io);
  maybePromptVoteTurn(room, io);
}

module.exports = { meta, attach, onPlayerLeft, onPlayerRejoined };
```

- [ ] **Step 1: Write the replacement file**

Replace `games/botc/index.js` with the code above exactly.

- [ ] **Step 2: Verify the server still boots and the existing suite is unaffected**

Run: `node --check games/botc/index.js && node --test "test/*.test.js"` — expect syntax OK, 268/268 unchanged (this task adds no unit tests; it only changes `games/botc/index.js`, which no unit test file imports directly).

- [ ] **Step 3: Verify the existing e2e scenarios still pass**

Run: `node test/e2e-botc.js` — expect Scenario 1's 10 PASS lines and Scenario 2's 4 PASS lines to print unchanged, then `ALL BOTC E2E SCENARIOS PASSED`, exit 0. (Scenario 2's disconnected-player-reclaims-seat check does not assert on the exact payload of anything this task removed, so it should be unaffected — confirm this by reading the actual PASS output, not by assumption.)

- [ ] **Step 4: Add e2e coverage for this task's three changes**

Read `test/e2e-botc.js` in full first to confirm current helper signatures (`connect`, `nextToken`, `createRoom`, `joinPlayers`, `once`, `assertTrue`) before writing new code that calls them — this plan's snapshot of them (below) matches the file as of the previous plan's merge, but confirm no drift.

Add a new Scenario 3 to `test/e2e-botc.js`, inserted after Scenario 2's `players2.forEach((p) => p.socket.close());` line and before the final `console.log("\nALL BOTC E2E SCENARIOS PASSED");`/`process.exit(0)` lines (matching the existing pattern of appending scenarios before that closing block):

```js
    // ---- Scenario 3: host-truth state view, safe rejoin, on-demand state request ----
    console.log("\n[Scenario 3] The host sees true character/alignment; a rejoining player never does; a fresh host connection can pull current state");
    const room3 = await createRoom();
    const players3 = await joinPlayers(room3.roomCode, ["Alice3", "Bob3", "Carol3", "Dave3", "Eve3"]);

    const dealtPromise3 = once(room3.host, "host:botc-state");
    room3.host.emit("host:botc-manual-deal", {
      code: room3.roomCode,
      assignments: [
        { seatId: 1, characterId: "washerwoman" },
        { seatId: 2, characterId: "empath" },
        { seatId: 3, characterId: "soldier" },
        { seatId: 4, characterId: "butler" },
        { seatId: 5, characterId: "imp" },
      ],
    });
    const state3 = (await dealtPromise3).state;

    // The host's own state view must carry the truth for every seat -- this
    // is what makes a real grimoire renderable at all.
    const impSeat3 = state3.seats.find((s) => s.nickname === "Eve3");
    assertTrue(impSeat3.characterId === "imp", "the host's state view includes each seat's true characterId");
    assertTrue(impSeat3.believedCharacterId === "imp", "the host's state view includes each seat's believedCharacterId");
    assertTrue(impSeat3.alignment === "evil", "the host's state view includes each seat's true alignment");

    // A player reconnecting must NEVER receive that same truth. Rather than
    // asserting the negative on a fixed timer (flaky either way), disconnect
    // and reclaim the Imp's own seat, capture every event that arrives on
    // their socket for a bounded window, and confirm characterId/alignment
    // never appear anywhere in it -- including inside a re-sent role event,
    // which is expected to carry the player's BELIEVED character only (an
    // Imp's own role reveal legitimately includes their own characterId,
    // which is not a leak of anyone ELSE's identity -- so this checks no
    // OTHER seat's identity ever appears, and that host:botc-state itself
    // never arrives on this socket at all).
    const impPlayer3 = players3.find((p) => p.name === "Eve3");
    impPlayer3.socket.disconnect();
    await new Promise((r) => setTimeout(r, 50));
    const reconnectedImp3 = await connect();
    const receivedEvents3 = [];
    reconnectedImp3.onAny((event, payload) => receivedEvents3.push({ event, payload }));
    reconnectedImp3.emit("player:join-room", { code: room3.roomCode, nickname: "Eve3", token: impPlayer3.token });
    await new Promise((r) => setTimeout(r, 150)); // let every event onPlayerRejoined fires actually arrive
    assertTrue(
      !receivedEvents3.some((e) => e.event === "host:botc-state"),
      "a reconnecting player's socket never receives host:botc-state at all"
    );
    // No payload delivered to this socket may contain a
    // "believedCharacterId" field at all -- that field only ever appears
    // inside a seat object in the host's publicStateView, so its presence
    // anywhere in what this socket received is the specific fingerprint of
    // the removed host:botc-state leak (and the "host:botc-state" check
    // above already covers the event-name half of the same fact).
    const serialized3 = JSON.stringify(receivedEvents3);
    assertTrue(
      !serialized3.includes("believedCharacterId"),
      "no event delivered to a reconnecting player carries any seat's believedCharacterId"
    );
    reconnectedImp3.close();
    console.log("  PASS -- the host's state view carries true character/alignment, and a rejoining player never receives it");

    // A fresh host connection (simulating a reload/reconnect) can pull the
    // current snapshot on demand instead of waiting for the next mutation.
    const freshHostConn3 = await connect();
    const reclaimedPromise3 = once(freshHostConn3, "host:room-reclaimed");
    freshHostConn3.emit("host:reclaim-room", { code: room3.roomCode, token: room3.hostToken });
    await reclaimedPromise3;
    const requestedStatePromise3 = once(freshHostConn3, "host:botc-state");
    freshHostConn3.emit("host:botc-request-state", { code: room3.roomCode });
    const requestedState3 = (await requestedStatePromise3).state;
    assertTrue(requestedState3.phase === "night", "host:botc-request-state returns the actual current snapshot, not a stale one");
    console.log("  PASS -- a fresh host connection can pull the current state on demand via host:botc-request-state");

    freshHostConn3.close();
    room3.host.disconnect();
    players3.forEach((p) => p.socket.close());
```

- [ ] **Step 5: Run it**

Run: `node test/e2e-botc.js` — expect Scenario 1 (10 PASS) + Scenario 2 (4 PASS) + Scenario 3 (2 PASS) + `ALL BOTC E2E SCENARIOS PASSED`, exit 0.

- [ ] **Step 6: Full regression**

Run:

```bash
node --test "test/*.test.js" \
  && node test/e2e-rounds.js && node test/e2e-audio-sources.js && node test/e2e-word-wolf.js \
  && node test/e2e-slip-up.js && node test/e2e-wheel.js && node test/e2e-avalon.js \
  && node test/e2e-reconnect.js && node test/e2e-botc.js
```

- [ ] **Step 7: Commit**

```bash
git add games/botc/index.js test/e2e-botc.js
git commit -m "feat(botc): host-truth state view, safe player rejoin, on-demand state request"
```

---

### Task 2: Seat ordering, manual overrides, and `alignmentForTeam` export

**Files:**
- Modify: `games/botc/index.js`
- Modify: `games/botc/dealing.js`
- Test: `test/e2e-botc.js` (Step 3 below)

**Interfaces:**
- Consumes: `grimoire.reorderSeats`, `grimoire.setCharacter`, `grimoire.setAlive`, `grimoire.addReminder`, `grimoire.removeReminder` (all already exported, none yet called from `index.js`), `characters.teamOf` (already exported).
- Produces: `alignmentForTeam(team)` exported from `dealing.js`; five new host events: `host:botc-reorder-seats`, `host:botc-set-character`, `host:botc-set-alive`, `host:botc-add-reminder`, `host:botc-remove-reminder`.

Task 1 already added `seatOrder` support to `host:botc-start`/`host:botc-manual-deal` for **pre-deal** ordering. This task adds the **post-deal** reorder event plus every other manual-override primitive `grimoire.js` already has but nothing calls — realizing spec §4's "governing principle: any seat's character, alignment, life state and reminders can be edited at any time" in the socket layer, not just the data layer.

- [ ] **Step 1: Export `alignmentForTeam` from `dealing.js`**

In `games/botc/dealing.js`, change the last line from:

```js
module.exports = { dealManual, dealRandom, teamCountsOf };
```

to:

```js
module.exports = { dealManual, dealRandom, teamCountsOf, alignmentForTeam };
```

(`alignmentForTeam` is already defined earlier in that file — this only adds it to the exports so `index.js`'s new `host:botc-set-character` handler can derive alignment from a character id the same way `dealManual`/`dealRandom` already do, instead of duplicating the good/evil team lookup.)

- [ ] **Step 2: Add the five new handlers**

In `games/botc/index.js`, add `dealing.alignmentForTeam` to the existing `require("./dealing")` usage (no new require line needed — `dealing` is already required at the top of the file). Add these five handlers inside `attach()`, immediately after the existing `host:botc-request-state` handler (added by Task 1) and before `host:botc-night-choice`:

```js
  // Post-deal seat reordering (pre-deal ordering is seatOrder on
  // host:botc-start/host:botc-manual-deal, added by Task 1) -- spec §6:
  // "the Storyteller arranges seat order... and can reorder later."
  socket.on("host:botc-reorder-seats", ({ code, seatIds }) => {
    withHostRoom(code, (room) => {
      const result = grimoire.reorderSeats(room.gameState, seatIds);
      if (result.error) {
        socket.emit("host:botc-error", { error: result.error });
        return;
      }
      emitState(room, io);
    });
  });

  // Manual character/alignment override -- alignment is always derived from
  // the character's team (never accepted from the client separately), so a
  // Storyteller can never accidentally set a mismatched pair like "imp" +
  // "good".
  socket.on("host:botc-set-character", ({ code, seatId, characterId }) => {
    withHostRoom(code, (room) => {
      const seat = stateModule.findSeatById(room.gameState, seatId);
      if (!seat) return;
      const team = characters.teamOf(characterId);
      if (!team) return;
      grimoire.setCharacter(seat, characterId, dealing.alignmentForTeam(team));
      emitState(room, io);
    });
  });

  // Manual life-state override -- covers both a Storyteller correcting a
  // mistaken execution and reviving/killing a seat for any other reason the
  // grimoire's own automation doesn't cover. host:botc-execute (unchanged)
  // remains the normal path for an on-block execution.
  socket.on("host:botc-set-alive", ({ code, seatId, alive }) => {
    withHostRoom(code, (room) => {
      const seat = stateModule.findSeatById(room.gameState, seatId);
      if (!seat) return;
      grimoire.setAlive(seat, alive);
      applyWinCheckAndMaybeEnd(room, io);
      emitState(room, io);
    });
  });

  // Free-text reminder tokens -- every character's own applyChoice already
  // adds its own typed reminders (poisoned, etc.) automatically; this is
  // the Storyteller's manual escape hatch for anything the character
  // modules don't cover (spec §6: "plus free-text custom tokens").
  socket.on("host:botc-add-reminder", ({ code, seatId, label }) => {
    withHostRoom(code, (room) => {
      const seat = stateModule.findSeatById(room.gameState, seatId);
      if (!seat || !label) return;
      grimoire.addReminder(room.gameState, seat, "custom", null, label);
      emitState(room, io);
    });
  });

  socket.on("host:botc-remove-reminder", ({ code, seatId, reminderId }) => {
    withHostRoom(code, (room) => {
      const seat = stateModule.findSeatById(room.gameState, seatId);
      if (!seat) return;
      grimoire.removeReminder(seat, reminderId);
      emitState(room, io);
    });
  });
```

- [ ] **Step 3: Add e2e coverage**

Add a new Scenario 4 to `test/e2e-botc.js`, inserted after Scenario 3's closing lines (`players3.forEach((p) => p.socket.close());`) and before the final `console.log("\nALL BOTC E2E SCENARIOS PASSED");`:

```js
    // ---- Scenario 4: seat reordering and manual overrides ----
    console.log("\n[Scenario 4] Post-deal seat reordering and every manual-override event");
    const room4 = await createRoom();
    const players4 = await joinPlayers(room4.roomCode, ["Alice4", "Bob4", "Carol4", "Dave4", "Eve4"]);

    const dealtPromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-manual-deal", {
      code: room4.roomCode,
      assignments: [
        { seatId: 1, characterId: "washerwoman" },
        { seatId: 2, characterId: "empath" },
        { seatId: 3, characterId: "soldier" },
        { seatId: 4, characterId: "butler" },
        { seatId: 5, characterId: "imp" },
      ],
    });
    let state4 = (await dealtPromise4).state;
    const originalOrder4 = state4.seats.map((s) => s.nickname);
    assertTrue(originalOrder4.join(",") === "Alice4,Bob4,Carol4,Dave4,Eve4", "the deal seated players in join order by default");

    const reorderPromise4 = once(room4.host, "host:botc-state");
    const reversedSeatIds4 = state4.seats.map((s) => s.seatId).reverse();
    room4.host.emit("host:botc-reorder-seats", { code: room4.roomCode, seatIds: reversedSeatIds4 });
    state4 = (await reorderPromise4).state;
    assertTrue(
      state4.seats.map((s) => s.nickname).join(",") === "Eve4,Dave4,Carol4,Bob4,Alice4",
      "host:botc-reorder-seats re-orders the seat array to the given seatId order"
    );

    const aliceSeat4 = state4.seats.find((s) => s.nickname === "Alice4");
    const setCharPromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-set-character", { code: room4.roomCode, seatId: aliceSeat4.seatId, characterId: "poisoner" });
    state4 = (await setCharPromise4).state;
    const aliceAfter4 = state4.seats.find((s) => s.seatId === aliceSeat4.seatId);
    assertTrue(aliceAfter4.characterId === "poisoner", "host:botc-set-character overrides the seat's true character");
    assertTrue(aliceAfter4.believedCharacterId === "poisoner", "host:botc-set-character also updates believedCharacterId");
    assertTrue(aliceAfter4.alignment === "evil", "host:botc-set-character derives alignment from the character's team, not a client-supplied value");

    const setAlivePromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-set-alive", { code: room4.roomCode, seatId: aliceSeat4.seatId, alive: false });
    state4 = (await setAlivePromise4).state;
    assertTrue(state4.seats.find((s) => s.seatId === aliceSeat4.seatId).alive === false, "host:botc-set-alive overrides life state directly");

    const addReminderPromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-add-reminder", { code: room4.roomCode, seatId: aliceSeat4.seatId, label: "Drunk (test)" });
    state4 = (await addReminderPromise4).state;
    const addedReminder4 = state4.seats.find((s) => s.seatId === aliceSeat4.seatId).reminders.find((r) => r.label === "Drunk (test)");
    assertTrue(!!addedReminder4, "host:botc-add-reminder attaches a free-text custom reminder");
    assertTrue(addedReminder4.kind === "custom", "a manually-added reminder is kind 'custom'");

    const removeReminderPromise4 = once(room4.host, "host:botc-state");
    room4.host.emit("host:botc-remove-reminder", { code: room4.roomCode, seatId: aliceSeat4.seatId, reminderId: addedReminder4.id });
    state4 = (await removeReminderPromise4).state;
    assertTrue(
      !state4.seats.find((s) => s.seatId === aliceSeat4.seatId).reminders.some((r) => r.id === addedReminder4.id),
      "host:botc-remove-reminder removes the reminder by id"
    );
    console.log("  PASS -- seat reordering, character/alignment override, alive override, and add/remove reminder all work");

    room4.host.disconnect();
    players4.forEach((p) => p.socket.close());
```

- [ ] **Step 4: Run it, then full regression**

```bash
node test/e2e-botc.js
node --test "test/*.test.js" \
  && node test/e2e-rounds.js && node test/e2e-audio-sources.js && node test/e2e-word-wolf.js \
  && node test/e2e-slip-up.js && node test/e2e-wheel.js && node test/e2e-avalon.js \
  && node test/e2e-reconnect.js && node test/e2e-botc.js
```

Expect Scenario 1 (10) + Scenario 2 (4) + Scenario 3 (2) + Scenario 4 (1) PASS lines, then `ALL BOTC E2E SCENARIOS PASSED`, exit 0; unit suite unchanged at 268; all 8 e2e scripts green.

- [ ] **Step 5: Commit**

```bash
git add games/botc/index.js games/botc/dealing.js test/e2e-botc.js
git commit -m "feat(botc): seat reordering and manual-override events (character, alive, reminders)"
```

---

### Task 3: Front-end scaffolding — hooks, markup, styles, shared store

**Files:**
- Modify: `public/host/host.js`
- Modify: `public/host/index.html`
- Create: `public/host/botc/botc.css`
- Create: `public/host/botc/store.js`
- Create: `public/host/botc/main.js`
- Test: manual verification via Step 6 below (this task has no automated test — it is DOM/socket wiring with no pure logic, matching this codebase's existing convention of zero automated tests for `host.js`/`player.js`'s own DOM glue; `test/e2e-botc.js`'s Scenarios 1-4 already prove every backend event this task's UI will call)

**Interfaces:**
- Consumes: `window.__hostSocket` (this task creates the exposure), `host:room-created`/`host:room-reclaimed`/`host:room-updated`/`host:botc-state`/`host:botc-error` (all existing platform/botc events).
- Produces: `window.__botcEnterSetup(roomCode)` (called by `host.js`'s new branch); a `store` object and `setState`/`onStateChange` functions other botc files import from `./store.js` (this is the shared surface Tasks 4-7 build on — `main.js`'s own internal screen-switching is not something any later task needs to import).

- [ ] **Step 1: The two `host.js` hooks**

In `public/host/host.js`, change:

```js
const socket = io();
```

to:

```js
const socket = io();
window.__hostSocket = socket;
```

Then, in the `btn-start-game` click handler, change:

```js
document.getElementById("btn-start-game").addEventListener("click", () => {
  document.getElementById("lobby-error").textContent = "";
  if (selectedGameId === "slip-up") {
    enterSlipUpSetup();
  } else if (selectedGameId === "word-wolf") {
    enterWordSelect();
  } else if (selectedGameId === "avalon") {
    enterAvalonSetup();
  } else {
    enterTrackSelect();
  }
});
```

to:

```js
document.getElementById("btn-start-game").addEventListener("click", () => {
  document.getElementById("lobby-error").textContent = "";
  if (selectedGameId === "slip-up") {
    enterSlipUpSetup();
  } else if (selectedGameId === "word-wolf") {
    enterWordSelect();
  } else if (selectedGameId === "avalon") {
    enterAvalonSetup();
  } else if (selectedGameId === "botc") {
    if (window.__botcEnterSetup) window.__botcEnterSetup(roomCode);
  } else {
    enterTrackSelect();
  }
});
```

- [ ] **Step 2: `public/host/botc/store.js`**

```js
// store.js
// Tiny shared state + pub/sub for the botc host UI. Every other file under
// public/host/botc/ imports `store` to read the latest data and calls
// `onStateChange` to react to it, instead of main.js manually calling into
// every file on every event -- each file only subscribes to what it renders.
export const store = {
  socket: window.__hostSocket,
  roomCode: null,
  roster: [], // [{ id, nickname, ready, connected }], from room:*/host:room-* events
  distributionTable: null, // meta.distributionTable, once received
  latestState: null, // the most recent host:botc-state payload's `state`
};

const listeners = [];

export function onStateChange(fn) {
  listeners.push(fn);
}

export function setState(patch) {
  Object.assign(store, patch);
  listeners.forEach((fn) => fn(store));
}
```

- [ ] **Step 3: `public/host/botc/botc.css`**

```css
/* botc.css
   Reuses the CSS custom properties already declared by /host/style.css's
   :root (both stylesheets apply to the same document, so --bg/--panel/
   --accent/etc. are already in scope here -- no re-declaration needed). */

.botc-panel {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 20px;
  margin-bottom: 16px;
}

.botc-grimoire-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.botc-seat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.botc-seat-row {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.botc-seat-row.dead {
  opacity: 0.55;
}

.botc-seat-row-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.botc-seat-id {
  color: var(--text-dim);
  font-weight: 600;
  width: 1.5em;
}

.botc-seat-nickname {
  font-weight: 600;
  flex: 1;
}

.botc-seat-character {
  color: var(--text-dim);
}

.botc-seat-character.evil {
  color: var(--accent);
}

.botc-seat-reminders {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.botc-reminder-tag {
  background: var(--accent2);
  color: white;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 0.8rem;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.botc-reminder-tag button {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
  padding: 0;
}

.botc-seat-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.botc-seat-order-list {
  list-style: none;
  padding: 0;
  margin: 0 0 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.botc-seat-order-list li {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 8px 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.botc-manual-deal-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.botc-manual-deal-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.botc-nominate-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.botc-vote-tally {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.botc-vote-row {
  display: flex;
  justify-content: space-between;
  background: var(--panel);
  border-radius: var(--radius);
  padding: 8px 14px;
}

.botc-vote-row.current-voter {
  outline: 2px solid var(--accent);
}

.botc-onblock {
  font-weight: 600;
  margin-bottom: 12px;
}

.botc-ended-banner {
  background: linear-gradient(135deg, var(--accent), var(--accent2));
  border-radius: var(--radius);
  padding: 16px;
  text-align: center;
  font-weight: 700;
  margin-bottom: 16px;
}

.botc-cover-screen {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 999;
}

.botc-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
  margin-bottom: 12px;
}

.botc-candidate-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--panel);
  border-radius: var(--radius);
  padding: 8px 14px;
  gap: 8px;
}

.botc-target-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
```

- [ ] **Step 4: `public/host/botc/main.js`**

```js
// main.js
// Entry point for the Blood on the Clocktower host UI. This file, and every
// other file under public/host/botc/, is loaded as a native ES module
// (spec §3) -- no bundler, no build step. It never imports from or modifies
// host.js; the only integration points are the two lines added to host.js
// in this task's Step 1 (window.__hostSocket, and the "botc" branch that
// calls window.__botcEnterSetup).
import { store, setState } from "./store.js";

const screens = {
  setup: document.getElementById("screen-botc-setup"),
  grimoire: document.getElementById("screen-botc-grimoire"),
};

function showBotcScreen(name) {
  document.querySelectorAll(".screen.active").forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

// Called by host.js's Start-game handler once, when the Storyteller selects
// Blood on the Clocktower and clicks Start.
window.__botcEnterSetup = function (code) {
  setState({ roomCode: code });
  store.socket.emit("host:botc-request-state", { code });
  showBotcScreen("setup");
};

function updateRosterFromRoom(room) {
  setState({ roster: room.players });
}

function updateDistributionTable(games) {
  const botcMeta = games.find((g) => g.id === "botc");
  if (botcMeta) setState({ distributionTable: botcMeta.distributionTable });
}

store.socket.on("host:room-created", ({ room, games }) => {
  updateRosterFromRoom(room);
  updateDistributionTable(games);
});

store.socket.on("host:room-reclaimed", ({ room, games, gameId }) => {
  updateRosterFromRoom(room);
  updateDistributionTable(games);
  // A page reload/reconnect while already mid-botc-game: re-request state so
  // the grimoire re-populates instead of sitting empty until the next
  // Storyteller action happens to trigger a broadcast.
  if (gameId === "botc") {
    setState({ roomCode: room.code });
    store.socket.emit("host:botc-request-state", { code: room.code });
  }
});

store.socket.on("host:room-updated", ({ room }) => updateRosterFromRoom(room));

store.socket.on("host:botc-state", ({ state }) => {
  setState({ latestState: state });
  if (state.phase !== "setup") showBotcScreen("grimoire");
});

store.socket.on("host:botc-error", ({ error }) => {
  const el = document.getElementById("botc-setup-error");
  if (el) el.textContent = error;
});
```

- [ ] **Step 5: `public/host/index.html` additions**

In the `<head>`, after the existing `<link rel="stylesheet" href="/host/style.css" />`, add:

```html
<link rel="stylesheet" href="/host/botc/botc.css" />
```

Inside `#app`, immediately before the closing `</div>` that ends `#app` (i.e., as the last two `<section>` children, after `screen-results`), add:

```html
    <section id="screen-botc-setup" class="screen">
      <h2>Set up Blood on the Clocktower</h2>
      <p class="subtitle"><span id="botc-player-count">0</span> players joined.</p>
      <p id="botc-distribution-hint" class="hint"></p>

      <h3>Seat order (adjacency matters)</h3>
      <ol id="botc-seat-order-list" class="botc-seat-order-list"></ol>

      <button type="button" id="btn-botc-random-deal" class="btn-primary">Deal Randomly</button>

      <h3>Or assign manually</h3>
      <div id="botc-manual-deal-rows" class="botc-manual-deal-rows"></div>
      <button type="button" id="btn-botc-manual-deal" class="btn-secondary">Deal These Characters</button>

      <p id="botc-setup-error" class="error"></p>
    </section>

    <section id="screen-botc-grimoire" class="screen">
      <div class="botc-grimoire-header">
        <h2 id="botc-phase-title">Blood on the Clocktower</h2>
        <button type="button" id="btn-botc-cover" class="btn-secondary">🙈 Cover</button>
      </div>

      <div id="botc-ended-banner" class="botc-ended-banner" hidden></div>

      <div id="botc-night-panel" class="botc-panel" hidden>
        <h3 id="botc-night-step-title"></h3>
        <div id="botc-night-candidate-area" class="botc-candidate-list"></div>
        <div id="botc-night-choice-area" class="botc-target-grid"></div>
        <button type="button" id="btn-botc-begin-night" class="btn-primary" hidden>
          Begin Night <span id="botc-begin-night-number"></span>
        </button>
      </div>

      <div id="botc-day-panel" class="botc-panel" hidden>
        <div class="botc-nominate-row">
          <select id="botc-nominator-select" class="input-field"></select>
          <span>nominates</span>
          <select id="botc-nominee-select" class="input-field"></select>
          <button type="button" id="btn-botc-nominate" class="btn-secondary">Nominate</button>
        </div>
        <div id="botc-vote-tally" class="botc-vote-tally"></div>
        <div id="botc-onblock" class="botc-onblock"></div>
        <button type="button" id="btn-botc-execute" class="btn-primary" hidden>Execute</button>
      </div>

      <div id="botc-seat-list" class="botc-seat-list"></div>

      <div id="botc-cover-screen" class="botc-cover-screen" hidden>
        <p>Grimoire hidden.</p>
        <button type="button" id="btn-botc-uncover" class="btn-primary">Reveal Grimoire</button>
      </div>
    </section>
```

Immediately before the closing `</body>`, after the existing `<script src="/host/host.js"></script>` line, add:

```html
  <script type="module" src="/host/botc/main.js"></script>
```

(Order matters: the module script must load after `host.js` so `window.__hostSocket` already exists when `store.js`'s top-level `socket: window.__hostSocket` runs — confirmed safe because `<script type="module">` is deferred by default, always executing after every preceding classic `<script>` on the page has run.)

- [ ] **Step 6: Manual verification**

This task has no automated test. Verify manually:
1. Run `node index.js` from `party-platform-full/party-game-platform/server`.
2. Open the host page in a browser, create a room, join one player from another tab/device, select "Blood on the Clocktower", click Start.
3. Confirm the new (currently mostly-empty) setup screen appears with no console errors, and the seat-order list shows the joined player(s).
4. Confirm no existing game (Find the Imposter, Word Wolf, Slip-Up, Avalon) is affected by these changes — spot-check one existing game's flow still works end to end.

- [ ] **Step 7: Commit**

```bash
git add public/host/host.js public/host/index.html public/host/botc/botc.css public/host/botc/store.js public/host/botc/main.js
git commit -m "feat(botc): host UI scaffolding -- hooks, markup, styles, shared store"
```

---

### Task 4: Setup screen — seat order, random deal, manual deal

**Files:**
- Create: `public/host/botc/setup.js`
- Modify: `public/host/botc/main.js` (import and initialize)
- Test: manual verification via Step 4 below (backend events this calls are already e2e-covered by Tasks 1-2's Scenarios 3-4; the DOM wiring itself follows this codebase's existing no-automated-test convention for host-side glue)

**Interfaces:**
- Consumes: `store`, `setState`, `onStateChange` (Task 3); `host:botc-start`, `host:botc-manual-deal` (existing, now `seatOrder`-aware per Task 1); the 7 vertical-slice character ids (hardcoded here, matching how `host.js` already hardcodes small per-game display tables like `AVALON_PHASE_LABEL`).
- Produces: `initSetup()`, called once from `main.js`.

- [ ] **Step 1: `public/host/botc/setup.js`**

```js
// setup.js
// The pre-game screen: arrange seat order (adjacency-dependent characters
// and the voting order both read this), then deal -- randomly (the backend
// picks characters respecting the player-count distribution table) or
// manually (the Storyteller assigns every seat's character by hand).
import { store, onStateChange } from "./store.js";

// The vertical slice's 7 implemented characters. Team here is display-only
// (grouping the manual-deal dropdown); the server independently derives the
// authoritative team/alignment from the character id itself (dealing.js's
// alignmentForTeam) -- this list drifting from characters/index.js's
// TEAM_OF would only ever mislabel a dropdown group, never mis-assign an
// actual alignment.
const CHARACTERS = [
  { id: "washerwoman", label: "Washerwoman", team: "Townsfolk" },
  { id: "empath", label: "Empath", team: "Townsfolk" },
  { id: "soldier", label: "Soldier", team: "Townsfolk" },
  { id: "butler", label: "Butler", team: "Outsider" },
  { id: "poisoner", label: "Poisoner", team: "Minion" },
  { id: "baron", label: "Baron", team: "Minion" },
  { id: "imp", label: "Imp", team: "Demon" },
];

// Local reordering happens purely client-side against this array of player
// ids until Deal is clicked -- the server has no notion of "seat order"
// before a deal exists at all (seats are created BY dealing).
let orderedPlayerIds = [];

function syncOrderedPlayerIdsFromRoster() {
  const rosterIds = store.roster.map((p) => p.id);
  // Preserve any manual reordering already done for players still present;
  // append newly-joined players at the end; drop anyone who left.
  const kept = orderedPlayerIds.filter((id) => rosterIds.includes(id));
  const added = rosterIds.filter((id) => !kept.includes(id));
  orderedPlayerIds = [...kept, ...added];
}

function nicknameFor(playerId) {
  const p = store.roster.find((r) => r.id === playerId);
  return p ? p.nickname : "(unknown)";
}

function renderSeatOrderList() {
  const list = document.getElementById("botc-seat-order-list");
  list.innerHTML = "";
  orderedPlayerIds.forEach((playerId, index) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = `${index + 1}. ${nicknameFor(playerId)}`;
    const controls = document.createElement("span");

    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "btn-secondary";
    upBtn.textContent = "↑";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => {
      [orderedPlayerIds[index - 1], orderedPlayerIds[index]] = [orderedPlayerIds[index], orderedPlayerIds[index - 1]];
      renderSeatOrderList();
    });

    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "btn-secondary";
    downBtn.textContent = "↓";
    downBtn.disabled = index === orderedPlayerIds.length - 1;
    downBtn.addEventListener("click", () => {
      [orderedPlayerIds[index + 1], orderedPlayerIds[index]] = [orderedPlayerIds[index], orderedPlayerIds[index + 1]];
      renderSeatOrderList();
    });

    controls.appendChild(upBtn);
    controls.appendChild(downBtn);
    li.appendChild(label);
    li.appendChild(controls);
    list.appendChild(li);
  });
}

function distributionHintFor(playerCount) {
  if (!store.distributionTable) return "";
  const row = store.distributionTable[playerCount];
  if (!row) return `No distribution entry for ${playerCount} players (need 5-15).`;
  return `Expected for ${playerCount} players: ${row.townsfolk} Townsfolk, ${row.outsiders} Outsiders, ${row.minions} Minion(s), ${row.demon} Demon. (A Baron in play shifts this by +2 Outsiders/-2 Townsfolk -- this is only a suggestion; dealing never blocks on it.)`;
}

function renderManualDealRows() {
  const container = document.getElementById("botc-manual-deal-rows");
  container.innerHTML = "";
  orderedPlayerIds.forEach((playerId, index) => {
    const row = document.createElement("div");
    row.className = "botc-manual-deal-row";
    const seatNumber = index + 1;
    const select = document.createElement("select");
    select.className = "input-field";
    select.dataset.playerId = playerId;
    select.innerHTML = `<option value="">-- choose --</option>` + CHARACTERS.map((c) => `<option value="${c.id}">${c.label} (${c.team})</option>`).join("");
    row.innerHTML = `<span>${seatNumber}. ${nicknameFor(playerId)}</span>`;
    row.appendChild(select);
    container.appendChild(row);
  });
}

function renderAll() {
  document.getElementById("botc-player-count").textContent = store.roster.length;
  document.getElementById("botc-distribution-hint").textContent = distributionHintFor(store.roster.length);
  syncOrderedPlayerIdsFromRoster();
  renderSeatOrderList();
  renderManualDealRows();
}

export function initSetup() {
  onStateChange(() => renderAll());
  renderAll();

  document.getElementById("btn-botc-random-deal").addEventListener("click", () => {
    document.getElementById("botc-setup-error").textContent = "";
    store.socket.emit("host:botc-start", { code: store.roomCode, seatOrder: orderedPlayerIds });
  });

  document.getElementById("btn-botc-manual-deal").addEventListener("click", () => {
    document.getElementById("botc-setup-error").textContent = "";
    const selects = document.querySelectorAll("#botc-manual-deal-rows select");
    const assignments = [];
    for (let i = 0; i < orderedPlayerIds.length; i++) {
      const characterId = selects[i].value;
      if (!characterId) {
        document.getElementById("botc-setup-error").textContent = "Assign a character to every seat before dealing manually.";
        return;
      }
      assignments.push({ seatId: i + 1, characterId });
    }
    store.socket.emit("host:botc-manual-deal", { code: store.roomCode, assignments, seatOrder: orderedPlayerIds });
  });
}
```

- [ ] **Step 2: Wire it into `main.js`**

In `public/host/botc/main.js`, add the import at the top:

```js
import { initSetup } from "./setup.js";
```

and call it once, at the end of the file:

```js
initSetup();
```

- [ ] **Step 3: Verify the server still boots**

Run: `node --check public/host/botc/setup.js` — Node can syntax-check an ES module file directly even though it never executes it server-side; expect no output (OK). Also re-run `node --test "test/*.test.js" && node test/e2e-botc.js` to confirm this front-end-only task didn't touch anything the backend suites cover — expect both unchanged.

- [ ] **Step 4: Manual verification**

1. Run `node index.js`, open the host page, create a room, join 5+ players.
2. Select Blood on the Clocktower, click Start — confirm the setup screen shows the distribution hint and the seat-order list with up/down buttons that actually reorder rows.
3. Click "Deal Randomly" — confirm the screen transitions to the (still mostly-empty, until Task 5) grimoire screen.
4. Repeat with "Deal These Characters" after assigning each seat a character in the manual dropdowns — confirm the same transition, and confirm leaving one dropdown unset shows the inline error without emitting anything.

- [ ] **Step 5: Commit**

```bash
git add public/host/botc/setup.js public/host/botc/main.js
git commit -m "feat(botc): setup screen -- seat order, random deal, manual deal"
```

---

### Task 5: Grimoire seat list, manual overrides, Cover button

**Files:**
- Create: `public/host/botc/grimoire.js`
- Modify: `public/host/botc/main.js` (import and initialize)
- Test: manual verification via Step 4 below

**Interfaces:**
- Consumes: `store`, `setState`, `onStateChange` (Task 3); `host:botc-reorder-seats`, `host:botc-set-character`, `host:botc-set-alive`, `host:botc-add-reminder`, `host:botc-remove-reminder` (Task 2, already e2e-covered).
- Produces: `initGrimoire()`, called once from `main.js`. Renders `#botc-seat-list` on every `host:botc-state` update — this is the one persistent component every other screen (night/day panels, Tasks 6-7) sits alongside.

- [ ] **Step 1: `public/host/botc/grimoire.js`**

```js
// grimoire.js
// The persistent seat list -- always visible once dealing has happened,
// alongside whichever of the night/day panels (Tasks 6-7) is currently
// relevant. Realizes spec §4's governing principle in the UI: every field
// (character, alignment via character, alive, reminders) is editable here
// at any time, not just what the current night step or vote happens to
// expose.
import { store, onStateChange } from "./store.js";

const CHARACTERS = [
  { id: "washerwoman", label: "Washerwoman" },
  { id: "empath", label: "Empath" },
  { id: "soldier", label: "Soldier" },
  { id: "butler", label: "Butler" },
  { id: "poisoner", label: "Poisoner" },
  { id: "baron", label: "Baron" },
  { id: "imp", label: "Imp" },
];

function characterLabel(characterId) {
  const found = CHARACTERS.find((c) => c.id === characterId);
  return found ? found.label : characterId || "(none)";
}

// seat.seatId is a stable identifier (spec §4: "independent of player
// identity") that grimoire.reorderSeats deliberately does NOT renumber when
// the array order changes -- only the seat objects' positions move. But
// spec §6's whole adjacency-list concept ("seats 1 and 4 are adjacent")
// depends on the DISPLAYED numbers running 1..N in the same order the rows
// are drawn in. displayNumber (this row's 1-based position in state.seats,
// passed in by renderSeatList) is what gets shown; seat.seatId remains what
// every socket emit and data-*-for attribute below targets, since that's
// the identifier the backend's handlers actually key on.
function renderSeatRow(seat, displayNumber) {
  const row = document.createElement("div");
  row.className = "botc-seat-row" + (seat.alive ? "" : " dead");
  row.dataset.seatId = seat.seatId;

  const main = document.createElement("div");
  main.className = "botc-seat-row-main";

  const believedSuffix =
    seat.characterId !== seat.believedCharacterId ? ` (believes ${characterLabel(seat.believedCharacterId)})` : "";
  main.innerHTML = `
    <span class="botc-seat-id">${displayNumber}</span>
    <span class="botc-seat-nickname">${seat.nickname}</span>
    <span class="botc-seat-character ${seat.alignment === "evil" ? "evil" : ""}">${characterLabel(seat.characterId)}${believedSuffix}</span>
    <span>${seat.alive ? "alive" : "dead" + (seat.usedDeadVote ? ", dead vote used" : ", dead vote unused")}</span>
  `;
  row.appendChild(main);

  const reminders = document.createElement("div");
  reminders.className = "botc-seat-reminders";
  seat.reminders.forEach((r) => {
    const tag = document.createElement("span");
    tag.className = "botc-reminder-tag";
    tag.innerHTML = `${r.label} <button type="button" data-remove-reminder="${r.id}">×</button>`;
    reminders.appendChild(tag);
  });
  row.appendChild(reminders);

  const controls = document.createElement("div");
  controls.className = "botc-seat-controls";

  const charSelect = document.createElement("select");
  charSelect.className = "input-field";
  charSelect.innerHTML = CHARACTERS.map((c) => `<option value="${c.id}" ${c.id === seat.characterId ? "selected" : ""}>${c.label}</option>`).join("");
  charSelect.dataset.setCharacterFor = seat.seatId;

  const aliveBtn = document.createElement("button");
  aliveBtn.type = "button";
  aliveBtn.className = "btn-secondary";
  aliveBtn.textContent = seat.alive ? "Mark dead" : "Revive";
  aliveBtn.dataset.toggleAliveFor = seat.seatId;
  aliveBtn.dataset.nextAlive = seat.alive ? "false" : "true";

  const reminderInput = document.createElement("input");
  reminderInput.type = "text";
  reminderInput.className = "input-field";
  reminderInput.placeholder = "Add reminder…";
  reminderInput.dataset.reminderInputFor = seat.seatId;

  const addReminderBtn = document.createElement("button");
  addReminderBtn.type = "button";
  addReminderBtn.className = "btn-secondary";
  addReminderBtn.textContent = "Add";
  addReminderBtn.dataset.addReminderFor = seat.seatId;

  controls.appendChild(charSelect);
  controls.appendChild(aliveBtn);
  controls.appendChild(reminderInput);
  controls.appendChild(addReminderBtn);
  row.appendChild(controls);

  return row;
}

function renderSeatList() {
  const container = document.getElementById("botc-seat-list");
  container.innerHTML = "";
  const state = store.latestState;
  if (!state) return;
  state.seats.forEach((seat, index) => container.appendChild(renderSeatRow(seat, index + 1)));
}

// Event delegation on the container -- rows are fully re-rendered on every
// state update, so listeners attached directly to row elements would need
// re-attaching every time; delegating to the stable container avoids that.
function wireSeatListDelegation() {
  const container = document.getElementById("botc-seat-list");

  container.addEventListener("change", (e) => {
    const seatId = e.target.dataset.setCharacterFor;
    if (seatId) {
      store.socket.emit("host:botc-set-character", { code: store.roomCode, seatId: Number(seatId), characterId: e.target.value });
    }
  });

  container.addEventListener("click", (e) => {
    const toggleSeatId = e.target.dataset.toggleAliveFor;
    if (toggleSeatId) {
      store.socket.emit("host:botc-set-alive", {
        code: store.roomCode,
        seatId: Number(toggleSeatId),
        alive: e.target.dataset.nextAlive === "true",
      });
      return;
    }

    const addSeatId = e.target.dataset.addReminderFor;
    if (addSeatId) {
      const input = container.querySelector(`[data-reminder-input-for="${addSeatId}"]`);
      const label = input.value.trim();
      if (!label) return;
      store.socket.emit("host:botc-add-reminder", { code: store.roomCode, seatId: Number(addSeatId), label });
      input.value = "";
      return;
    }

    const removeReminderId = e.target.dataset.removeReminder;
    if (removeReminderId) {
      // The reminder belongs to whichever seat's row contains this button --
      // read the seat id directly off the row's own dataset (set in
      // renderSeatRow) rather than inferring it from DOM position.
      const row = e.target.closest(".botc-seat-row");
      const seatId = Number(row.dataset.seatId);
      store.socket.emit("host:botc-remove-reminder", { code: store.roomCode, seatId, reminderId: Number(removeReminderId) });
    }
  });
}

function wireCoverButton() {
  const coverScreen = document.getElementById("botc-cover-screen");
  document.getElementById("btn-botc-cover").addEventListener("click", () => {
    coverScreen.hidden = false;
  });
  document.getElementById("btn-botc-uncover").addEventListener("click", () => {
    coverScreen.hidden = true;
  });
}

export function initGrimoire() {
  onStateChange(() => renderSeatList());
  wireSeatListDelegation();
  wireCoverButton();
}
```

- [ ] **Step 2: Wire it into `main.js`**

Add the import:

```js
import { initGrimoire } from "./grimoire.js";
```

and call it at the end of the file, alongside `initSetup()`:

```js
initGrimoire();
```

- [ ] **Step 3: Verify**

Run: `node --check public/host/botc/grimoire.js` (expect no output) and re-run `node --test "test/*.test.js" && node test/e2e-botc.js` (expect unchanged — this task touches no backend file).

- [ ] **Step 4: Manual verification**

1. Deal a game (random or manual) from the setup screen.
2. On the grimoire screen, confirm every seat shows its true character, alignment color, alive/dead state, and reminders.
3. Change a seat's character via its dropdown — confirm the row updates and alignment follows the new character's team.
4. Click "Mark dead" / "Revive" on a seat — confirm it toggles and the row's dead styling applies/clears.
5. Add a free-text reminder, confirm it appears as a removable tag; click its `×` and confirm it disappears.
6. Click "🙈 Cover" — confirm the whole grimoire is replaced by a blank cover screen; click "Reveal Grimoire" to restore it.

- [ ] **Step 5: Commit**

```bash
git add public/host/botc/grimoire.js public/host/botc/main.js
git commit -m "feat(botc): grimoire seat list, manual overrides, Cover button"
```

---

### Task 6: Night panel

**Files:**
- Create: `public/host/botc/night.js`
- Modify: `public/host/botc/main.js` (import and initialize)
- Test: manual verification via Step 4 below

**Interfaces:**
- Consumes: `store`, `setState`, `onStateChange` (Task 3); `state.nightStep` (already in `publicStateView`, unchanged by this plan); `host:botc-night-candidate`, `host:botc-night-choice`, `host:botc-begin-night` (all pre-existing events).
- Produces: `initNightPanel()`, called once from `main.js`.

Until the (separate, later) player-UI plan ships, the Storyteller's `host:botc-night-choice` submission below is not a "fallback for verbal mode" — it is the *only* way a choice-based step (Poisoner/Butler/Imp) gets resolved at all, since no player has a night-choice screen yet. This is intentional and matches spec §1's explicit staging ("a first-time Storyteller borrowing the app will struggle... accepted") and §9's own staged rollout.

- [ ] **Step 1: `public/host/botc/night.js`**

```js
// night.js
// The night panel: shows the current step (character or pseudo-step), lets
// the Storyteller pick a candidate for information-reveal steps
// (Washerwoman/Empath/minion-info/demon-info), or submit a target on a
// choice-based character's behalf (Poisoner/Butler/Imp) -- the only way a
// choice resolves until the separate player-UI plan ships self-service
// night-choice screens. "Begin Night" starts night 2+ once the day is over.
import { store, onStateChange } from "./store.js";

const STEP_LABEL = {
  "minion-info": "Minion learns the Demon",
  "demon-info": "Demon learns their Minion(s) and bluffs",
  washerwoman: "Washerwoman",
  empath: "Empath",
  soldier: "Soldier",
  butler: "Butler",
  poisoner: "Poisoner",
  baron: "Baron",
  imp: "Imp",
};

function stepLabel(stepId) {
  return STEP_LABEL[stepId] || stepId;
}

function renderCandidates(step) {
  const area = document.getElementById("botc-night-candidate-area");
  area.innerHTML = "";
  if (!step || !step.candidates || step.requiresChoice) return;

  // A candidate-based step can legally have zero candidates (e.g. the
  // Demon-bluffs step once every implemented good character is already
  // dealt -- a documented limitation of steps/demonInfo.js, not a bug).
  // nightLoop.submitCandidate accepts candidateId: null for exactly this
  // case (test/e2e-botc.js's driveNightToEnd already relies on it) -- without
  // a way to submit that from the UI, the night would be stuck here forever.
  if (step.candidates.length === 0) {
    const skipBtn = document.createElement("button");
    skipBtn.type = "button";
    skipBtn.className = "btn-secondary";
    skipBtn.textContent = "No info to send — Advance";
    skipBtn.addEventListener("click", () => {
      store.socket.emit("host:botc-night-candidate", { code: store.roomCode, candidateId: null });
    });
    area.appendChild(skipBtn);
    return;
  }

  const trueCandidates = step.candidates.filter((c) => c.truthful);
  const falseCandidates = step.candidates.filter((c) => !c.truthful);

  if (trueCandidates.length > 0) {
    const randomBtn = document.createElement("button");
    randomBtn.type = "button";
    randomBtn.className = "btn-secondary";
    randomBtn.textContent = "🎲 Pick a true one at random";
    randomBtn.addEventListener("click", () => {
      const pick = trueCandidates[Math.floor(Math.random() * trueCandidates.length)];
      store.socket.emit("host:botc-night-candidate", { code: store.roomCode, candidateId: pick.id });
    });
    area.appendChild(randomBtn);
  }

  [...trueCandidates, ...falseCandidates].forEach((c) => {
    const row = document.createElement("div");
    row.className = "botc-candidate-row";
    const label = document.createElement("span");
    label.textContent = `${c.truthful ? "✅ True" : "❌ False"} — ${c.label}`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary";
    btn.textContent = "Send";
    btn.addEventListener("click", () => {
      store.socket.emit("host:botc-night-candidate", { code: store.roomCode, candidateId: c.id });
    });
    row.appendChild(label);
    row.appendChild(btn);
    area.appendChild(row);
  });
}

function renderChoiceOverride(step) {
  const area = document.getElementById("botc-night-choice-area");
  area.innerHTML = "";
  if (!step || !step.requiresChoice) return;

  const state = store.latestState;
  const excludeSelf = step.requiresChoice.type === "select-one-player-excluding-self";
  const targets = state.seats.filter((s) => !excludeSelf || s.seatId !== step.seatId);

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

function renderNightPanel() {
  const state = store.latestState;
  const panel = document.getElementById("botc-night-panel");
  if (!state || state.phase !== "night") {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  const step = state.nightStep;
  const titleEl = document.getElementById("botc-night-step-title");
  const beginBtn = document.getElementById("btn-botc-begin-night");

  if (!step) {
    // nightStep is null once every step this night has resolved, but the
    // server auto-transitions phase to "day-discussion" itself once that
    // happens (nightLoop.isNightOver, checked after every submission) --
    // seeing phase still "night" with a null step should not normally
    // persist, but render a neutral message rather than nothing if it does.
    titleEl.textContent = "Night complete — waiting to move to day.";
    beginBtn.hidden = true;
    document.getElementById("botc-night-candidate-area").innerHTML = "";
    document.getElementById("botc-night-choice-area").innerHTML = "";
    return;
  }

  titleEl.textContent = `${stepLabel(step.stepId)} — ${step.nickname}`;
  beginBtn.hidden = true;
  renderCandidates(step);
  renderChoiceOverride(step);
}

// Runs after renderNightPanel in the same onStateChange callback (see
// initNightPanel below). During phase "night", renderNightPanel already
// manages #botc-night-panel's own visibility and content; this function's
// job there is only to make sure the begin-night button stays hidden.
function renderBeginNightButton() {
  const state = store.latestState;
  const beginBtn = document.getElementById("btn-botc-begin-night");
  if (!state || state.phase !== "day-discussion") {
    beginBtn.hidden = true;
    return;
  }
  document.getElementById("botc-night-panel").hidden = false;
  document.getElementById("botc-night-step-title").textContent = "";
  document.getElementById("botc-night-candidate-area").innerHTML = "";
  document.getElementById("botc-night-choice-area").innerHTML = "";
  beginBtn.hidden = false;
  document.getElementById("botc-begin-night-number").textContent = state.dayNumber + 1;
}

export function initNightPanel() {
  onStateChange(() => {
    renderNightPanel();
    renderBeginNightButton();
  });

  document.getElementById("btn-botc-begin-night").addEventListener("click", () => {
    store.socket.emit("host:botc-begin-night", { code: store.roomCode });
  });
}
```

- [ ] **Step 2: Wire it into `main.js`**

Add the import and call:

```js
import { initNightPanel } from "./night.js";
```

```js
initNightPanel();
```

- [ ] **Step 3: Verify**

Run: `node --check public/host/botc/night.js` (expect no output) and re-run `node --test "test/*.test.js" && node test/e2e-botc.js` (expect unchanged).

- [ ] **Step 4: Manual verification**

1. Deal a manual game with characters `washerwoman, empath, soldier, poisoner, imp` across 5 seats.
2. Confirm the night panel shows the Minion/Demon-info pseudo-steps first (no target buttons — pseudo-steps never require a choice, only candidates; if their candidate list happens to be empty for a 5-player deal with only one minion and one demon, confirm the panel still shows the step title without erroring).
3. Confirm the Poisoner's step shows a grid of target buttons (choice override) and clicking one advances the night.
4. Confirm the Washerwoman/Empath steps show grouped true/false candidates plus the "pick a true one at random" button, and clicking either sends the info and advances.
5. Confirm once every step resolves, the phase becomes "day-discussion" and a "Begin Night 2" button appears instead of the night panel's step content.

- [ ] **Step 5: Commit**

```bash
git add public/host/botc/night.js public/host/botc/main.js
git commit -m "feat(botc): night panel -- candidate picker, choice override, begin-night"
```

---

### Task 7: Day panel

**Files:**
- Create: `public/host/botc/day.js`
- Modify: `public/host/botc/main.js` (import and initialize)
- Test: manual verification via Step 4 below

**Interfaces:**
- Consumes: `store`, `setState`, `onStateChange` (Task 3); `state.day` (already in `publicStateView`, unchanged by this plan); `host:botc-nominate`, `host:botc-vote`, `host:botc-resolve-vote`, `host:botc-execute` (all pre-existing events).
- Produces: `initDayPanel()`, called once from `main.js`.

**Scope note:** this task renders the day panel and the automatic `ended` banner the backend already computes (Demon death / evil-majority via `game:botc-ended`, unchanged by this plan). The spec's §7 Virgin-nomination prompt and Mayor's "three alive, no execution" prompt are Storyteller-judgment confirmations the *backend* does not implement yet either (they are T4/T6 character-library work per spec §9, out of this vertical slice's 7 characters) — this task has nothing to build for them and does not claim to.

- [ ] **Step 1: `public/host/botc/day.js`**

```js
// day.js
// The day panel: nominate, watch the sequential vote tally, resolve the
// nomination, execute whoever is on the block, and see the automatic
// game:botc-ended banner once a win condition fires.
import { store, onStateChange } from "./store.js";

function renderNominationSelects() {
  const state = store.latestState;
  const nominatorSelect = document.getElementById("botc-nominator-select");
  const nomineeSelect = document.getElementById("botc-nominee-select");
  if (!state) return;

  // Show each seat's 1-based position in state.seats, not its raw seatId --
  // grimoire.js's renderSeatRow does the same, and for the same reason
  // (seatId is a stable identifier that reordering does not renumber; the
  // displayed number needs to run 1..N in seating order for "nominate the
  // seat to my left" to mean anything to the Storyteller). The option's
  // value is still the real seatId, which is what host:botc-nominate reads.
  const optionsHtml = state.seats
    .map((s, index) => `<option value="${s.seatId}">${index + 1}. ${s.nickname}${s.alive ? "" : " (dead)"}</option>`)
    .join("");
  nominatorSelect.innerHTML = optionsHtml;
  nomineeSelect.innerHTML = optionsHtml;
}

function renderVoteTally() {
  const state = store.latestState;
  const tally = document.getElementById("botc-vote-tally");
  tally.innerHTML = "";
  const nomination = state && state.day && state.day.currentNomination;
  if (!nomination) return;

  const nomineeSeat = state.seats.find((s) => s.seatId === nomination.nomineeSeatId);
  const nominatorSeat = state.seats.find((s) => s.seatId === nomination.nominatorSeatId);
  const header = document.createElement("div");
  header.textContent = `${nominatorSeat ? nominatorSeat.nickname : "?"} nominated ${nomineeSeat ? nomineeSeat.nickname : "?"} — ${nomination.votes.length} vote(s) so far.`;
  tally.appendChild(header);

  nomination.order.forEach((seatId, index) => {
    const seat = state.seats.find((s) => s.seatId === seatId);
    const vote = nomination.votes.find((v) => v.seatId === seatId);
    const row = document.createElement("div");
    row.className = "botc-vote-row" + (index === nomination.currentVoterIndex ? " current-voter" : "");
    const status = vote ? (vote.voted ? "voted yes" : "passed") : index < nomination.currentVoterIndex ? "passed" : "waiting…";
    row.innerHTML = `<span>${seat ? seat.nickname : seatId}</span><span>${status}</span>`;
    tally.appendChild(row);

    if (index === nomination.currentVoterIndex && !vote) {
      const yesBtn = document.createElement("button");
      yesBtn.type = "button";
      yesBtn.className = "btn-secondary";
      yesBtn.textContent = "Cast: Yes";
      yesBtn.addEventListener("click", () => {
        store.socket.emit("host:botc-vote", { code: store.roomCode, seatId, voted: true });
      });
      const noBtn = document.createElement("button");
      noBtn.type = "button";
      noBtn.className = "btn-secondary";
      noBtn.textContent = "Cast: No";
      noBtn.addEventListener("click", () => {
        store.socket.emit("host:botc-vote", { code: store.roomCode, seatId, voted: false });
      });
      row.appendChild(yesBtn);
      row.appendChild(noBtn);
    }
  });

  if (nomination.currentVoterIndex >= nomination.order.length) {
    const resolveBtn = document.createElement("button");
    resolveBtn.type = "button";
    resolveBtn.className = "btn-primary";
    resolveBtn.textContent = "Resolve Nomination";
    resolveBtn.addEventListener("click", () => {
      store.socket.emit("host:botc-resolve-vote", { code: store.roomCode });
    });
    tally.appendChild(resolveBtn);
  }
}

function renderOnBlockAndExecute() {
  const state = store.latestState;
  const onBlockEl = document.getElementById("botc-onblock");
  const executeBtn = document.getElementById("btn-botc-execute");
  const onBlock = state && state.day && state.day.onBlock;
  if (!onBlock) {
    onBlockEl.textContent = "Nobody is currently on the block.";
    executeBtn.hidden = true;
    return;
  }
  const seat = state.seats.find((s) => s.seatId === onBlock.seatId);
  onBlockEl.textContent = `${seat ? seat.nickname : onBlock.seatId} is on the block with ${onBlock.votes} votes.`;
  executeBtn.hidden = false;
  executeBtn.onclick = () => {
    store.socket.emit("host:botc-execute", { code: store.roomCode, seatId: onBlock.seatId });
  };
}

function renderDayPanel() {
  const state = store.latestState;
  const panel = document.getElementById("botc-day-panel");
  // The implemented backend only ever sets phase to "setup", "night",
  // "day-discussion", or "ended" (confirmed by reading state.js/nightLoop.js/
  // voting.js/index.js in full) -- nomination/voting/dusk from the spec's
  // phase enum were never split into distinct phase values; that finer
  // detail lives in state.day.currentNomination/onBlock instead, which
  // renderVoteTally/renderOnBlockAndExecute already read directly.
  const isDay = state && state.phase === "day-discussion";
  panel.hidden = !isDay;
  if (!isDay) return;

  renderNominationSelects();
  renderVoteTally();
  renderOnBlockAndExecute();
}

function renderEndedBanner() {
  const state = store.latestState;
  const banner = document.getElementById("botc-ended-banner");
  if (!state || !state.ended) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;
  const winnerLabel = state.ended.winner === "good" ? "🛡️ Good wins!" : "🗡️ Evil wins!";
  banner.textContent = `${winnerLabel} (${state.ended.reason})`;
}

export function initDayPanel() {
  onStateChange(() => {
    renderDayPanel();
    renderEndedBanner();
  });

  document.getElementById("btn-botc-nominate").addEventListener("click", () => {
    const nominatorSeatId = Number(document.getElementById("botc-nominator-select").value);
    const nomineeSeatId = Number(document.getElementById("botc-nominee-select").value);
    store.socket.emit("host:botc-nominate", { code: store.roomCode, nominatorSeatId, nomineeSeatId });
  });
}
```

- [ ] **Step 2: Wire it into `main.js`**

Add the import and call:

```js
import { initDayPanel } from "./day.js";
```

```js
initDayPanel();
```

- [ ] **Step 3: Verify**

Run: `node --check public/host/botc/day.js` (expect no output) and re-run `node --test "test/*.test.js" && node test/e2e-botc.js` (expect unchanged).

- [ ] **Step 4: Manual verification**

1. Continue the game from Task 6's manual test into day 1.
2. Nominate one seat from another, confirm the tally shows every seat in the correct sequential voting order (starting to the nominee's left) with Yes/No buttons only on the current voter's row.
3. Cast votes down the order, confirm passed/voted labels accumulate correctly and a "Resolve Nomination" button appears once every seat has had a turn.
4. Resolve, confirm the on-block text updates, click Execute, confirm the seat's grimoire row (Task 5) flips to dead.
5. Click "Begin Night 2" (from Task 6's panel) and drive the Imp's kill choice; if it ends the game (Soldier immune, or another seat killed dropping evil to majority, or Imp executed), confirm the ended banner renders with the correct winner/reason.

- [ ] **Step 5: Commit**

```bash
git add public/host/botc/day.js public/host/botc/main.js
git commit -m "feat(botc): day panel -- nomination, sequential vote tally, execute, win banner"
```

---

## Known limitations of this plan

- **No player-side UI.** Every night choice and vote in this plan is entered by the Storyteller via manual override (Task 6/7), since the player-driven `player:botc-night-choice`/`player:botc-vote` events (already built and merged) have no phone-side screen to call them from yet. That is the next, separate plan's entire scope.
- **Seat reordering during setup is up/down buttons, not drag-and-drop.** Spec §6 says "dragging rows"; this plan substitutes up/down arrow buttons per row, which achieve the identical reordering capability more robustly on a touch phone with no new dependency (a hand-rolled touch-drag implementation is exactly the kind of fragile, dependency-shaped problem this codebase's "no bundler, no new dependency" constraint exists to avoid). Ruling made by this plan's author; revisit if a future circular/wide-screen grimoire layout (explicitly out of scope for version one per spec §10) makes drag-reordering worth revisiting.
- **The Virgin-nomination and Mayor win-condition prompts (spec §7) are not built** because the backend doesn't implement those characters yet (T4 character-library work, spec §9) — nothing in this vertical slice's 7 characters triggers them.
- **No timer for a slow/dropped voter** (spec §7's "Storyteller-configurable timer, default 15 seconds") — the Storyteller can already vote on any seat's behalf via the tally's Yes/No buttons at any time (this plan's "verbal mode" equivalent), which covers the same practical need without a clock; a real timer is a nice-to-have for a later plan.
- **`infoLog` sidebar (spec §7's T7 scope) is not built** — the backend's `state.infoLog` field exists in `state.js` but nothing in this plan's vertical slice ever populates or reads it (`applyChoice`/`computeCandidates` in the 7 implemented characters don't write to it either — confirmed by reading each character file during this plan's authoring). Out of scope for this plan; a future plan adding `infoLog` needs a small backend addition first.
- **No automated browser test.** Every task's DOM/socket-wiring code is verified manually (matching this codebase's existing, established convention: zero automated tests exist for `host.js`'s or `player.js`'s own DOM glue today). Every *backend* event this UI calls is separately proven correct by `test/e2e-botc.js`'s `socket.io-client` scenarios (Tasks 1-2), which do not depend on any browser.
- **No read receipts, and no "told verbally" marking.** Spec §5's rhythm ("it is pushed to that player's phone → player taps Acknowledged → Storyteller sees the receipt") and its verbal-mode fallback ("a player whose phone is dead or disconnected can be marked 'told verbally' so the flow continues") are not implemented anywhere — not in the already-merged backend, and not by this plan. Today the night panel simply shows whichever step is currently active without any acknowledgment signal, and there is no way to mark a step as manually delivered without going through the normal candidate/choice flow. This needs a small new backend event (e.g. a player-side `player:botc-acknowledge` and a Storyteller-side `host:botc-mark-told-verbally`) plus UI on both sides — real, scoped work for a future plan, most naturally the same one that adds the player-side UI, since a read receipt is meaningless without a player screen to send one from.

# Blood on the Clocktower — Player UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the player-facing phone screens for Blood on the Clocktower — role reveal, night-choice self-service, vote self-service, information toasts, and game-over — so a player can act on their own turn from their own phone instead of the Storyteller entering everything on their behalf, completing the vertical slice the host UI plan left as its explicit "no player-side UI yet" limitation.

**Architecture:** Every backend event this plan needs already exists and is already proven correct by `test/e2e-botc.js` (`game:botc-role`, `game:botc-your-turn`, `game:botc-your-turn-to-vote`, `game:botc-info`, `game:botc-ended`, `player:botc-night-choice`, `player:botc-vote`) — this plan is pure front-end, zero backend changes. It follows the exact same native-ES-module pattern the host UI plan established (`public/player/botc/`, no bundler), and the exact same "one minimal hook, no botc logic in the existing flat file" integration approach — except simpler here, because `public/player/player.js`'s screen routing is already purely event-driven (`socket.on("game:...", () => showScreen(...))`, never gated by a selected-game-id branch), so this plan needs only a single one-line hook, not the two-line hook host.js needed.

**Tech Stack:** Native browser ES modules (`<script type="module">`), no bundler, no new dependency — identical conventions to the host UI plan.

**Spec:** `docs/superpowers/specs/2026-08-27-blood-on-the-clocktower-design.md` — §1 (character hint text: "written fresh and kept short"), §5 (night flow rhythm, character module contract), §7 (day: sequential voting, "the app lights up one phone at a time")

## Ruling: reuse the `.screen`/`.active` convention exclusively — never the `hidden` attribute

The host UI plan's final review found two Critical bugs from one root cause: `hidden` HTML attribute toggling was silently defeated because sibling CSS classes (`.botc-cover-screen`, `.btn-primary`) declared their own `display` value, and an author-origin `display` rule always beats the User-Agent-origin `[hidden]{display:none}` rule regardless of specificity — a bug class invisible to every verification method available in this project's environment (no browser access), since it rests on CSS cascade behavior no Node script can execute.

This plan sidesteps that entire bug class by design rather than by discipline: **every new player screen is a full-screen `.screen`/`.active` swap**, exactly matching every existing screen in `public/player/player.js` (`join`, `waiting`, `avalonRoleReveal`, `playing`, etc.) — never a `hidden`-attribute toggle on a sub-element within a shared screen. The one exception is the info notification (Task 4), which reuses the already-existing `.toast`/`.toast.show` class-toggle convention `slipup-caught-toast` already uses successfully in this same file — also class-based, never `hidden`-attribute-based. A player only ever needs one thing on screen at a time (unlike the host's grimoire, which stacks multiple simultaneously-relevant panels), so this is also the more natural design here, not just the safer one.

## Global Constraints

- Working directory for every command: `party-platform-full/party-game-platform/server/`.
- No new runtime dependencies, no bundler.
- Front-end UI files use native `<script type="module">` — no build step.
- New player UI files live under `public/player/botc/`; the only existing front-end file touched is `public/player/player.js` (one line: `window.__playerSocket = socket;`, exposing the already-authenticated connection so the botc module reuses it instead of opening a fragile second one — matching the host UI plan's already-established, already-justified reasoning). `public/player/index.html` gets new markup + link/script tags (markup, not the flat-script logic the "existing files untouched" reasoning was about). **`player.js` needs no second hook** (no entry-point branch): its screen routing is already 100% event-driven, gated by nothing but which `game:*` event fires — the botc module just adds its own listeners for `game:botc-*` events on the shared socket, exactly as any of the four existing games' listeners already coexist there.
- No backend file is touched by this plan at all — confirmed every event this plan needs (`game:botc-role`, `game:botc-your-turn`, `game:botc-your-turn-to-vote`, `game:botc-info`, `game:botc-ended`, `player:botc-night-choice`, `player:botc-vote`) already exists in the merged `games/botc/index.js`, proven by `test/e2e-botc.js`'s existing 4 scenarios.
- Every new screen is a `.screen`/`.active` full swap (see the ruling above) or the existing `.toast`/`.toast.show` convention — never the `hidden` attribute on any element that shares a CSS class with something declaring its own `display` value.
- This repo has `core.autocrlf=true`: the real working-tree copy of every file this plan modifies is CRLF; `git show`/`git diff` normalize the stored blob to LF, which is expected and not a defect (verified repeatedly across this project's history). New files should use LF, matching how editors in this repo typically save new `.js`/`.css`/`.html` files.
- Character hint text is short, spec-mandated flavor (spec §1: "written fresh and kept short") — the exact 7 strings below are final, not placeholders.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `public/player/player.js` (modify) | One line: expose `window.__playerSocket`. |
| `public/player/index.html` (modify) | New `<section>` markup for the botc role/night/vote/ended screens and the info toast; `<link>` + `<script type="module">` tags. |
| `public/player/botc/botc.css` (create) | Botc-specific player styles, reusing `/player/style.css`'s existing CSS custom properties (same document, no re-declaration needed). |
| `public/player/botc/store.js` (create) | Tiny shared state (`socket`, `roomCode`) — smaller than the host UI's store since a player has no roster/distribution table to track. |
| `public/player/botc/main.js` (create, then extended) | Entry point: captures `roomCode` from the already-existing `player:joined`/`player:rejoined` events, defines the shared `showBotcScreen`, wires `game:botc-role`. |
| `public/player/botc/roleAndInfo.js` (create) | Role-reveal screen (with character hint text), the info toast, and the game-over screen. |
| `public/player/botc/nightChoice.js` (create) | Night-choice prompt: renders a target picker, submits `player:botc-night-choice`. |
| `public/player/botc/vote.js` (create) | Vote prompt: renders Yes/No for the current nomination, submits `player:botc-vote`. |

---

### Task 1: Front-end scaffolding — hook, markup, styles, shared store

**Files:**
- Modify: `public/player/player.js`
- Modify: `public/player/index.html`
- Create: `public/player/botc/botc.css`
- Create: `public/player/botc/store.js`
- Create: `public/player/botc/main.js`
- Test: manual verification via Step 6 below (no automated test — matching this codebase's existing convention of zero automated tests for `player.js`'s own DOM glue; `test/e2e-botc.js`'s existing 4 scenarios already prove every backend event this UI calls)

**Interfaces:**
- Consumes: `window.__playerSocket` (this task creates the exposure); `player:joined`, `player:rejoined` (existing platform events, already firing with a `{room: {code, ...}}` payload); `game:botc-role` (existing botc event, `{characterId, alignment}` — `characterId` here is the player's own *believed* character id, since the server always sends `seat.believedCharacterId` under that field name).
- Produces: a `store` object and a `setState` function other botc player files import from `./store.js`; a `showBotcScreen(name)` helper used internally by `main.js` and exported for the other botc player files to import.

- [ ] **Step 1: The one `player.js` hook**

In `public/player/player.js`, change:

```js
const socket = io();
```

to:

```js
const socket = io();
window.__playerSocket = socket;
```

That is the only change to `player.js`. No entry-point branch is needed here (unlike the host UI plan's `host.js` hook) — `player.js`'s screen routing never branches on a selected game id; it only reacts to whichever `game:*` event fires. The botc module below adds its own listeners for `game:botc-*` events on this same socket, coexisting with every other game's listeners exactly as Avalon's/Word Wolf's/Slip-Up's already do.

- [ ] **Step 2: `public/player/botc/store.js`**

```js
// store.js
// Tiny shared state for the botc player UI. Every other file under
// public/player/botc/ imports `store` to read the latest data (just the
// socket and the room code -- much smaller than the host UI's store.js,
// since a player never sees a roster or a distribution table). No pub/sub
// here unlike the host UI's store.js: every player screen reacts directly
// to its own targeted socket event (game:botc-role, game:botc-your-turn,
// etc.), not to a shared "latest state" object, so there is nothing for a
// second file to subscribe to.
export const store = {
  socket: window.__playerSocket,
  roomCode: null,
};

export function setState(patch) {
  Object.assign(store, patch);
}
```

- [ ] **Step 3: `public/player/botc/botc.css`**

```css
/* botc.css
   Reuses the CSS custom properties already declared by /player/style.css's
   :root (both stylesheets apply to the same document, so --bg/--panel/
   --accent/etc. are already in scope here). Every screen this feature adds
   uses the existing .screen/.active convention (see this plan's own
   "Ruling" section for why) -- this file has no hidden-attribute-based
   visibility rules to get wrong. */

.botc-role-card {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 24px;
  text-align: center;
  margin-bottom: 16px;
}

.botc-role-name {
  font-size: 1.6rem;
  font-weight: 700;
  margin-bottom: 4px;
}

.botc-role-alignment {
  font-size: 1rem;
  margin-bottom: 12px;
}

.botc-role-alignment.evil {
  color: var(--accent);
}

.botc-role-hint {
  color: var(--text-dim);
  font-size: 0.95rem;
}

.botc-target-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 16px 0;
}

.botc-nominee-banner {
  background: var(--panel);
  border-radius: var(--radius);
  padding: 16px;
  text-align: center;
  font-weight: 600;
  margin-bottom: 16px;
}

.botc-vote-buttons {
  display: flex;
  gap: 12px;
}

.botc-vote-buttons .vote-btn {
  flex: 1;
}

.botc-ended-text {
  font-size: 1.3rem;
  font-weight: 700;
  text-align: center;
  margin-bottom: 8px;
}
```

- [ ] **Step 4: `public/player/botc/main.js`**

```js
// main.js
// Entry point for the Blood on the Clocktower player UI. This file, and
// every other file under public/player/botc/, is loaded as a native ES
// module -- no bundler. It never imports from or modifies player.js; the
// only integration point is the one line added to player.js in this task's
// Step 1 (window.__playerSocket).
import { store, setState } from "./store.js";

const screens = {
  role: document.getElementById("screen-botc-role"),
  nightChoice: document.getElementById("screen-botc-night-choice"),
  vote: document.getElementById("screen-botc-vote"),
  ended: document.getElementById("screen-botc-ended"),
};

export function showBotcScreen(name) {
  document.querySelectorAll(".screen.active").forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

// player:joined/player:rejoined already fire on this same connection --
// player.js has its own listeners for these same two events (rendering the
// waiting-room player list); this is a second, independent listener for the
// one additional thing this plan needs from them (the room code), which
// player.js's own private roomCode variable cannot expose to a separate
// module.
store.socket.on("player:joined", ({ room }) => setState({ roomCode: room.code }));
store.socket.on("player:rejoined", ({ room }) => setState({ roomCode: room.code }));
```

- [ ] **Step 5: `public/player/index.html` additions**

In the `<head>`, after the existing `<link rel="stylesheet" href="/player/style.css" />`, add:

```html
<link rel="stylesheet" href="/player/botc/botc.css" />
```

Inside `#app`, immediately before the closing `</div>` that ends `#app` (i.e., as the last children, after `screen-results`), add:

```html
    <section id="screen-botc-role" class="screen">
      <h1>🕯️ Your Role</h1>
      <div class="botc-role-card">
        <div id="botc-role-name" class="botc-role-name"></div>
        <div id="botc-role-alignment" class="botc-role-alignment"></div>
        <div id="botc-role-hint" class="botc-role-hint"></div>
      </div>
      <p class="hint">The Storyteller will call on you when it's your turn.</p>
    </section>

    <section id="screen-botc-night-choice" class="screen">
      <h1 id="botc-night-choice-title">Your Turn</h1>
      <p id="botc-night-choice-status" class="subtitle"></p>
      <div id="botc-night-choice-targets" class="botc-target-grid"></div>
    </section>

    <section id="screen-botc-vote" class="screen">
      <h1>Time to Vote</h1>
      <div id="botc-vote-nominee" class="botc-nominee-banner"></div>
      <div class="botc-vote-buttons">
        <button type="button" id="btn-botc-vote-yes" class="vote-btn">✅ Yes</button>
        <button type="button" id="btn-botc-vote-no" class="vote-btn">❌ No</button>
      </div>
      <p id="botc-vote-status" class="hint"></p>
    </section>

    <section id="screen-botc-ended" class="screen">
      <h1>Game Over</h1>
      <p id="botc-ended-text" class="botc-ended-text"></p>
      <p class="hint">Waiting for the host to return to the lobby…</p>
    </section>
```

Also add the info toast, alongside the existing `#slipup-caught-toast` toast (as a sibling `<p>`, anywhere inside `#app` — it is positioned by its own `.toast` class regardless of DOM position, matching how `slipup-caught-toast` is placed inside `#screen-slipup-play` but styled identically):

```html
    <p id="botc-info-toast" class="toast"></p>
```

Immediately before the closing `</body>`, after the existing `<script src="/player/player.js"></script>` line, add:

```html
  <script type="module" src="/player/botc/main.js"></script>
```

(Order matters, matching the host UI plan's reasoning: the module script must load after `player.js` so `window.__playerSocket` already exists when `store.js`'s top-level `socket: window.__playerSocket` runs.)

- [ ] **Step 6: Manual verification**

This task has no automated test. Verify manually:
1. Run `node index.js` from `party-platform-full/party-game-platform/server`.
2. Open the player page in a browser (or, if no browser is available, do a real-module/real-socket integration check against the live backend, joining a room as a player and confirming `store.roomCode` gets set after `player:join-room`).
3. Confirm no console errors on load, and that none of the other four games' player flows (Find the Imposter, Word Wolf, Slip-Up, Avalon) are affected — spot-check one existing game's player flow still works end to end.

- [ ] **Step 7: Commit**

```bash
git add public/player/player.js public/player/index.html public/player/botc/botc.css public/player/botc/store.js public/player/botc/main.js
git commit -m "feat(botc): player UI scaffolding -- hook, markup, styles, shared store"
```

---

### Task 2: Role reveal, info toast, and game-over screen

**Files:**
- Create: `public/player/botc/roleAndInfo.js`
- Modify: `public/player/botc/main.js` (import and initialize)
- Test: manual verification via Step 4 below

**Interfaces:**
- Consumes: `store` (Task 1); `showBotcScreen` (Task 1); `game:botc-role` (`{characterId, alignment}`, existing), `game:botc-info` (`{text}`, existing), `game:botc-ended` (`{winner, reason}`, existing).
- Produces: `initRoleAndInfo()`, called once from `main.js`.

- [ ] **Step 1: `public/player/botc/roleAndInfo.js`**

```js
// roleAndInfo.js
// Three purely-passive display surfaces: the role-reveal screen (shown
// once at deal time and again on any reconnect, since game:botc-role is
// re-sent by onPlayerRejoined), the info toast (a Storyteller-sent reveal,
// e.g. the Washerwoman's "one of X/Y is a Townsfolk"), and the game-over
// screen. None of these submit anything back to the server.
import { store } from "./store.js";
import { showBotcScreen } from "./main.js";

// The vertical slice's 7 implemented characters. Hint text is short,
// original flavor per spec §1 ("written fresh and kept short") -- not
// official Almanac prose.
const CHARACTERS = {
  washerwoman: {
    label: "Washerwoman",
    hint: "You start knowing that 1 of 2 players is a particular Townsfolk.",
  },
  empath: {
    label: "Empath",
    hint: "Each night, you learn how many of your 2 alive neighbours are evil.",
  },
  soldier: {
    label: "Soldier",
    hint: "You are safe from the Demon's kill.",
  },
  butler: {
    label: "Butler",
    hint: "Each night, choose a player (not yourself). Tomorrow, you may only vote if they are voting too.",
  },
  poisoner: {
    label: "Poisoner",
    hint: "Each night, choose a player. They are poisoned until dusk tomorrow.",
  },
  baron: {
    label: "Baron",
    hint: "There are extra Outsiders in play, and fewer Townsfolk.",
  },
  imp: {
    label: "Imp",
    hint: "Each night, choose a player to kill. If you kill yourself, a Minion becomes the Imp.",
  },
};

function renderRole({ characterId, alignment }) {
  const info = CHARACTERS[characterId] || { label: characterId, hint: "" };
  document.getElementById("botc-role-name").textContent = info.label;
  const alignmentEl = document.getElementById("botc-role-alignment");
  alignmentEl.textContent = alignment === "evil" ? "🗡️ Evil" : "🛡️ Good";
  alignmentEl.className = "botc-role-alignment" + (alignment === "evil" ? " evil" : "");
  document.getElementById("botc-role-hint").textContent = info.hint;
  showBotcScreen("role");
}

function showInfoToast(text) {
  const toast = document.getElementById("botc-info-toast");
  toast.textContent = text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 6000);
}

function renderEnded({ winner, reason }) {
  const winnerLabel = winner === "good" ? "🛡️ Good wins!" : "🗡️ Evil wins!";
  document.getElementById("botc-ended-text").textContent = `${winnerLabel} (${reason})`;
  showBotcScreen("ended");
}

export function initRoleAndInfo() {
  store.socket.on("game:botc-role", renderRole);
  store.socket.on("game:botc-info", ({ text }) => showInfoToast(text));
  store.socket.on("game:botc-ended", renderEnded);
}
```

- [ ] **Step 2: Wire it into `main.js`**

In `public/player/botc/main.js`, add the import at the top:

```js
import { initRoleAndInfo } from "./roleAndInfo.js";
```

and call it once, at the end of the file:

```js
initRoleAndInfo();
```

- [ ] **Step 3: Verify**

Run: `node --input-type=module --check < public/player/botc/roleAndInfo.js` (expect no output — `node --check` alone misidentifies ES module files as CommonJS since `package.json` declares `"type": "commonjs"` repo-wide; this is expected, not a defect). Re-run `node --test "test/*.test.js" && node test/e2e-botc.js` (expect completely unchanged — this task touches no backend file).

- [ ] **Step 4: Manual verification**

If a browser is available: deal a botc game, confirm the role screen shows the correct character name, alignment (with evil styling), and hint text; have the host send a Washerwoman/Empath reveal via `host:botc-night-candidate` and confirm the toast appears then disappears after ~6 seconds without leaving the role screen; drive the game to completion and confirm the game-over screen shows the correct winner/reason.

If no browser is available, substitute a real-module/real-socket integration test against the live backend (same technique used throughout the host UI plan): deal a game, confirm `game:botc-role` correctly populates the role screen's three text fields and switches the active screen; emit a synthetic `game:botc-info` and confirm the toast's `classList` gains then (after a shortened test-only timeout, or by directly inspecting the code path rather than waiting the full 6 seconds) loses `"show"`; emit a synthetic `game:botc-ended` and confirm the ended screen's text and active state.

- [ ] **Step 5: Commit**

```bash
git add public/player/botc/roleAndInfo.js public/player/botc/main.js
git commit -m "feat(botc): role reveal, info toast, game-over screen"
```

---

### Task 3: Night-choice prompt

**Files:**
- Create: `public/player/botc/nightChoice.js`
- Modify: `public/player/botc/main.js` (import and initialize)
- Test: manual verification via Step 4 below

**Interfaces:**
- Consumes: `store` (Task 1); `showBotcScreen` (Task 1); `game:botc-your-turn` (`{choiceType, targets: [{seatId, nickname, alive}]}`, existing); `player:botc-night-choice` (`{code, choice: {targetSeatId}}`, existing).
- Produces: `initNightChoice()`, called once from `main.js`.

`choiceType` is one of two values (the already-merged backend's three choice-based characters in this vertical slice): `"select-one-player"` (Poisoner, Imp) or `"select-one-player-excluding-self"` (Butler). In principle the Butler's own seat should be excluded from the grid — but `maybePromptNightChoice` (in `games/botc/index.js`, confirmed by reading it directly) builds `targets` from every seat in `room.gameState.seats`, with no field identifying which entry is "self," and the payload carries no player token either. There is no reliable way for this module to know which button is the acting player's own seat without a small backend addition (e.g. `maybePromptNightChoice` including the step's own `seatId` alongside `targets`), which is out of scope for a front-end-only plan.

Given that, this task deliberately renders every seat as a target for both `choiceType` values, and documents the gap rather than inventing an unreliable workaround (see Known Limitations). The practical impact is small: the character's own `applyChoice` doesn't reject a self-target server-side either, so this UI gap doesn't create a new rules violation the server would have otherwise prevented — it just means the UI doesn't proactively steer the Butler away from an already-legal-at-the-server-level self-target.

- [ ] **Step 1: `public/player/botc/nightChoice.js`**

```js
// nightChoice.js
// The player-driven night-choice prompt: fires on game:botc-your-turn,
// renders every seat as a target button, and submits player:botc-night-
// choice on tap. Disables all buttons immediately after tapping one, since
// there is no visible confirmation step -- tapping IS the submission.
//
// Known gap (see this task's own header comment in the plan and the
// Known Limitations section): the "excluding-self" choiceType (Butler)
// does not actually exclude the acting player's own seat from the grid,
// because game:botc-your-turn's targets array includes every seat with no
// signal identifying which one is "self". This is a minor UX gap, not a
// rules violation the server would ever enforce differently either way --
// the Butler's own applyChoice doesn't reject a self-target server-side.
import { store } from "./store.js";
import { showBotcScreen } from "./main.js";

function renderNightChoice({ choiceType, targets }) {
  document.getElementById("botc-night-choice-status").textContent =
    choiceType === "select-one-player-excluding-self"
      ? "Choose a player (not yourself)."
      : "Choose a player.";

  const container = document.getElementById("botc-night-choice-targets");
  container.innerHTML = "";
  targets.forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "vote-btn";
    btn.textContent = t.nickname + (t.alive ? "" : " (dead)");
    btn.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((b) => (b.disabled = true));
      document.getElementById("botc-night-choice-status").textContent = "Choice submitted — waiting…";
      store.socket.emit("player:botc-night-choice", {
        code: store.roomCode,
        choice: { targetSeatId: t.seatId },
      });
    });
    container.appendChild(btn);
  });

  showBotcScreen("nightChoice");
}

export function initNightChoice() {
  store.socket.on("game:botc-your-turn", renderNightChoice);
}
```

- [ ] **Step 2: Wire it into `main.js`**

Add the import and call:

```js
import { initNightChoice } from "./nightChoice.js";
```

```js
initNightChoice();
```

- [ ] **Step 3: Verify**

Run: `node --input-type=module --check < public/player/botc/nightChoice.js` (expect no output). Re-run `node --test "test/*.test.js" && node test/e2e-botc.js` (expect unchanged).

- [ ] **Step 4: Manual verification**

If a browser is available: deal a game with a Poisoner in play, drive the night to the Poisoner's step, confirm the player's phone screen switches to the night-choice prompt showing every seat as a button, tap one, confirm the buttons disable and the status text changes, and confirm (via the host's grimoire screen from the host UI plan, or via `test/e2e-botc.js`'s established assertions) that the poison reminder was actually applied.

If no browser is available, substitute a real-module/real-socket integration test: deal a game with a Poisoner, drive the night up to the Poisoner's turn, emit `game:botc-your-turn` to the Poisoner's own connection and confirm the rendered target buttons match the payload's `targets` array, click a button (invoke its handler directly against the DOM), confirm `player:botc-night-choice` was emitted with the correct `targetSeatId`, and confirm (via the host's `host:botc-state`) that the poison reminder landed on the correct seat.

- [ ] **Step 5: Commit**

```bash
git add public/player/botc/nightChoice.js public/player/botc/main.js
git commit -m "feat(botc): night-choice prompt"
```

---

### Task 4: Vote prompt

**Files:**
- Create: `public/player/botc/vote.js`
- Modify: `public/player/botc/main.js` (import and initialize)
- Test: manual verification via Step 4 below

**Interfaces:**
- Consumes: `store` (Task 1); `showBotcScreen` (Task 1); `game:botc-your-turn-to-vote` (`{nomineeSeatId, nomineeNickname}`, existing); `player:botc-vote` (`{code, voted}`, existing).
- Produces: `initVotePrompt()`, called once from `main.js`.

- [ ] **Step 1: `public/player/botc/vote.js`**

```js
// vote.js
// The player-driven vote prompt: fires on game:botc-your-turn-to-vote,
// shows who's nominated, and submits player:botc-vote on Yes/No. Disables
// both buttons immediately after voting, since there is no visible
// confirmation step -- tapping IS the vote.
import { store } from "./store.js";
import { showBotcScreen } from "./main.js";

function renderVotePrompt({ nomineeSeatId, nomineeNickname }) {
  document.getElementById("botc-vote-nominee").textContent =
    `${nomineeNickname || "Someone"} has been nominated. How do you vote?`;
  document.getElementById("botc-vote-status").textContent = "";

  const yesBtn = document.getElementById("btn-botc-vote-yes");
  const noBtn = document.getElementById("btn-botc-vote-no");
  yesBtn.disabled = false;
  noBtn.disabled = false;

  function submit(voted) {
    yesBtn.disabled = true;
    noBtn.disabled = true;
    document.getElementById("botc-vote-status").textContent = "Vote submitted — waiting…";
    store.socket.emit("player:botc-vote", { code: store.roomCode, voted });
  }

  // Re-assigning onclick each time this renders (rather than
  // addEventListener) is deliberate and safe: this function only ever runs
  // in response to a fresh game:botc-your-turn-to-vote for THIS voter, so
  // there is exactly one live prompt to bind at a time, and the previous
  // handler (if any) is fully replaced rather than accumulating.
  yesBtn.onclick = () => submit(true);
  noBtn.onclick = () => submit(false);

  showBotcScreen("vote");
}

export function initVotePrompt() {
  store.socket.on("game:botc-your-turn-to-vote", renderVotePrompt);
}
```

- [ ] **Step 2: Wire it into `main.js`**

Add the import and call:

```js
import { initVotePrompt } from "./vote.js";
```

```js
initVotePrompt();
```

- [ ] **Step 3: Verify**

Run: `node --input-type=module --check < public/player/botc/vote.js` (expect no output). Re-run `node --test "test/*.test.js" && node test/e2e-botc.js` (expect unchanged).

- [ ] **Step 4: Manual verification**

If a browser is available: drive a game to day 1, nominate a seat, confirm the first voter's phone switches to the vote prompt showing the correct nominee, tap Yes or No, confirm both buttons disable and the status text updates, and confirm (via the host's day panel from the host UI plan) the vote was recorded and the next voter's phone lights up in turn.

If no browser is available, substitute a real-module/real-socket integration test: nominate a seat, emit `game:botc-your-turn-to-vote` to the current voter's own connection, confirm the rendered nominee text and enabled buttons, invoke the Yes handler, confirm `player:botc-vote` was emitted with `voted: true`, and confirm (via the host's state) the vote landed and the next voter's own `game:botc-your-turn-to-vote` fired.

- [ ] **Step 5: Commit**

```bash
git add public/player/botc/vote.js public/player/botc/main.js
git commit -m "feat(botc): vote prompt"
```

---

## Known limitations of this plan

- **Butler's "excluding self" is not enforced in the UI.** As explained in Task 3, `game:botc-your-turn`'s `targets` payload includes every seat with no signal identifying which one belongs to the receiving player, so the night-choice grid shows every seat regardless of `choiceType`. This is not a rules violation the server enforces either way (the Butler character module's own `applyChoice` doesn't reject a self-target server-side), so the practical impact is a Butler could target themselves through this UI when they're not supposed to — a real but minor gap. A future small plan could close it by having `maybePromptNightChoice` (in `games/botc/index.js`) include the acting seat's own `seatId` in the payload (e.g. `{choiceType, targets, ownSeatId}`), letting this task's grid filter it out properly.
- **No read receipts.** Matches the host UI plan's own already-documented limitation (spec §5's "player taps Acknowledged" is not implemented anywhere in the backend) — this plan's screens show a prompt and let the player act on it, but there is no separate "I saw this" acknowledgment step distinct from the action itself.
- **No automated browser test.** Every task's DOM/socket-wiring code is verified manually (matching this codebase's existing, established convention, and the same approach used throughout the host UI plan). Every *backend* event this UI calls is already proven correct by `test/e2e-botc.js`'s existing 4 scenarios, none of which needed changing for this plan.
- **The info toast has a fixed 6-second display time** with no manual dismiss — long enough to read a Washerwoman/Empath-length reveal, but not configurable. A future polish pass could add a tap-to-dismiss.
- **Cross-reference (not a new gap): the ghost-vote-stall backend limitation**, already documented in the prior `2026-08-27-botc-player-driven-turns.md` plan and cross-referenced again in `2026-08-28-botc-host-ui.md`. If a vote-turn prompt is ever sent to a dead, ghost-vote-spent seat (the backend bug those plans describe), this plan's vote screen would render normally and the player could tap Yes/No, but the vote would be silently rejected server-side with no visible error — the same silent-rejection behavior the host's own `host:botc-vote` fallback already has for this exact case. Not addressed here; the actual fix belongs in a `voting.js` follow-up, out of scope for every plan so far in this series.

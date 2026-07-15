# Punishment Wheel — Room-Level Feature

## Context

A "punishment wheel" for the loser of whatever game is currently being played — the host spins to randomly pick one punishment from a shared list. This is deliberately decoupled from every game's own logic: no game module decides who "the loser" is or triggers anything automatically. The host just spins whenever they want (typically after a round ends) and reads the result out loud themselves.

Unlike the three existing games (Find the Imposter, Word Wolf, Slip-Up), this is **not** registered in `games/registry.js`. The registry models one mutually-exclusive active game per room (`room.gameId`/`room.gameState` is a single slot, and all game socket events are gated by `withHostGame`, which requires a game to be selected). The wheel must work regardless of which game is active, or with none selected at all, so it's built as a genuine room-level subsystem instead — a new top-level field on the room object with its own socket events registered directly in `index.js`, alongside the existing room-level events (`host:create-room`, `player:join-room`, `host:reset-room`, etc.), not gated by `withHostGame`.

## 1. Data model

New pure-logic module `wheelLogic.js` (mirrors `slipUpLogic.js`'s pattern — no socket.io, no room-state coupling):

- `DEFAULT_PUNISHMENTS` — ~10 baked-in generic, PG party punishments (e.g. "Sing a song of the group's choice", "Do 15 pushups", "Talk in a funny accent for the next 5 minutes", "Let the group draw on your face with a washable marker", "Do your best impression of another player", "Speak only in questions for 3 minutes", "Do a dance for 30 seconds", "Tell an embarrassing story", "Let the group pick your profile picture for a day", "Act like a chicken for 1 minute").
- `makeDefaultItems()` — returns fresh `{ id, text, addedBy: "default" }` objects from `DEFAULT_PUNISHMENTS` (fresh ids per room so items are independently removable).
- `addItem(items, { text, addedBy, nickname })` — trims `text`, rejects empty-after-trim (`{ error }`), otherwise returns a new items array with `{ id, text, addedBy, nickname }` appended. No length cap, no dedup check (intentional — host curates manually if needed).
- `removeItem(items, id)` — returns a new items array with that id filtered out; removing a nonexistent id is a no-op (returns the array unchanged, not an error).

Room object (`roomService.js`): add `room.punishmentWheel = { items: makeDefaultItems() }` in `createRoom`. This field is **not** touched by `host:reset-room` (which only clears `gameId`/`gameState`) — it persists for the lifetime of the room, surviving across game selection/reset/replay. It dies naturally when the room itself is torn down (existing disconnect/cleanup path), same as everything else on the room object.

## 2. Server events (`index.js` + new `wheel.js`)

Registered as flat room-level listeners in the same `io.on("connection", ...)` block as the other room-level events, **not** wrapped in `withHostGame` — usable with any `room.gameId` state, including `null`.

- `wheel:add-punishment` `{ text }` — from either the host socket or any player socket in the room. Looks up the room by the socket's known room code (same lookup pattern used by `player:join-room`/`host:select-game`), calls `wheelLogic.addItem`, surfacing `{ error }` back to the *sending* socket only if validation fails, otherwise updates `room.punishmentWheel.items` and broadcasts `wheel:list-updated` to the whole room (`io.in(room.code).emit(...)`).
- `wheel:remove-punishment` `{ id }` — host only (mirrors the existing host-only guard pattern used by `host:reset-room`/`host:select-game`: reject silently if the sending socket isn't `room.hostSocketId`). Calls `wheelLogic.removeItem`, updates state, broadcasts `wheel:list-updated`.
- `wheel:list-updated` — server → room broadcast, full current `items` array, sent once at room creation join-time (so a freshly joined player/host sees current state) and after every add/remove.

There is deliberately **no** `spin` server event. The host already holds a live copy of the items array via `wheel:list-updated`; spinning (and respinning) is pure client-side random selection plus a canvas animation on the host's own screen. This keeps the wheel fully decoupled from server/game logic, per the original ask, and means "respin" is nothing more than clicking Spin again — no separate button, no server round trip.

## 3. Host UI

A floating button (e.g. "🎡 Wheel"), rendered as a sibling of `#app` in `host/index.html` — **outside** the `.screen`/`showScreen()` toggle system entirely, so it's visible no matter which screen (lobby, game setup, in-game, results) is currently active. Clicking it opens a panel/modal containing:

- A `<canvas>`-drawn wheel: one slice per current item, colored from a small fixed palette cycled by index, labeled with (truncated, if needed) punishment text, fixed pointer at the top.
- A **Spin** button: picks a random index client-side, animates the canvas rotation via CSS/JS easing to land the pointer on that slice, then displays the landed text prominently. Disabled while a spin animation is in flight (prevents double-trigger); re-enabled on animation end. Clicking it again is the respin — always a fresh independent random pick from the current list.
- An add-punishment text input + Add button (host can add directly, same code path as player submissions).
- The current item list below, each row with a "×" remove button (removal calls `wheel:remove-punishment`).

The panel's local item list is kept in sync via the `wheel:list-updated` listener (registered once, always active, independent of `showScreen()`); if the list changes while the wheel panel is open mid-spin, the in-flight animation finishes on its currently-drawn slices and the new list is applied on next redraw (opening the panel again, or the next Spin).

## 4. Player UI

A floating button (e.g. "🎯 Punishment idea"), likewise a sibling of `#app` in `player/index.html`, always visible regardless of the player's current screen. Clicking it opens a small panel with just a text input and a Submit button — fire-and-forget: on submit, send `wheel:add-punishment`, show a brief "Added!" confirmation (or the returned error, e.g. "can't submit empty text") and clear the input. Players do **not** see the full current item list — only a submit form — so the host's spin keeps some element of surprise and the UI stays minimal.

## 5. Error handling

- Empty/whitespace-only submitted text: rejected both client-side (before sending) and server-side (`wheelLogic.addItem` returns `{ error }` regardless, since server-side validation is the source of truth — client-side check is just to avoid a round trip for the obvious case).
- No length cap, no duplicate detection — per explicit product decision, host manually curates via remove if needed.
- `wheel:remove-punishment` for an id that no longer exists (e.g. two host clicks racing) is a silent no-op, not an error.
- `wheel:add-punishment`/`wheel:remove-punishment` arriving for a room code that doesn't exist (stale socket): ignored, same as the existing pattern for other room-level events.

## 6. Testing plan

Same two-tier pattern as the existing games:

1. Unit (`wheelLogic.test.js`): `makeDefaultItems` returns the expected count with distinct ids; `addItem` trims and rejects empty/whitespace-only text, otherwise appends without mutating the input array; `removeItem` filters correctly and no-ops on an unknown id without mutating the input array.
2. Unit/integration (`wheel.test.js` or inline in `index.js`'s existing socket test style): `wheel:add-punishment` from a non-host player succeeds and broadcasts; `wheel:remove-punishment` from a non-host player is rejected; `host:reset-room` leaves `room.punishmentWheel.items` untouched.
3. E2E (`e2e-wheel.js`, following `e2e-rounds.js`'s pattern): create a room, have a player submit a punishment, assert both host and other players receive `wheel:list-updated` with the new item, host removes an item and asserts the broadcast reflects it, then trigger `host:reset-room` and assert the wheel items are unchanged across the reset.
4. Manual walkthrough: the canvas wheel actually renders/spins/lands sensibly on a phone-sized host screen with a long item list (label truncation, slice count with 15+ items) — worth eyeballing since it's a rendering/visual-timing concern unit tests won't catch.

Edge case to flag for implementation: spinning with zero items on the wheel (host removed everything, including all defaults) — the Spin button should be disabled/no-op rather than crash when the items array is empty.

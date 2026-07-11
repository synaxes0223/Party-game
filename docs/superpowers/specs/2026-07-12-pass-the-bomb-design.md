# Pass The Bomb — New Game

## Context

High-energy hot-potato. A virtual bomb with a **hidden** fuse timer circulates around a player ring. The current holder sees the category on their phone ("Milo variants", "pasar malam foods"), must shout a valid answer out loud (the room polices repeats and nonsense — honor system, no server validation), then taps PASS to send the bomb to the next player. When the fuse blows, whoever is holding it takes a **boom**. Fewest booms wins.

Reuses the prompt pipeline (`2026-07-12-prompt-pipeline-design.md`) for categories — packs, custom, player-submitted, AI — with `meta.usesPromptPipeline = true`. New ingredient vs. the other pipeline games: a **server-side timer**, the platform's first. Build after Who Wrote That? and X People.

## 1. Meta

```js
const meta = {
  id: "pass-the-bomb",
  name: "Pass The Bomb",
  description: "A bomb with a hidden fuse circles the group. Say something from the category out loud, tap PASS fast. Holding it when it blows = boom. Fewest booms wins.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
  usesPromptPipeline: true,
};
```

## 2. Game state

```js
room.gameState = {
  phase: "category-select",   // category-select → ticking → boom (loop) → game-over
  round: 0,
  ring: [],                   // playerIds in randomized seating order, fixed at game start
  holderIndex: null,          // index into ring
  booms: new Map(),           // playerId -> { nickname, count }
  promptState: { maxSpice: 1, usedIndexes: new Set(), queue: [] },
  currentCategory: null,
  fuseTimeout: null,          // Node timeout handle — MUST be cleared on reset/disconnect/game-over
  fuseExpiresAt: null,        // server-side only; NEVER sent to clients (hidden fuse is the game)
}
```

⚠️ Timer hygiene: `host:reset-room` in `index.js` currently just nulls `gameState`. This game must expose an `onReset(room)` hook (called by `host:reset-room` when the game module defines it — small generic addition to `index.js`) that clears `fuseTimeout`. Same clearing in `onPlayerLeft` game-over paths and on `boom`.

## 3. Round flow

### category-select (host)

Same pipeline controls as the other games (`host:draw-prompt`, `host:custom-prompt`, AI tab, `host:set-spice`, submission badge). On game start (first draw): build `ring` by shuffling `room.players` keys; init `booms`. On each draw:

- `round++`, `currentCategory` set, pick a random `holderIndex`, compute fuse duration: random integer **20–50 seconds** (uniform; not shown anywhere), `fuseTimeout = setTimeout(explode, ms)`, phase → `ticking`.
- Broadcast **`game:bomb-started`** `{ round, category, ring: [{id, nickname}], holderId }` to the room. Host screen shows the ring with the bomb on the holder; player phones show the category, and the holder's phone additionally shows the giant PASS button.

### ticking

- **`player:pass-bomb`** `{ code }` → only accepted from the current holder in `ticking` phase (ignore everyone else — no error spam; simultaneous taps race harmlessly). Advance `holderIndex` to the next **active** player in ring order (skip disconnected). Broadcast **`game:bomb-passed`** `{ holderId }`. No server pacing/cooldown: the social contract (say an answer first) is enforced by the room, not the code — spec'd explicitly as out of scope.
- Fuse expiry → `explode()`: clear handle; increment holder's boom count; phase → `boom`; broadcast **`game:bomb-exploded`** `{ holderId, holderNickname, booms: [{id, nickname, count}] }`. Player phones buzz (Vibration API where supported) + explosion visual on host screen.

### boom → next round / game over

- `host:next-round` → phase `category-select`.
- `host:end-game` → clear any timer, phase `game-over`, `room.state = "results"`, emit **`game:results`** `{ winners: [{id, nickname, count}], booms: [...] }` — winners = all players with the minimum boom count.

## 4. Disconnect handling (`onPlayerLeft`)

- Remove from ring participation (keep the entry but skip inactive ids when advancing; keep their `booms` entry for the final board).
- If the **current holder** disconnects mid-`ticking`: auto-pass to the next active player (broadcast `game:bomb-passed`) — the fuse keeps running.
- <2 active players remain: clear timer, end game immediately with current booms.

## 5. Client UI

**Host**: category-select (shared pipeline components); ticking screen — the ring drawn as a circle of nicknames with a bomb icon on the holder and the category displayed huge (the room reads the category off the TV; the holder's phone is just the button); explosion animation + boom tally; final results.

**Player**: category card; when holding — full-screen red PASS button (single biggest tap target in the app; accidental double-taps are harmless since only the holder's tap counts); when not holding — "🧨 [nickname] has the bomb" + category; boom screen; final results. Use `navigator.vibrate` on receiving the bomb and on explosion (progressive enhancement — iOS Safari lacks it, fine).

No countdown display anywhere, ever — tension comes from not knowing.

## 6. Testing plan

1. Unit `passTheBomb.test.js` (inject a fake timer/clock or wrap `setTimeout` so tests don't sleep): ring built once and stable; pass only accepted from holder; pass skips disconnected players; explosion increments the holder; holder-disconnect auto-pass; end-game clears the timer; winners = min booms including ties.
2. E2E `e2e-pass-the-bomb.js` (own port): to keep the run fast, allow an env override `BOMB_FUSE_MS_RANGE` (e.g. `"500,1000"`) read by the game module — test sets a short fuse, plays two rounds with passes and one explosion, verifies boom counts and results.
3. Manual walkthrough on phones: PASS button latency and vibration feel.

## Appendix — starter category pack (`promptPacks.js["pass-the-bomb"]`)

Category texts — the holder must name an example out loud. Copy verbatim.

```js
[
  // ---- spice 1: chill (most categories live here — speed is the spice) ----
  { text: "Milo variants or Milo-based drinks", spice: 1 },
  { text: "Things you can order at a mamak", spice: 1 },
  { text: "Pasar malam foods", spice: 1 },
  { text: "Kopitiam drinks (kopi/teh family counts)", spice: 1 },
  { text: "CNY snacks", spice: 1 },
  { text: "Things aunties say at CNY", spice: 1 },
  { text: "Malaysian public holidays", spice: 1 },
  { text: "LRT/MRT station names", spice: 1 },
  { text: "Things in a Malaysian household that are 'for guests only'", spice: 1 },
  { text: "Brands of instant noodles", spice: 1 },
  { text: "Excuses for being late", spice: 1 },
  { text: "Things people fight about in a group chat", spice: 1 },
  { text: "K-drama or C-drama titles", spice: 1 },
  { text: "Mobile games everyone has deleted at least once", spice: 1 },
  { text: "Things you'd find in a mum's plastic-bag drawer", spice: 1 },
  { text: "Durian varieties or things that smell as strong", spice: 1 },
  { text: "Bubble tea toppings or flavours", spice: 1 },
  { text: "Malaysian slang words", spice: 1 },
  { text: "Things that cost RM10 or less at the mamak", spice: 1 },
  { text: "Karaoke songs people always fight over", spice: 1 },
  { text: "Shopee/Lazada impulse buys", spice: 1 },
  { text: "Places to tapau lunch near an office", spice: 1 },
  { text: "Things Malaysians queue for", spice: 1 },
  { text: "Words your grandparents say that you barely understand", spice: 1 },
  { text: "Steamboat ingredients", spice: 1 },
  { text: "Famous Malaysian roads or highways", spice: 1 },

  // ---- spice 2: spicy (categories that expose the group a little) ----
  { text: "Reasons people ghost someone", spice: 2 },
  { text: "Red flags on a first date", spice: 2 },
  { text: "Lies people tell their parents", spice: 2 },
  { text: "Things people do at work when the boss isn't looking", spice: 2 },
  { text: "Excuses for not paying someone back", spice: 2 },
  { text: "Things people stalk on social media", spice: 2 },
]
```

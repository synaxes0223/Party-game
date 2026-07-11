# Prompt Pipeline — Shared Prompt-Sourcing Service

## Context

Four new games are planned (Who Wrote That?, X People In This Room, Pass The Bomb, Secret Mission Bingo — each has its own spec in this folder). All four run on *prompts*: a question, a yes/no statement, a category, or a mission. The quality of those prompts decides whether the game lands, so prompt sourcing is built **once** as a shared service and reused by every game — the same pattern as `audioSourceLogic.js` (audio sources for Find the Imposter) and `wordPairLogic.js` (word pairs for Word Wolf).

Three sources, all available to the host at round start:

1. **Curated packs** — built-in datasets shipped with each game, tagged with a spice level. Zero friction; the reliable floor.
2. **Player-submitted prompts** — players secretly write prompts on their phones; friends writing prompts about each other is where the best moments come from.
3. **AI-generated prompts** — host types a topic ("CNY edition", "office horror stories"), the server calls the Claude API and returns a batch for the host to approve.

Audience note for all content: the target group is Malaysian Chinese friends in their mid-20s. Prompts may freely use Manglish ("walao", "bo jio", "yumcha", "tapau"), local references (mamak, pasar malam, Grab, Shopee, TnG, kopitiam), and casual CN terms. This applies to curated packs (already written into each game's spec) and to the AI system prompt below.

## 1. Spice levels

Every prompt carries `spice: 1 | 2 | 3`:

| Level | Label | Meaning |
|---|---|---|
| 1 | Chill | Safe for any group, funny, no exposure |
| 2 | Spicy | Personal, embarrassing, mild secrets |
| 3 | 玩真的 | No-holds-barred: relationships, money, real confessions |

The host picks a **max spice** for the session (default 2). Drawing at max spice N includes all prompts with `spice <= N`.

## 2. Data model

New file `server/games/promptPacks.js` — pure data, no logic:

```js
// Each entry: { text: string, spice: 1|2|3 }
module.exports = {
  "who-wrote-that": [ { text: "...", spice: 1 }, ... ],
  "x-people":       [ { text: "...", spice: 2 }, ... ],
  "pass-the-bomb":  [ { text: "...", spice: 1 }, ... ],  // texts are category names
  "secret-missions":[ { text: "...", spice: 1 }, ... ],  // texts are missions
};
```

The actual pack content lives in each game's spec (appendix section) — the implementer copies it into `promptPacks.js` verbatim.

## 3. Pure logic module — `server/games/promptLogic.js`

Mirrors `wordPairLogic.js`: no socket.io, no room state, fully unit-testable.

- `pickFromPack(pool, usedIndexes, maxSpice)` — returns `{ prompt, index, usedIndexes }`. Picks a random entry with `spice <= maxSpice` whose index is not in `usedIndexes`; adds the index to a copy of `usedIndexes`. When every eligible index is used, resets the eligible portion and allows repeats (same never-runs-dry behavior as `pickAutoPair`). Returns `{ error }` if the pool has no entry at or below `maxSpice` at all.
- `validateSubmission(text)` — trims, requires non-empty, caps at 200 chars, returns `{ text }` or `{ error }`.
- `drawNext(submissionQueue, pool, usedIndexes, maxSpice)` — the single draw function games call each round. Rule: **player submissions drain first** (shift from `submissionQueue`, FIFO of an already-shuffled list), then AI-approved prompts, then curated packs. Returns `{ prompt: { text, spice, source: "player"|"ai"|"pack" }, ... }`. (AI-approved prompts are pushed onto the same `submissionQueue` with `source: "ai"`, so in practice the queue holds both; the rule is simply queue-before-pack.)

## 4. Room-level prompt state

Games that use the pipeline keep this inside their own `room.gameState` (created on game start):

```js
promptState: {
  maxSpice: 2,             // host-selected, changeable between rounds
  usedIndexes: new Set(),  // into the game's pack
  queue: [],               // [{ text, spice, source, authorId? }] — player submissions + approved AI prompts, shuffled on insert
}
```

Same lifecycle as Word Wolf's `usedPairIndexes`: reset when a new game starts, no persistence.

## 5. Player submissions — socket events

Available whenever a pipeline game is the selected game (lobby included, so people can submit before the round starts and during other people's turns):

- **`player:submit-prompt`** `{ code, text }` → validate via `validateSubmission`; push `{ text, spice: promptState.maxSpice, source: "player", authorId: socket.id }` into the queue at a random position. Reply `player:prompt-accepted` `{}` or `player:prompt-rejected` { error }`. Cap: 5 pending submissions per player (prevents spam); count against `authorId`.
- The host is told only the **count**: emit `game:submission-count` `{ count }` to the host on every accepted submission — never the texts (anonymity is the point; the host is also a player audience).
- When a player-submitted prompt is drawn, the drawing game must **exclude the author from authorship-guessing/scoring edge cases** only where that game's spec says so (Who Wrote That? handles this; the others don't need to).

Handler registration in `index.js` follows the existing pattern — a `player:*` event that looks up the room, checks `room.gameId` supports prompts (see §7), and delegates.

## 6. AI generation — `server/games/aiPromptService.js`

### Dependency & config

- npm package `@anthropic-ai/sdk` (add to `server/package.json`).
- Env vars: `ANTHROPIC_API_KEY` (required for the feature; if unset the feature is disabled, not broken), `PROMPT_GEN_MODEL` (optional; default `"claude-opus-4-8"`; set to `"claude-haiku-4-5"` if the owner prefers the cheapest option — quality of short party prompts is still fine there, but that trade-off is the owner's call).

### Module surface

```js
// aiPromptService.js
const Anthropic = require("@anthropic-ai/sdk");

function isAvailable() { return Boolean(process.env.ANTHROPIC_API_KEY); }

async function generatePrompts({ gameId, topic, spice, count = 10 }) -> { prompts: [{text, spice}] } | { error }
```

### API call shape (authoritative — do not improvise)

```js
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const res = await client.messages.create({
  model: process.env.PROMPT_GEN_MODEL || "claude-opus-4-8",
  max_tokens: 2000,
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: { prompts: { type: "array", items: { type: "string" } } },
        required: ["prompts"],
        additionalProperties: false,
      },
    },
  },
  system: SYSTEM_PROMPT, // below
  messages: [{ role: "user", content: userMessage }],
});
const text = res.content.find((b) => b.type === "text").text;
const { prompts } = JSON.parse(text);
```

Notes for the implementer:
- `output_config.format` (json_schema) guarantees parseable JSON — do not regex the output.
- No `temperature`/`top_p`/`top_k` and no `thinking` config — these are removed/unneeded on current models and will 400.
- Error handling: catch the SDK's typed errors most-specific-first (`Anthropic.RateLimitError` → "AI is busy, try again"; `Anthropic.AuthenticationError` → "API key invalid"; `Anthropic.APIError` → generic). Also handle `res.stop_reason === "refusal"` (return `{ error: "Couldn't generate prompts for that topic." }`) and `"max_tokens"` (truncated — return error, don't parse).
- Timeout: leave SDK default; the call is small.

### System prompt (starting point, tune freely)

```
You write party-game prompts for a group of Malaysian Chinese friends in their
mid-20s. Manglish is welcome (walao, bo jio, yumcha, tapau), and so are local
references (mamak, pasar malam, Grab, Shopee, TnG, kopitiam, CNY, LRT).
Prompts must be short (under 140 characters), specific, and funny — never
generic icebreaker filler. Never produce anything hateful or targeting a
specific real person.

Game type: {gameDescription}   // per-game one-liner, e.g. "an anonymous-answer
                               // guessing game: every player writes an answer,
                               // then the group guesses who wrote what"
Spice level {spice} of 3: {spiceDescription}
  1 = safe and silly, no personal exposure
  2 = personal and embarrassing, mild secrets
  3 = no-holds-barred: relationships, money, real confessions
```

User message: `Generate {count} prompts about: {topic}`.

### Socket events

- **`host:generate-prompts`** `{ code, topic, spice, count }` (host-only, via `withHostGame`) → calls `generatePrompts`; replies to host with `game:generated-prompts` `{ prompts }` or `host:error` `{ error }`. Validate `topic` non-empty ≤100 chars, `count` clamped 5–20.
- Host UI shows the batch as a checkbox list (all checked by default); host unchecks duds, then:
- **`host:approve-prompts`** `{ code, prompts: [{text, spice}] }` → server pushes each as `{ ..., source: "ai" }` into `promptState.queue` (shuffled in). Re-validate each text server-side with `validateSubmission`.
- Availability: extend each pipeline game's `meta` with `usesPromptPipeline: true`; when the host selects such a game, `index.js` emits `game:prompt-sources` `{ aiAvailable: aiPromptService.isAvailable() }` to the host (alongside the existing `room:game-selected` emit). Host UI hides the AI tab when `aiAvailable` is false.

## 7. Wiring convention for games

A game opts in by setting `meta.usesPromptPipeline = true` and exposing `onPromptSubmitted(room, io, socketId, text)` — `index.js`'s `player:submit-prompt` handler delegates there so each game controls when submissions are allowed (e.g. not after the game is over). Games call `promptLogic.drawNext(...)` inside their own round-start handlers; the pipeline never starts rounds itself.

## 8. Testing plan

1. Unit `promptLogic.test.js`: spice filtering; no repeats until eligible pool exhausted, then reset; submission validation (empty, whitespace, >200 chars); `drawNext` ordering (queue before pack, FIFO within queue).
2. Unit `aiPromptService.test.js`: `isAvailable` with/without env var; response parsing given a mocked client (inject the client or mock the module — do **not** call the real API in tests); refusal and max_tokens stop reasons map to errors.
3. The socket-event wiring is covered by each game's own E2E script (they exercise pack draw + a submitted prompt); AI generation gets a manual smoke test with a real key (cheap, one call) rather than E2E.

## 9. Build order for the four games

1. **Prompt pipeline** (this spec) — foundation.
2. **Who Wrote That?** — exercises the full pipeline; highest fun-per-effort.
3. **X People In This Room** — smallest delta once #2 exists.
4. **Pass The Bomb** — adds a server-side timer, otherwise small.
5. **Secret Mission Bingo** — largest: requires the reconnect prerequisite (see its spec §1) — do it last.

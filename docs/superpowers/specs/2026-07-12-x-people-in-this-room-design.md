# X People In This Room — New Game

## Context

Digital Never-Have-I-Ever with anonymity and a prediction twist. Each round: a yes/no statement goes to every phone; each player privately answers **yes/no** *and* predicts **how many players total will say yes**; the host screen then reveals only the count — "4 people in this room have ghosted someone" — never who. Points go to accurate predictors. The reveal + the room interrogating each other is the game.

Build **after Who Wrote That?** — it reuses the prompt pipeline (`2026-07-12-prompt-pipeline-design.md`, `meta.usesPromptPipeline = true`) and the same host-driven round loop, with a simpler resolution (no per-answer guessing loop). Read the Who Wrote That? spec first; only deltas are detailed here.

## 1. Meta

```js
const meta = {
  id: "x-people",
  name: "X People In This Room",
  description: "Answer spicy yes/no questions anonymously — the screen shows only HOW MANY said yes, never who. Predict the count to score points. Then interrogate each other.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
  usesPromptPipeline: true,
};
```

## 2. Game state

```js
room.gameState = {
  phase: "prompt-select",   // prompt-select → answering → reveal (loop) → game-over
  round: 0,
  scores: new Map(),        // playerId -> { nickname, score }
  promptState: { maxSpice: 2, usedIndexes: new Set(), queue: [] },
  currentPrompt: null,
  responses: new Map(),     // playerId -> { answer: boolean, prediction: number }
}
```

## 3. Round flow

### prompt-select

Identical host controls to Who Wrote That? (`host:draw-prompt`, `host:custom-prompt`, AI tab, `host:set-spice`, submission-count badge). On draw: `round++`, phase → `answering`, broadcast **`game:prompt`** `{ round, text, playerCount }` (playerCount bounds the prediction picker).

### answering

- **`player:submit-response`** `{ code, answer: bool, prediction: int }` → valid in `answering` only; prediction clamped 0..playerCount; resubmission replaces. Host gets `game:answer-progress` `{ answered, total }`.
- All in → resolve immediately (no host click needed):

### reveal

Compute `yesCount = responses where answer === true`. Scoring per player: exact prediction **+100**; off by one **+50**. (A player's own answer counts toward the total they were predicting — no special casing.)

Emit **`game:count-reveal`** to the room:

```js
{
  round, text, yesCount, playerCount,
  results: [{ id, nickname, prediction, points }],   // predictions are public; answers are NOT
  scores: [{ id, nickname, score }],                  // running totals, sorted desc
}
```

Host screen: big animated count-up to `yesCount` (this is the drama moment — make the number huge), then the prediction results and scoreboard. Player phones: your prediction vs actual, points gained, running score. **Never transmit who answered yes** — the `responses` map stays server-side; only aggregate `yesCount` and the (public) predictions leave the server.

- `host:next-round` → back to `prompt-select`.
- `host:end-game` → `game:results` with final scoreboard, `room.state = "results"` (same shape as Who Wrote That?).

## 4. Disconnect handling

- `answering`: drop their pending response; if everyone remaining is in, resolve with remaining players (`playerCount` for scoring = responders count at resolution time; predictions are scored against the actual yesCount as computed — no adjustment, keep it simple).
- ≤1 player left: end game with current scores.
- Same `host:force-answers` escape hatch as Who Wrote That? (valid in `answering`, requires ≥2 responses).

## 5. Client UI

**Host**: prompt-select (shared components with Who Wrote That? where practical); answering progress; the count-up reveal screen (largest visual element the platform has — number scales to fill the screen); prediction results + scoreboard; final scoreboard.

**Player**: question card with two big YES / NO buttons + a prediction stepper (0..N) + submit; reveal screen (actual count, your prediction, points); persistent prompt-submission affordance (pipeline).

Anonymity note for UI copy: tell players explicitly "your answer is never shown to anyone" on the answer screen — the game dies if people don't trust it.

## 6. Testing plan

1. Unit `xPeople.test.js`: response validation and clamping; resubmission replaces; resolution triggers when all in; scoring (exact / ±1 / miss); reveal payload contains no per-player answers (assert the emitted object shape); disconnect during answering resolves correctly; end-game.
2. E2E `e2e-x-people.js` (own port): host + 3 players, two rounds (one pack draw, one custom prompt), verify counts and scores, end game.
3. Manual walkthrough: confirm the answer screen wording and that the count animation lands.

## Appendix — starter pack (`promptPacks.js["x-people"]`)

All prompts are yes/no statements addressed to the player. Copy verbatim.

```js
[
  // ---- spice 1: chill ----
  { text: "Have you ever muted this friend group's chat?", spice: 1 },
  { text: "Have you ever pretended to know a song everyone was singing?", spice: 1 },
  { text: "Have you eaten instant noodles more than 3 times this week?", spice: 1 },
  { text: "Have you ever cried at a Pixar movie?", spice: 1 },
  { text: "Do you secretly think you're the funniest person here?", spice: 1 },
  { text: "Have you ever clapped when a plane landed?", spice: 1 },
  { text: "Do you still sleep with a bolster?", spice: 1 },
  { text: "Have you ever finished someone else's food without asking?", spice: 1 },
  { text: "Have you ever said 'on my way' while still in the shower?", spice: 1 },
  { text: "Do you check your phone within 1 minute of waking up?", spice: 1 },
  { text: "Have you ever forgotten a good friend's birthday?", spice: 1 },
  { text: "Have you ever rewatched an entire drama series more than twice?", spice: 1 },
  { text: "Have you ever talked to yourself out loud in public?", spice: 1 },
  { text: "Do you have more than 3,000 unread emails right now?", spice: 1 },
  { text: "Have you ever eaten cake straight from the fridge with a spoon at 2am?", spice: 1 },
  { text: "Have you ever pretended your phone died to end a conversation?", spice: 1 },

  // ---- spice 2: spicy ----
  { text: "Have you stalked an ex (or their new partner) this month?", spice: 2 },
  { text: "Have you ever pretended to be busy to skip a gathering with people in this room?", spice: 2 },
  { text: "Have you ever cried in a work/uni toilet?", spice: 2 },
  { text: "Have you ever read someone else's messages over their shoulder on the LRT?", spice: 2 },
  { text: "Have you ever lied about your salary?", spice: 2 },
  { text: "Have you ever ghosted someone who did nothing wrong?", spice: 2 },
  { text: "Do you have a crush on someone right now?", spice: 2 },
  { text: "Have you ever screenshot a conversation to complain about it in another chat?", spice: 2 },
  { text: "Have you ever faked being sick to skip work/class this year?", spice: 2 },
  { text: "Have you ever returned something after using it once?", spice: 2 },
  { text: "Have you ever snooped through a partner's or friend's phone?", spice: 2 },
  { text: "Have you ever badmouthed someone in this room to someone else in this room?", spice: 2 },
  { text: "Have you ever pretended to like a gift from someone here?", spice: 2 },
  { text: "Do you owe anyone in this room money right now?", spice: 2 },
  { text: "Have you ever deleted a message right after sending it and hoped they didn't see?", spice: 2 },
  { text: "Have you ever gone through an entire date thinking about someone else?", spice: 2 },

  // ---- spice 3: 玩真的 ----
  { text: "Have you ever been in love with someone in this room?", spice: 3 },
  { text: "Have you ever seriously considered cutting off someone in this room?", spice: 3 },
  { text: "Have you ever lied to your partner about where you were?", spice: 3 },
  { text: "Have you ever kissed someone whose name you didn't know?", spice: 3 },
  { text: "Are you currently hiding something big from your parents?", spice: 3 },
  { text: "Have you ever been the third party in someone's relationship (knowingly or not)?", spice: 3 },
  { text: "Have you ever cried over someone in this room?", spice: 3 },
  { text: "Do you regret something you did at the last gathering of this group?", spice: 3 },
  { text: "Have you ever checked a partner's phone and found something?", spice: 3 },
  { text: "Is there someone you text that this group doesn't know about?", spice: 3 },
]
```

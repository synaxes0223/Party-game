# Who Wrote That? — New Game

## Context

Anonymous-answer guessing game, the platform's flagship icebreaker. Every round: a prompt goes to all players' phones; everyone types an answer anonymously; answers appear on the host screen one at a time; players vote on who wrote each answer; authors score for fooling people, guessers score for being right. No elimination — it's a points game that runs as long as the host wants.

Builds directly on the **prompt pipeline** (`2026-07-12-prompt-pipeline-design.md` — read that first; this game sets `meta.usesPromptPipeline = true`). Reuses the room/lobby system unchanged. Does **not** reuse `imposterLogic.js` — there is no elimination or win condition; scoring is new but trivial.

## 1. Meta

```js
const meta = {
  id: "who-wrote-that",
  name: "Who Wrote That?",
  description: "Everyone answers a prompt anonymously. Answers appear on the big screen one by one — guess who wrote each. Fool your friends for bonus points.",
  minPlayers: 3,
  maxPlayers: 16,
  supportedModes: ["multiplayer"],
  usesPromptPipeline: true,
};
```

## 2. Game state

Created on first round start (like Word Wolf's `startRound`):

```js
room.gameState = {
  phase: "prompt-select",   // prompt-select → answering → guessing → answer-reveal → round-results (loop) → game-over
  round: 0,
  scores: new Map(),        // playerId -> number, initialized 0 for every player in the room
  promptState: { maxSpice: 2, usedIndexes: new Set(), queue: [] },  // pipeline, see pipeline spec §4
  currentPrompt: null,      // { text, spice, source, authorId? }
  answers: [],              // shuffled: [{ playerId, text }]
  answerIndex: -1,          // which answer is currently being guessed
  votes: new Map(),         // playerId -> guessedPlayerId, cleared per answer
}
```

`room.state` handling mirrors Word Wolf: `"in-progress"` once the first round starts, `"results"` on game over.

## 3. Round flow

### prompt-select (host)

Host screen shows: spice selector (1/2/3), submission count badge (`game:submission-count`), and three actions:
- **Draw prompt** → `host:draw-prompt` `{ code }` → server calls `promptLogic.drawNext(...)`. If the drawn prompt has `source: "player"`, its `authorId` still receives it and answers like everyone else (their answer is just extra cover for them).
- **Custom prompt** → `host:custom-prompt` `{ code, text }` → validated via `validateSubmission`, used directly.
- **AI generate** (tab, only if available) → per pipeline spec §6.

Both draw paths then start the round: increment `round`, set `currentPrompt`, `answers = []`, phase → `answering`, and broadcast **`game:prompt`** `{ round, text }` to all players in the room; host gets `game:answer-progress` `{ answered: 0, total }`.

- **`host:set-spice`** `{ code, spice }` → updates `promptState.maxSpice` (valid only in `prompt-select` phase).

### answering (players)

- **`player:submit-answer`** `{ code, text }` → valid only in `answering` phase, one per player (resubmission replaces — allows typo fixes until everyone is in), trimmed, 1–140 chars. Push/replace in a temporary map. Host receives `game:answer-progress` `{ answered, total }`.
- When every active player has answered: shuffle answers into `gameState.answers`, set `answerIndex = 0`, phase → `guessing`, emit the first answer (below).
- Host also gets a **`host:force-answers`** `{ code }` escape hatch (valid in `answering`, requires ≥2 answers): proceeds with whoever answered — players who didn't answer sit out the round's authorship but still guess. (Prevents one AFK phone from stalling the party.)

### guessing (one answer at a time)

For each `answerIndex`:
- Emit **`game:show-answer`** to the room: `{ answerNumber: answerIndex+1, totalAnswers, text }`. Host screen displays the answer big; player phones show the answer plus a vote list of all players **who submitted an answer this round** (candidates = possible authors).
- Every player who answered votes via **`player:vote-author`** `{ code, votedForId }` — including the author, who votes for someone else as camouflage (self-votes rejected with `player:vote-rejected`, same UX as Word Wolf). Players who didn't answer (force-started round) may also vote; they just can't be voted *for*.
- `game:vote-progress` `{ voted, total }` to host (reuse the existing event name/shape).
- When all expected votes are in → phase `answer-reveal`: compute scoring, emit **`game:answer-reveal`** to the room:

```js
{
  authorId, authorNickname, text,
  correctGuessers: [{ id, nickname }],   // +100 each
  fooledCount,                           // wrong guessers (excluding the author's own camouflage vote)
  authorBonus,                           // fooledCount * 50
}
```

- Host clicks **`host:next-answer`** `{ code }` → if more answers remain: `answerIndex++`, clear `votes`, back to `guessing` with the next `game:show-answer`. Otherwise phase → `round-results`, emit **`game:round-results`** `{ round, scores: [{ id, nickname, score, delta }] }` to the room (sorted desc).

### Scoring

- Correct authorship guess: **+100** to the guesser.
- Author bluff bonus: **+50 per wrong guess** (the author's own mandatory camouflage vote is excluded from both counts).
- No negative scores.

### round-results → next round / game over

- **`host:next-round`** (existing event name) → phase `prompt-select`, clear per-round fields.
- **`host:end-game`** `{ code }` (new, valid in `round-results` or `prompt-select`) → phase `game-over`, `room.state = "results"`, emit **`game:results`** `{ winner: {id, nickname, score} | null, scores: [...] }` (winner null on a tie is fine — send `winners` array instead if simpler).

## 4. Disconnect handling (`onPlayerLeft`)

Removed player: delete from `scores`? No — keep their score for the final board but mark them gone (roomService already removed them from `room.players`; keep a `nickname` snapshot in `scores` entries, i.e. store `scores: Map<playerId, { nickname, score }>` so the final board survives departures — adopt this shape from the start).
- Phase `answering`: drop their pending answer; if everyone remaining has answered, advance.
- Phase `guessing`: drop their vote if pending; if they are the **current answer's author**, void the answer (emit `game:answer-reveal` with a `voided: true` flag and no points) and let the host advance; if all remaining votes are in, resolve.
- ≤1 active player left: end game with current scores.

## 5. Client UI

**Host** (`public/host`): prompt-select screen (spice pills, Draw / Custom / AI tabs, submission-count badge); answering screen (prompt large + progress + force button); guessing screen (answer card "Answer 3 of 8", vote progress); reveal overlay (author + who guessed right + points); round scoreboard; final scoreboard. Reuse the existing screen-switching conventions in `host.js`.

**Player** (`public/player`): prompt submission box (available whenever this game is selected — small persistent "✍️ submit a prompt" affordance); answering screen (prompt + text input + submit/edit); guessing screen (answer text + tappable player list, self disabled); per-answer result flash (right/wrong/fooled-people); scoreboard between rounds.

## 6. Testing plan

1. Unit `whoWroteThat.test.js`: round start draws through the pipeline; answer collection completes → shuffled answers, phase guessing; self-vote rejected; scoring math (correct guess, bluff bonus, author camouflage vote excluded); force-answers with 2+ answers; author disconnect voids the current answer; end-game emits sorted scores.
2. E2E `e2e-who-wrote-that.js` (own port, following the Word Wolf e2e precedent): host + 3 players, one player submits a prompt pre-round, host draws (gets the submitted prompt first per pipeline ordering), all answer, full guess/reveal loop for every answer, two rounds, end game, verify final scores.
3. Manual walkthrough on phones for feel/layout.

## Appendix — starter pack (`promptPacks.js["who-wrote-that"]`)

Copy verbatim. `spice: 1` chill / `2` spicy / `3` 玩真的.

```js
[
  // ---- spice 1: chill ----
  { text: "Your go-to mamak order when someone else is paying", spice: 1 },
  { text: "The most auntie/uncle thing you've done recently", spice: 1 },
  { text: "A food hill you will die on", spice: 1 },
  { text: "The last thing you searched on Shopee", spice: 1 },
  { text: "Your most-used emoji and what it secretly means", spice: 1 },
  { text: "The weirdest thing in your bag/pockets right now", spice: 1 },
  { text: "A skill you claim to have but have never proven", spice: 1 },
  { text: "Your karaoke song when you want to show off", spice: 1 },
  { text: "The most Malaysian sentence you can write", spice: 1 },
  { text: "What you'd tapau if today was your last meal", spice: 1 },
  { text: "Your honest opinion of durian, in one dramatic sentence", spice: 1 },
  { text: "The app you'd be embarrassed to show us your screen time for", spice: 1 },
  { text: "A rule from your childhood home that made no sense", spice: 1 },
  { text: "Your default excuse for being late", spice: 1 },
  { text: "The pettiest reason you've disliked someone", spice: 1 },
  { text: "What your Grab driver rating reason would say", spice: 1 },
  { text: "Describe your driving in three words", spice: 1 },
  { text: "The most useless thing you've bought during a sale", spice: 1 },
  { text: "Your zombie apocalypse role in this friend group", spice: 1 },
  { text: "A smell that instantly takes you back to childhood", spice: 1 },
  { text: "The dish you order to judge a new restaurant", spice: 1 },
  { text: "Your unpopular opinion about CNY", spice: 1 },
  { text: "If your life had a loading screen tip, what would it say?", spice: 1 },
  { text: "The celebrity you irrationally dislike", spice: 1 },

  // ---- spice 2: spicy ----
  { text: "The last white lie you told someone in this room", spice: 2 },
  { text: "Your worst habit that you have zero plans to fix", spice: 2 },
  { text: "The most childish thing you still do in secret", spice: 2 },
  { text: "A time you pretended to be busy to avoid a yumcha invite", spice: 2 },
  { text: "The last thing you cried about (be honest)", spice: 2 },
  { text: "Your most embarrassing search history entry this month", spice: 2 },
  { text: "Something you've done at work/uni you hope your boss never finds out", spice: 2 },
  { text: "The pettiest revenge you've ever taken", spice: 2 },
  { text: "A secret talent nobody in this room knows about", spice: 2 },
  { text: "Your 3am thought that keeps coming back", spice: 2 },
  { text: "The biggest waste of money you've ever committed", spice: 2 },
  { text: "Describe your love life using only a food dish", spice: 2 },
  { text: "The lie you tell your parents most often", spice: 2 },
  { text: "Something you judge people for even though you do it too", spice: 2 },
  { text: "The most desperate thing you've done for free food", spice: 2 },
  { text: "Your actual first impression of the person on your left", spice: 2 },
  { text: "A message you regret sending (paraphrase it)", spice: 2 },
  { text: "The weirdest place you've fallen asleep", spice: 2 },

  // ---- spice 3: 玩真的 ----
  { text: "The biggest red flag you've ever ignored in someone", spice: 3 },
  { text: "Something you've never admitted to anyone in this room", spice: 3 },
  { text: "Your most toxic trait, stated with zero defensiveness", spice: 3 },
  { text: "The real reason your last relationship/situationship ended", spice: 3 },
  { text: "A secret you're keeping for someone else (no names)", spice: 3 },
  { text: "The most money you've lost in one bad decision", spice: 3 },
  { text: "Who in this room would you trust with your phone unlocked, and why not the others?", spice: 3 },
  { text: "The thing you're most insecure about that nobody would guess", spice: 3 },
  { text: "A time you ghosted someone and the actual reason", spice: 3 },
  { text: "The closest you've come to getting caught doing something you shouldn't", spice: 3 },
]
```

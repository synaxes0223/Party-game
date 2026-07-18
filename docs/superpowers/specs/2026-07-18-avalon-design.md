# Avalon — New Game

## Context

This is the platform's fourth game: **The Resistance: Avalon**, the classic
hidden-role social deduction game — Merlin/Percival for Good, Assassin/Morgana
for Evil, team-building "quests," and a final Assassin guess that can steal
the win for Evil even if Good completed three quests. It's a much bigger state
machine than the platform's existing games (role knowledge varies per player,
leadership rotates among players rather than staying with the host, and a
single quest has three nested voting phases), but it reuses the same
room/lobby shell, the same host-runs-a-laptop / players-join-by-phone split,
and the same phase-broadcast pattern the other games use.

Unlike Find the Imposter / Word Wolf / Slip-Up, Avalon does not use the
generic elimination-voting logic in `imposterLogic.js` — its voting (team
approval, quest pass/fail) and win conditions are structurally different, so
it gets its own self-contained logic.

Registered as a single file, `games/avalon.js` (constants, pure helpers, and
socket-facing handlers together) — smaller than a two-file split like Word
Wolf's, per explicit choice to keep this one simple.

## 1. Roles & player-count scaling

Role set: base game + Percival/Morgana (no Mordred, no Oberon, no Lady of the
Lake).

- **Good**: Merlin, Percival, remaining players are Loyal Servants of Arthur.
- **Evil**: Assassin, Morgana, remaining players are Minions of Mordred.

`minPlayers: 5`, `maxPlayers: 10` in `meta` — Avalon has no honest way to
scale outside this range, so the host simply can't start it with a headcount
outside the table below.

| Players | Good | Evil | Quest team sizes (Q1–Q5) | Quest 4 needs 2 fails? |
|---|---|---|---|---|
| 5 | 3 | 2 | 2, 3, 2, 3, 3 | no |
| 6 | 4 | 2 | 2, 3, 4, 3, 4 | no |
| 7 | 4 | 3 | 2, 3, 3, 4, 4 | yes |
| 8 | 5 | 3 | 3, 4, 4, 5, 5 | yes |
| 9 | 6 | 3 | 3, 4, 4, 5, 5 | yes |
| 10 | 6 | 4 | 3, 4, 4, 5, 5 | yes |

Role knowledge, computed once at game start and never recomputed:

- Merlin sees the full Evil player list.
- Percival sees `{Merlin, Morgana}` as an unordered pair — the two nicknames
  are shown in randomized order, never labeled which is which.
- Evil players (Assassin, Morgana, Minions) see each other's identities.
- Loyal Servants see nothing beyond their own role.

Win conditions:

- 3 failed quests → Evil wins outright, skip straight to `game-over`.
- 3 successful quests → Assassin gets one guess at Merlin's identity
  (`assassin` phase). Correct guess flips the win to Evil; otherwise Good
  wins.
- 5 consecutive rejected team proposals within a single quest → Evil wins
  immediately ("hung parliament" rule), regardless of prior quest results.

## 2. Round flow (phase state machine)

<!-- Updated post-implementation: event names below use the actual
`avalon-`-namespaced wire protocol (avoids collisions with other games'
generic event names, e.g. `player:vote`). Also, the implementation
broadcasts a single consolidated `game:avalon-state` event after every phase
transition (carrying phase/leader/team/questResults/etc.) rather than one
bespoke event per transition — this section still names the transient
per-transition reveal events (`game:avalon-role`, `game:avalon-team-vote-result`,
`game:avalon-quest-result`, `game:avalon-results`) since those carry payloads
`game:avalon-state` doesn't, but every phase change is also always followed
by a `game:avalon-state` broadcast, which is what actually drives client-side
screen routing. -->

`room.gameState.phase` progression, with a `leaderIndex` that rotates to the
next player (in the fixed join order captured at `role-reveal`, wrapping
around) after every proposal — whether approved, rejected, or moving on to
the next quest — and a `rejectionCount` that resets to 0 whenever a quest
resolves. The player list never shrinks mid-game (a disconnect ends the game
per §3's `onPlayerLeft`), so rotation order is stable for the whole match.

1. **`role-reveal`** — host clicks **Start Game** (`host:avalon-start`) from
   the lobby, roles/knowledge assigned once, each player privately receives
   their role info via `game:avalon-role`. Host clicks **Begin Quests**
   (`host:avalon-begin`) → `team-proposal`.
2. **`team-proposal`** — the current leader picks exactly the required number
   of teammates and submits via `player:avalon-propose-team`; only the
   leader's submission is accepted (server checks `socketId === leaderId`) →
   phase becomes `team-vote`.
3. **`team-vote`** — every active player casts approve/reject via
   `player:avalon-team-vote`. Once all votes are in, results are revealed
   **publicly** (real Avalon rule: team-vote ballots are not secret) via
   `game:avalon-team-vote-result`, listing every player's vote.
   - Majority approve → `quest`.
   - Majority reject or tie → `rejectionCount += 1`, leader rotates, back to
     `team-proposal` automatically (no host gate — keeps pace brisk). On the
     5th straight rejection → `game-over`, Evil wins.
4. **`quest`** — only the proposed team secretly submits pass/fail via
   `player:avalon-quest-vote`. The server rejects a `fail` vote from a Good
   player outright (this is the actual security boundary, not just a UI
   restriction). Once every team member has voted, resolve against the
   fail-threshold table above, broadcast `game:avalon-quest-result` with the
   pass/fail outcome only — individual ballots are never revealed, matching
   the real game.
   - 3rd failed quest → `game-over`, Evil wins.
   - 3rd successful quest → straight to `assassin` (no host gate; the
     Assassin has to act).
   - Otherwise → `rejectionCount` resets to 0, leader rotates, host clicks
     **Next Quest** (reuses the existing `host:next-round` event) → back to
     `team-proposal`.
5. **`assassin`** — the Assassin privately picks a target via
   `player:avalon-assassin-guess`. Target is Merlin → Evil wins; otherwise
   Good wins. → `game-over`.
6. **`game-over`** — final-results screen (reused pattern), extended with a
   full role reveal (see §4).

## 3. Server module (`games/avalon.js`)

Single file, following `slipUp.js`'s shape — module-level constants, plain
helper functions, and socket-facing handlers all together (no separate
`avalonLogic.js`):

- `meta` — `{ id: "avalon", name: "Avalon", minPlayers: 5, maxPlayers: 10, supportedModes: ["multiplayer"] }`, registered in `games/registry.js`.
- `ROLE_TABLE` — the player-count → `{ evilCount, teamSizes, doubleFailQuestIndex }` table from §1, as a module-level constant.
- Pure helpers (plain functions, unit-testable via `require` even though they live in this file): `assignRoles(playerIds)`, `computeKnowledge(roles)`, `tallyTeamVote(votes)`, `resolveQuest(votes, doubleFailRequired)`, `checkWinCondition(gameState)`.
- `onHostBeginQuests(room, io)` — only valid from `role-reveal`, picks the first leader, starts quest 1.
- `onProposeTeam(room, io, socketId, teamPlayerIds)` — validates leader + team size, starts the vote.
- `onTeamVote(room, io, socketId, approve)` — records vote, resolves once complete.
- `onQuestVote(room, io, socketId, success)` — validates the voter is on the current team and (for `success: false`) is Evil; resolves once the team is complete.
- `onAssassinGuess(room, io, socketId, targetId)` — validates the voter is the Assassin; resolves the game.
- `onPlayerLeft(room, io, socketId)` — per the earlier decision: any disconnect once `role-reveal` has started ends the game immediately with an "interrupted" result (Avalon's balance depends on the exact original headcount and fixed roles, so there's no honest way to keep going short a player).

## 4. Client UI

**Host** — one status/waiting screen per phase (host never has a role or a
seat):
- `role-reveal`: "Players are viewing their secret roles" + **Begin Quests**.
- `team-proposal`: "Waiting for **{leader}** to propose a team of {N}."
- `team-vote`: live vote-in counter, then the public per-player result.
- `quest`: "Team is on a secret mission..." submitted/pending counter.
- `quest-result`: pass/fail outcome + a running quest-track (e.g. ✓✓✗○○ pips)
  + **Next Quest** button (hidden once the game is decided).
- `assassin`: "The Assassin is deciding Merlin's fate..."
- `game-over`: reused final-results screen, extended with a full role-reveal
  list (nickname → role, for every player).

**Player** — new screens alongside the existing ones:
- `screen-role-reveal` — role name, faction, and faction-specific knowledge
  per §1 (Merlin's evil list, Percival's randomized pair, Evil's roster, or
  nothing extra for Loyal Servants). A "Got it" tap is just an
  acknowledgment; the room only advances once the host clicks Begin Quests.
- `screen-team-proposal` — leader gets a tap-to-select roster (exactly N,
  submit disabled otherwise); everyone else sees a waiting screen naming the
  leader.
- `screen-team-vote` — shows the proposed team, Approve/Reject buttons, then
  the public per-player result.
- `screen-quest` — team members get Pass/Fail buttons (Fail enabled
  client-side only for Evil roles, as a courtesy — the server is the real
  boundary); non-team members see a waiting screen.
- `screen-assassin-guess` — Assassin only: tap-to-select target + confirm;
  everyone else waits.
- Final results screen (shared component) extended with the role-reveal list.

## 5. Testing plan

1. **Unit** (`avalon.test.js`, exercising the pure helpers directly via
   `require`): team-size/evil-count table lookup for all of 5–10 players;
   role assignment produces correct role counts and correct Merlin/Percival
   knowledge; vote tally (majority approve/reject, ties reject); quest
   resolution including the quest-4 double-fail rule at 7+ players; a forged
   `fail` vote from a Good player is rejected server-side; all four
   win-condition paths (3 fails, 3 successes + wrong Assassin guess, 3
   successes + correct Assassin guess, 5 straight rejections).
2. **E2E** (`e2e-avalon.js`, `socket.io-client`, following
   `e2e-word-wolf.js`'s pattern): a full game reaching a Good win (3
   successes, Assassin guesses wrong); Evil win via 3 failed quests; Evil win
   via 5 straight team rejections; Evil win via a correct Assassin guess.
3. **Manual walkthrough**: read the role-reveal screen on a real phone to
   confirm it never leaks Evil identities to Good players — a text-level
   info leak here is silent and won't be caught by unit tests — and confirm
   Percival's two names actually randomize order across repeated runs.

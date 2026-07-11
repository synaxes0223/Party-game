# Avalon — New Game

## Context

The Resistance: Avalon — hidden-role social deduction, Good vs Evil, played over a
sequence of team-proposal/vote/quest rounds until one side reaches 3 quest
results, a 5th consecutive team-proposal is rejected, or (if Good wins 3
quests) the Assassin correctly names Merlin. This is the platform's most
mechanically complex game to date: multiple phases per round, role-specific
private information, an inter-quest side-mechanic (Lady of the Lake), and a
one-shot endgame twist. It reuses the reconnect capability built for Secret
Mission Bingo (`docs/superpowers/specs/2026-07-12-secret-mission-bingo-design.md`)
rather than inventing a second one, and otherwise follows the same
`server/games/*.js` module + host/player screen pattern as every other game.

Full official rules are supported: the complete 5–10 player range, the full
role roster (Percival/Morgana/Mordred/Oberon), and Lady of the Lake for 7+
players. The host configures which optional roles are active per game via a
toggle screen before dealing.

## 1. Roles & compatibility

**Role pool:**

| Team | Roles |
|---|---|
| Good | Merlin, Percival, Loyal Servant of Arthur (fills remaining good slots) |
| Evil | Mordred, Morgana, Oberon, Assassin (always present whenever any evil special role is toggled on), Minion of Mordred (fills remaining evil slots) |

**Good/Evil split by player count** (official table — `AVALON_PLAYER_COUNTS` in the logic module):

| Players | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|
| Good | 3 | 4 | 4 | 5 | 6 | 6 |
| Evil | 2 | 2 | 3 | 3 | 3 | 4 |

**Compatibility validation** (run when the host clicks "Start Game" — reject with a specific error, never silently drop a toggle):
- Percival on → Merlin must effectively exist (Merlin is always in play whenever there are any good special roles at all — Merlin is not itself a toggle, it's the baseline good special role, always present).
- Morgana on → requires Percival to be meaningful, but Morgana's own precondition is just "Merlin exists" (always true). Document explicitly: toggling Morgana on with Percival off is legal (Morgana just does nothing without Percival to confuse) but the host UI should discourage it with a hint, not block it.
- Mordred on → no additional requirement beyond Merlin existing (always true).
- Lady of the Lake on → requires playerCount >= 7; UI disables the toggle below that instead of erroring at start time.
- Evil special roles (Mordred/Morgana/Oberon) + Assassin + Minions must not exceed the evil headcount for the player count; Assassin always consumes one evil slot when any evil special role is toggled on, or even with none toggled (Assassin is the baseline evil special role, always present, mirroring Merlin).

**Private info dealt at role-reveal** (each player gets exactly one `game:avalon-role-reveal` payload, shaped only for their own role):

| Role | Sees |
|---|---|
| Merlin | Every evil player's identity, **except Mordred** if Mordred is in play |
| Percival | Merlin and Morgana's identities together, shuffled/unlabeled (if Morgana is off, just sees Merlin plainly) |
| Loyal Servant | Nothing extra |
| Mordred, Morgana, Minion of Mordred, Assassin | Every other evil player's identity and role, **except Oberon** |
| Oberon | Nothing extra (evil, but isolated from the other evils) |

## 2. Round structure

**Leader rotation:** a fixed order is shuffled once at game start from the room's player list; leader advances one position every time a proposal is voted on (approved or rejected) — never mid-proposal.

**Quest team sizes** (official table; `*` marks the one case needing 2 fails instead of 1):

| Players | Q1 | Q2 | Q3 | Q4 | Q5 |
|---|---|---|---|---|---|
| 5 | 2 | 3 | 2 | 3 | 3 |
| 6 | 2 | 3 | 4 | 3 | 4 |
| 7 | 2 | 3 | 3 | 4* | 4 |
| 8 | 3 | 4 | 4 | 5* | 5 |
| 9 | 3 | 4 | 4 | 5* | 5 |
| 10 | 3 | 4 | 4 | 5* | 5 |

**Phase loop per quest:**

1. **Team building (host-driven)** — host screen shows the current leader and required team size; host taps players on the shared screen (as the leader calls names out loud) to build the proposed team, then clicks "Propose Team." No per-player phone action here.
2. **Vote** — every player votes Approve/Reject privately on their phone (`player:avalon-vote`). Once all active players have voted, the **individual votes are revealed by name** (this is deliberate deduction information in real Avalon, not a leak) via `game:avalon-vote-result`.
   - Rejected → reject counter increments (game-wide, not per-quest). At **5 consecutive rejects, Evil wins immediately** — no quest needed. Otherwise leader rotates and a new proposal begins for the same quest.
   - Approved → reject counter resets to 0; proceed to the quest.
3. **Quest** — only the approved team gets a private Success/Fail choice (`player:avalon-quest-card`); Good players are only offered Success (the client doesn't even render a Fail button for them — this is enforced server-side too, not just hidden client-side). Once all team members submit, the host reveals only the **aggregate fail count**, never who played what.
4. **Quest resolution** — record success/fail for that quest number (remembering the "2 fails needed" rule on the marked quest). The moment either side reaches **3 quest results**, stop — remaining quests are never played. Evil reaching 3 fails ends the game immediately (Evil wins). Good reaching 3 successes moves to Lady of the Lake wrap-up (if pending) and then the Assassination endgame, below.

**Force Resolve (host escape hatch, mirrors "Start Guessing Now" elsewhere on this platform):** available during an in-progress vote or quest-card collection. Fills any still-missing vote with Reject and any still-missing quest card with Success, then resolves immediately. This exists purely for a genuinely stuck/gone player, not normal play — label it accordingly in the UI.

## 3. Lady of the Lake

Only offered as a host toggle when the room has 7+ players; disabled (not just hidden) below that.

- A random player starts holding the token, assigned at game start.
- After quests **2, 3, and 4 only** (never quest 1 or 5, and not at all if the game already ended before reaching that quest), the current holder privately picks any other player **who has not yet held the token** via `player:avalon-lady-of-lake-check`.
- The server resolves and sends **only that holder** the target's Good/Evil alignment — never their specific role (`game:avalon-lady-of-lake-result`). A check on Oberon still just says "Evil."
- The token then passes to the just-checked player for next time; broadcast `game:avalon-lady-of-lake-passed` so the host screen can show the current holder (never the result).

## 4. Assassination endgame

Triggers only when Good reaches 3 quest successes (and after any pending Lady of the Lake check for that quest number has resolved, so as not to skip it).

- Host screen announces the twist; the **Assassin** privately picks who they believe is Merlin (`player:avalon-assassinate`), from the full roster.
- Correct guess → **Evil wins** despite the 3 good quests. Wrong guess → **Good wins**.
- Either way, `game:avalon-results` carries every player's full role for the final reveal screen — the payoff moment regardless of outcome.

## 5. Reconnect

`meta.supportsReconnect = true`, reusing `roomService`'s existing `markDisconnected` / nickname-reclaim `joinRoom` path and the `onPlayerReconnected` hook (see the Secret Mission Bingo spec and its implementation for the platform-level mechanism — no new plumbing needed here). `index.js`'s join-room handler already re-sends `room:game-selected` to a rejoining socket (fixed during Secret Mission Bingo's browser verification), so this game gets that for free too.

`onPlayerReconnected(room, io, oldSocketId, newSocketId)` re-keys: the role assignment map, the leader-rotation array entry, the current vote-in-progress (if the reconnecting player had already voted, keep their vote; if not, they're still expected to), the current quest-card-in-progress state, and Lady of the Lake's holder/already-checked-list. Then re-sends whatever screen is currently pending on that player (their role reveal is re-sent identically — it's static for the whole game — plus the current vote/quest-card/Lady-of-the-Lake/assassin prompt if one is outstanding for them specifically).

A disconnected leader does **not** block team-building, since the host (not the leader's phone) submits proposals — the host just keeps building on their behalf regardless of connection state. Disconnection only actually blocks the game at the vote and quest-card steps, which is exactly what Force Resolve (§2) is for.

## 6. Host & player screens

**Host:**
- Role-configuration screen: toggles for Percival / Morgana / Mordred / Oberon / Lady of the Lake (auto-disabled below 7 players), player-count-derived good/evil split shown live, "Start Game" button (disabled with a specific reason on an invalid combination or wrong player count).
- Live game screen: quest track (success/fail pip per quest, with a "2 fails needed" marker on the relevant quest), current leader name, tap-grid for team building, reject-streak counter, vote tally by name once revealed, Lady of the Lake current holder.
- Assassination screen: "Good won 3 quests — Evil's last chance" + waiting state while the Assassin decides.
- Final results screen: full role reveal for every player, win reason (quests / 5 rejects / assassination), win side.

**Player:**
- One-time role-reveal screen: role name + whatever private roster info that role grants (§1), with a "Got it" dismissal — not re-shown automatically afterward except on reconnect.
- Vote screen (Approve/Reject) whenever a proposal is pending on them.
- Quest-card screen (Success only if Good; Success/Fail if Evil) when they're on an approved team.
- Lady of the Lake check screen (pick a target from eligible players) when they hold the token, and a private result screen after checking.
- Assassin's guess screen (full roster) at the endgame, for the Assassin only.
- Final results screen, same content as the host's.

## 7. Data model

```js
room.gameState = {
  phase: "role-config" | "team-building" | "voting" | "questing" | "lady-of-lake" | "assassination" | "game-over",
  config: { percival, morgana, mordred, oberon, ladyOfLake }, // booleans, chosen at role-config time
  roles: new Map(),        // playerId -> { role, team: "good"|"evil" }
  leaderOrder: [],          // playerIds, shuffled once at game start
  leaderIndex: 0,
  rejectCount: 0,           // resets to 0 on any approval
  questNumber: 1,           // 1-5
  questHistory: [],         // [{ questNumber, team, fails, result: "success"|"fail" }]
  proposedTeam: [],         // playerIds, built by the host during team-building
  votes: new Map(),         // playerId -> boolean, cleared each proposal
  questCards: new Map(),    // playerId -> "success"|"fail", cleared each quest
  lotl: {                   // present only if config.ladyOfLake
    holderId: null,
    everHeld: new Set(),
    pendingCheckAfterQuest: null,
  },
  assassinId: null,
  winner: null,             // "good" | "evil"
  winReason: null,          // "quests" | "reject-streak" | "assassination"
};
```

## 8. Testing plan

1. **Unit — role dealing & compatibility** (`avalonRoles.test.js`): good/evil split matches the table for every supported player count; compatibility validation rejects invalid combinations with the right error; Merlin's evil-roster view excludes Mordred when present; Percival's pair is exactly {Merlin, Morgana} unlabeled; Oberon is excluded from other evils' rosters and sees nothing back.
2. **Unit — round logic** (`avalon.test.js`): team-size table lookups per player count including the 2-fails quest; vote resolution and the 5-reject-streak auto-win; quest resolution enforcing Good-can-only-play-Success server-side (not just client-side); early game-end the instant either side reaches 3; Lady of the Lake only offered after quests 2/3/4 and only to players who haven't held the token; assassination resolving both outcomes; Force Resolve defaulting missing votes/cards correctly; `onPlayerReconnected` re-keying every piece of state listed in §7.
3. **Live E2E** (`e2e-avalon.js`): a full 5-player game via `socket.io-client` exercising role-config → several team proposals (including at least one rejection) → quest resolution → either a 3rd successful quest triggering assassination or a 3rd fail — plus a second scenario at 7+ players specifically exercising Lady of the Lake and the 2-fails quest, and a third scenario covering the disconnect/reconnect path mid-vote.
4. **Real browser playtest** — following the lesson from Secret Mission Bingo's browser verification (which caught a bug no socket-level E2E test did), drive a full game through actual host/player pages before calling this done, with particular attention to the reconnect path and to confirming Good players genuinely cannot submit a Fail card client-side.

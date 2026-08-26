# Durable Sessions — execution handoff

Session halted mid-execution on 2026-08-27 (API spend limit). This file carries
the state that would otherwise have been lost: the SDD workspace at
`.superpowers/sdd/2026-08-27-durable-sessions/` is git-ignored and does **not**
travel with the repo.

Plan: `docs/superpowers/plans/2026-08-27-durable-sessions.md`
Spec: `docs/superpowers/specs/2026-08-27-blood-on-the-clocktower-design.md` §2
Branch: `feat/android-hosting-and-botc-spec`
Method: `superpowers:subagent-driven-development` (fresh implementer per task,
independent review after each, fix loop capped at five rounds)

## Where execution stopped

| Task | State | Commit |
| --- | --- | --- |
| 1 — Token validation module | complete, review clean (1 fix round) | `2047026`, `485c939` |
| 2 — Re-key players by token | complete, review clean (1 fix round, report-only) | `222c3bd` |
| 3 — Host reconnection | complete, review clean (no fix rounds) | `73304d8` |
| 4 — Abandoned-room sweeper | **committed but UNREVIEWED** | `e5267d8` |
| 5–11 | not started | — |

**Resume at:** re-dispatch the Task 4 review against `73304d8..e5267d8`. Its
reviewer was dispatched but died on the spend limit without returning a verdict,
so `e5267d8` has never been checked by anything other than its own author. Do
not start Task 5 until that review lands.

Test state at the halt: **170/170 unit tests passing** (146 at branch start,
plus 9 from Task 1, 9 from Task 2, 3 from Task 3, 3 from Task 4).

The six end-to-end scripts are **red on purpose** — see Ruling 2 below. They stay
red until Tasks 5 and 6 land.

## Rebuilding the workspace on the other machine

Briefs and review diffs are regenerable; only this file's content was not.

```bash
SDD=~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development
bash "$SDD/scripts/sdd-workspace" docs/superpowers/plans/2026-08-27-durable-sessions.md
for n in 4 5 6 7 8 9 10 11; do
  bash "$SDD/scripts/task-brief" docs/superpowers/plans/2026-08-27-durable-sessions.md $n
done
bash "$SDD/scripts/review-package" docs/superpowers/plans/2026-08-27-durable-sessions.md 73304d8 e5267d8
```

Then recreate the ledger with this file's "Rulings in force" section pasted into
it, first line `# SDD ledger — plan: docs/superpowers/plans/2026-08-27-durable-sessions.md`.

The implementer reports for Tasks 1–4 are lost with the workspace. That costs
nothing going forward: their content is superseded by the committed code and by
the review verdicts recorded above.

## Rulings in force

These were decided during execution and bind the remaining tasks. They are not
in the plan file — the plan is wrong in the places they correct.

**Ruling 1 — unit tests use per-test unique tokens.** The plan's test code for
Tasks 2–4 shares constants (`TOKEN_A`, `HOST`). `rooms` is a module-level `Map`
never reset between tests, and `markPlayerDisconnected` / `markHostDisconnected` /
`sweepAbandonedRooms` scan *every* room, so shared tokens make one test mutate a
room left behind by an earlier one. `test/roomService.test.js` now has a
`freshTokens()` counter helper; every test calls it. Already applied in Tasks
2–4. *Cost if wrong: slightly more verbose tests.*

**Ruling 2 — `index.js` stays broken from Task 2 until Task 5.** It still calls
`removePlayer` and `removeRoomIfEmpty`, both removed. Patching it early collides
with Task 5. Task 2/3/4 verification is scoped to unit tests only. *Cost if
wrong: a window of commits where the server cannot handle a disconnect; nothing
is deployed mid-plan.*

**Ruling 3 — Task 6 is much larger than the plan states.** The plan says "if the
e2e scripts fail, add a token." They fail deterministically, and worse: `socket.id`
is used as a *player identifier* 46 times across four e2e scripts —
`e2e-avalon.js` (11), `e2e-rounds.js` (16), `e2e-slip-up.js` (8),
`e2e-word-wolf.js` (11). Every one must become that client's token. Task 6 is
therefore: rename `hostSocketId` → `hostId` at 10 sites in `games/`
(`findTheImposter.js:94,137,143,231,295,326`, `slipUp.js:46`,
`wordWolf.js:70,132,198`), **and** retrofit all six e2e scripts. *Cost if wrong:
Task 6 outgrows one review surface — if so, split the e2e retrofit into its own
follow-up task rather than weakening assertions.*

**Ruling 4 — Tasks 7 and 10 name events that do not exist.** The plan's
`test/e2e-reconnect.js` emits `host:word-wolf-start`, awaits `game:started`, and
asserts `game:your-word`. None exist. Corrections:
- Start a Word Wolf round with `host:select-game` then `host:select-auto-pair`.
- The private word arrives on `game:reveal-word` (`wordWolf.js:110`), fired by
  `host:reveal-words`.
- Task 10's `onPlayerRejoined` for Word Wolf re-sends via
  `getWordForPlayer(gs, playerId)`, not the invented `state.words`.

*Cost if wrong: the e2e script hangs on an event that never fires, costing a fix
round.*

**Ruling 5 (Task 1) — boundary assertions were added beyond the plan's test
code.** The token format `^[A-Za-z0-9_-]{8,64}$` is a binding global constraint,
so 8 and 64 are spec-significant. The plan's tests used 36/16/6/65 only, meaning
a `{9,64}` or `{8,63}` typo would have passed undetected. Tests for exactly 7, 8
and 64 characters were added. *Cost if wrong: three redundant assertions.*

## Deferred minor findings

Carry these into the final whole-branch review; none block progress.

- Task 1: underscore `_` acceptance is never exercised directly — only hyphen is,
  via the UUID case.
- Task 3: no test covers `markHostDisconnected` returning `null` for an unmatched
  `hostId`, or `reclaimHost` returning `null` for a nonexistent room code. Both
  are handled correctly in the implementation, just unexercised.

## Known breakage at the halt (all expected)

`index.js` and the three game modules still reference identifiers that no longer
exist. Nothing here is a defect to fix out of order — Tasks 5 and 6 close all of
it:

- `index.js` calls the removed `removePlayer` and `removeRoomIfEmpty`, and reads
  `room.hostSocketId` for host authorisation.
- `games/findTheImposter.js`, `games/slipUp.js`, `games/wordWolf.js` read
  `room.hostSocketId` at 10 sites; rooms now carry `hostId`, so those
  host-directed emits currently resolve to `undefined` and go nowhere.

const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../games/slipUp");

function makeStubIo() {
  const emitted = [];
  const target = (kind) => (id) => ({
    emit: (event, payload) => emitted.push({ kind, id, event, payload }),
  });
  return { io: { to: target("to"), in: target("in") }, emitted };
}

function makeRoom(nicknames) {
  const players = new Map();
  nicknames.forEach((name, i) => players.set(`p${i + 1}`, { id: `p${i + 1}`, nickname: name, ready: false }));
  return {
    code: "TEST",
    hostId: "host1",
    state: "lobby",
    players,
    gameId: "slip-up",
    gameState: null,
  };
}

test("meta has the expected shape", () => {
  assert.equal(game.meta.id, "slip-up");
  assert.equal(game.meta.name, "Slip-Up");
  assert.equal(game.meta.minPlayers, 3);
  assert.equal(game.meta.maxPlayers, 16);
});

test("getEntryPool returns a non-empty array of entries", () => {
  const pool = game.getEntryPool();
  assert.ok(Array.isArray(pool));
  assert.ok(pool.length > 0);
});

test("onStartGame errors when there are fewer than minPlayers active players", () => {
  const room = makeRoom(["Alice", "Bob"]);
  const { io } = makeStubIo();
  const result = game.onStartGame(room, io, { excludedIds: [], customEntries: [] });
  assert.match(result.error, /at least 3 players/);
});

test("onStartGame errors when the resulting pool is smaller than the player count", () => {
  const room = makeRoom(["Alice", "Bob", "Carol"]);
  const { io } = makeStubIo();
  const allIds = game.getEntryPool().map((e) => e.id);
  const result = game.onStartGame(room, io, { excludedIds: allIds, customEntries: [] });
  assert.match(result.error, /Need at least 3 entries/);
});

test("onStartGame deals distinct entries and broadcasts personalized your-view, referee-view, and score-update", () => {
  const room = makeRoom(["Alice", "Bob", "Carol"]);
  const { io, emitted } = makeStubIo();
  const result = game.onStartGame(room, io, { excludedIds: [], customEntries: [] });
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "active");
  assert.equal(room.gameState.assignments.size, 3);

  const yourViews = emitted.filter((e) => e.event === "game:your-view");
  assert.equal(yourViews.length, 3);
  yourViews.forEach((e) => {
    assert.equal(e.kind, "to");
    const myAssignment = room.gameState.assignments.get(e.id);
    const leaked = e.payload.others.some((o) => o.entry.id === myAssignment.id && o.id === e.id);
    assert.equal(leaked, false);
    assert.equal(e.payload.others.length, 2);
  });

  const refereeView = emitted.find((e) => e.event === "game:referee-view");
  assert.equal(refereeView.id, "host1");
  assert.equal(refereeView.payload.players.length, 3);

  const scoreUpdate = emitted.find((e) => e.event === "game:score-update");
  assert.ok(scoreUpdate.payload.scores.every((s) => s.catchCount === 0));
});

test("onMarkCaught increments the target's catch count and reassigns without colliding with others", () => {
  const room = makeRoom(["Alice", "Bob", "Carol"]);
  const { io } = makeStubIo();
  game.onStartGame(room, io, { excludedIds: [], customEntries: [] });

  const { io: io2, emitted: emitted2 } = makeStubIo();
  const result = game.onMarkCaught(room, io2, { targetPlayerId: "p1" });
  assert.deepEqual(result, {});
  assert.equal(room.gameState.catchCounts.get("p1"), 1);

  const othersEntries = ["p2", "p3"].map((pid) => room.gameState.assignments.get(pid).id);
  const p1Entry = room.gameState.assignments.get("p1").id;
  assert.ok(!othersEntries.includes(p1Entry));

  const caughtNotice = emitted2.find((e) => e.event === "game:you-were-caught");
  assert.equal(caughtNotice.kind, "to");
  assert.equal(caughtNotice.id, "p1");
});

test("onMarkCaught errors when the game has not started", () => {
  const room = makeRoom(["Alice", "Bob", "Carol"]);
  const { io } = makeStubIo();
  const result = game.onMarkCaught(room, io, { targetPlayerId: "p1" });
  assert.match(result.error, /not active/);
});

test("onMarkCaught errors for an unknown targetPlayerId", () => {
  const room = makeRoom(["Alice", "Bob", "Carol"]);
  const { io } = makeStubIo();
  game.onStartGame(room, io, { excludedIds: [], customEntries: [] });
  const result = game.onMarkCaught(room, io, { targetPlayerId: "ghost" });
  assert.match(result.error, /not found/);
});

test("onEndGame sets phase to ended and broadcasts results sorted ascending by catchCount", () => {
  const room = makeRoom(["Alice", "Bob", "Carol"]);
  const { io } = makeStubIo();
  game.onStartGame(room, io, { excludedIds: [], customEntries: [] });
  game.onMarkCaught(room, io, { targetPlayerId: "p1" });
  game.onMarkCaught(room, io, { targetPlayerId: "p1" });

  const { io: io2, emitted: emitted2 } = makeStubIo();
  const result = game.onEndGame(room, io2);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "ended");

  const finalResults = emitted2.find((e) => e.event === "game:final-results");
  const counts = finalResults.payload.results.map((r) => r.catchCount);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
  assert.equal(finalResults.payload.results[finalResults.payload.results.length - 1].id, "p1");
});

test("onPlayerLeft removes the departing player from assignments and catchCounts", () => {
  const room = makeRoom(["Alice", "Bob", "Carol"]);
  const { io } = makeStubIo();
  game.onStartGame(room, io, { excludedIds: [], customEntries: [] });

  room.players.delete("p3");
  const { io: io2 } = makeStubIo();
  game.onPlayerLeft(room, io2, "p3");

  assert.equal(room.gameState.assignments.has("p3"), false);
  assert.equal(room.gameState.catchCounts.has("p3"), false);
});

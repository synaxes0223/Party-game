const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../games/passTheBomb");

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
  return { code: "TEST", hostSocketId: "host1", state: "lobby", players, gameId: "pass-the-bomb", gameState: null };
}

function setup(nicknames) {
  const room = makeRoom(nicknames);
  game.initGameState(room);
  return room;
}

test("getFuseRangeMs respects BOMB_FUSE_MS_RANGE override", () => {
  const original = process.env.BOMB_FUSE_MS_RANGE;
  process.env.BOMB_FUSE_MS_RANGE = "10,20";
  assert.deepEqual(game.getFuseRangeMs(), [10, 20]);
  process.env.BOMB_FUSE_MS_RANGE = "not,valid";
  assert.deepEqual(game.getFuseRangeMs(), [20000, 50000]);
  if (original === undefined) delete process.env.BOMB_FUSE_MS_RANGE;
  else process.env.BOMB_FUSE_MS_RANGE = original;
});

test("onDrawPrompt builds the ring once and starts a ticking round", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.BOMB_FUSE_MS_RANGE = "1000,1000";
  const room = setup(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();

  const result = game.onDrawPrompt(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "ticking");
  assert.equal(room.gameState.ring.length, 3);
  assert.equal(room.gameState.booms.size, 3);

  const startedEvent = emitted.find((e) => e.event === "game:bomb-started");
  assert.equal(startedEvent.payload.ring.length, 3);
  assert.ok(startedEvent.payload.holderId);
  delete process.env.BOMB_FUSE_MS_RANGE;
});

test("onPassBomb only accepted from the current holder and advances to the next active player", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.BOMB_FUSE_MS_RANGE = "100000,100000";
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onDrawPrompt(room, io);

  const gs = room.gameState;
  const holderId = gs.ring[gs.holderIndex];
  const notHolder = gs.ring.find((id) => id !== holderId);

  const { io: io2, emitted } = makeStubIo();
  game.onPassBomb(room, io2, notHolder);
  assert.equal(gs.ring[gs.holderIndex], holderId, "a non-holder's pass must be ignored");
  assert.equal(emitted.length, 0);

  const { io: io3, emitted: emitted3 } = makeStubIo();
  game.onPassBomb(room, io3, holderId);
  assert.notEqual(gs.ring[gs.holderIndex], holderId, "the holder's pass must advance the bomb");
  assert.ok(emitted3.some((e) => e.event === "game:bomb-passed"));
  delete process.env.BOMB_FUSE_MS_RANGE;
});

test("the fuse expiring assigns a boom to whoever is holding it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.BOMB_FUSE_MS_RANGE = "50,50";
  const room = setup(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  game.onDrawPrompt(room, io);

  const gs = room.gameState;
  const holderId = gs.ring[gs.holderIndex];

  t.mock.timers.tick(50);

  assert.equal(gs.phase, "boom");
  const explodedEvent = emitted.find((e) => e.event === "game:bomb-exploded");
  assert.equal(explodedEvent.payload.holderId, holderId);
  assert.equal(gs.booms.get(holderId).count, 1);
  delete process.env.BOMB_FUSE_MS_RANGE;
});

test("onNextRound only valid from boom phase; onEndGame reports min-boom winners", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.BOMB_FUSE_MS_RANGE = "10,10";
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onDrawPrompt(room, io);

  const tooEarly = game.onNextRound(room, io);
  assert.ok(tooEarly.error);

  t.mock.timers.tick(10);
  assert.equal(room.gameState.phase, "boom");

  const { io: io2, emitted } = makeStubIo();
  const result = game.onNextRound(room, io2);
  assert.deepEqual(result, {});
  assert.ok(emitted.some((e) => e.event === "game:prompt-select-ready"));

  const { io: io3, emitted: emitted3 } = makeStubIo();
  const end = game.onEndGame(room, io3);
  assert.deepEqual(end, {});
  const resultsEvent = emitted3.find((e) => e.event === "game:results");
  assert.ok(resultsEvent.payload.winners.length >= 1);
  delete process.env.BOMB_FUSE_MS_RANGE;
});

test("onPlayerLeft auto-passes when the disconnecting player is the current holder", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.BOMB_FUSE_MS_RANGE = "100000,100000";
  const room = setup(["A", "B", "C", "D"]);
  const { io } = makeStubIo();
  game.onDrawPrompt(room, io);

  const gs = room.gameState;
  const holderId = gs.ring[gs.holderIndex];
  room.players.delete(holderId);

  const { io: io2, emitted } = makeStubIo();
  const result = game.onPlayerLeft(room, io2, holderId);
  assert.deepEqual(result, {});
  assert.notEqual(gs.ring[gs.holderIndex], holderId);
  assert.ok(emitted.some((e) => e.event === "game:bomb-passed"));
  delete process.env.BOMB_FUSE_MS_RANGE;
});

test("onPlayerLeft ends the game once fewer than 2 active players remain, clearing the timer", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.BOMB_FUSE_MS_RANGE = "100000,100000";
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onDrawPrompt(room, io);

  room.players.delete("p1");
  room.players.delete("p2");
  const { io: io2, emitted } = makeStubIo();
  const result = game.onPlayerLeft(room, io2, "p1");
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "game-over");
  assert.ok(emitted.some((e) => e.event === "game:results"));
  assert.equal(room.gameState.fuseTimeout, null);
  delete process.env.BOMB_FUSE_MS_RANGE;
});

test("onReset clears a pending fuse timer without touching phase", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  process.env.BOMB_FUSE_MS_RANGE = "100000,100000";
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onDrawPrompt(room, io);
  assert.ok(room.gameState.fuseTimeout);

  game.onReset(room);
  // Node's mock timer clearTimeout doesn't null our reference (that's our
  // own job elsewhere) -- what matters is ticking past the fuse duration no
  // longer fires the explosion callback.
  t.mock.timers.tick(100000);
  assert.equal(room.gameState.phase, "ticking", "explode() must not have fired after the timer was cleared");
  delete process.env.BOMB_FUSE_MS_RANGE;
});

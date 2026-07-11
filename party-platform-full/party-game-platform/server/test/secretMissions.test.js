const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../games/secretMissions");

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
  return { code: "TEST", hostSocketId: "host1", state: "lobby", players, gameId: "secret-missions", gameState: null };
}

function setup(nicknames) {
  const room = makeRoom(nicknames);
  game.initGameState(room);
  return room;
}

test("onPromptSubmitted always rejects player submissions", () => {
  const room = setup(["A", "B", "C"]);
  const result = game.onPromptSubmitted(room, {}, "p1", "text");
  assert.ok(result.error);
});

test("onStartMissions deals 3 unique-per-player missions and broadcasts private + public boards", () => {
  const room = setup(["A", "B", "C"]);
  const { io, emitted } = makeStubIo();
  const result = game.onStartMissions(room, io);
  assert.deepEqual(result, {});
  assert.equal(room.gameState.phase, "in-play");
  assert.equal(room.gameState.missions.length, 9);

  ["p1", "p2", "p3"].forEach((id) => {
    const owned = room.gameState.missions.filter((m) => m.ownerId === id);
    assert.equal(owned.length, 3);
    const texts = new Set(owned.map((m) => m.text));
    assert.equal(texts.size, 3, "a player should never receive the same mission text twice");
  });

  const yourMissionsEvents = emitted.filter((e) => e.event === "game:your-missions");
  assert.equal(yourMissionsEvents.length, 3);
  const boardEvent = emitted.find((e) => e.event === "game:mission-board");
  assert.equal(boardEvent.payload.missions.length, 9);
  // Public board must never expose ownerId
  assert.ok(!JSON.stringify(boardEvent.payload.missions).includes("ownerId"));
});

test("onStartMissions rejects starting twice", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onStartMissions(room, io);
  const again = game.onStartMissions(room, io);
  assert.ok(again.error);
});

test("onClaimMission only allows the owner to claim their own open mission, awarding points", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onStartMissions(room, io);
  const gs = room.gameState;
  const mission = gs.missions.find((m) => m.ownerId === "p1");

  const wrongOwner = game.onClaimMission(room, io, "p2", mission.id);
  assert.ok(wrongOwner.error);

  const result = game.onClaimMission(room, io, "p1", mission.id);
  assert.deepEqual(result, {});
  assert.equal(gs.missions.find((m) => m.id === mission.id).status, "claimed");
  assert.equal(gs.scores.get("p1").score, 100);

  const claimAgain = game.onClaimMission(room, io, "p1", mission.id);
  assert.ok(claimAgain.error);
});

test("onAccuse: a hit on an open mission busts it and awards the accuser, no steal", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onStartMissions(room, io);
  const gs = room.gameState;
  const mission = gs.missions.find((m) => m.ownerId === "p2");

  const { io: io2, emitted } = makeStubIo();
  const result = game.onAccuse(room, io2, "p1", "p2", mission.id);
  assert.deepEqual(result, {});
  assert.equal(gs.missions.find((m) => m.id === mission.id).status, "busted");
  assert.equal(gs.scores.get("p1").score, 100);
  assert.equal(gs.accusationsLeft.get("p1"), 2);
  const accusationEvent = emitted.find((e) => e.event === "game:accusation-result");
  assert.equal(accusationEvent.payload.hit, true);
});

test("onAccuse: a hit on an already-claimed mission transfers the points from owner to accuser", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onStartMissions(room, io);
  const gs = room.gameState;
  const mission = gs.missions.find((m) => m.ownerId === "p2");
  game.onClaimMission(room, io, "p2", mission.id);
  assert.equal(gs.scores.get("p2").score, 100);

  game.onAccuse(room, io, "p1", "p2", mission.id);
  assert.equal(gs.scores.get("p2").score, 0);
  assert.equal(gs.scores.get("p1").score, 100);
});

test("onAccuse: a miss costs the accuser 50 points and consumes a budget slot", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onStartMissions(room, io);
  const gs = room.gameState;
  const mission = gs.missions.find((m) => m.ownerId === "p2");

  const result = game.onAccuse(room, io, "p1", "p3", mission.id); // p3 doesn't own it -> miss
  assert.deepEqual(result, {});
  assert.equal(gs.scores.get("p1").score, -50);
  assert.equal(gs.accusationsLeft.get("p1"), 2);
});

test("onAccuse: accusation budget is enforced and self-accusation is rejected", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onStartMissions(room, io);
  const gs = room.gameState;
  const mission = gs.missions.find((m) => m.ownerId === "p2");

  const self = game.onAccuse(room, io, "p1", "p1", mission.id);
  assert.ok(self.error);

  game.onAccuse(room, io, "p1", "p3", mission.id);
  game.onAccuse(room, io, "p1", "p3", mission.id);
  game.onAccuse(room, io, "p1", "p3", mission.id);
  assert.equal(gs.accusationsLeft.get("p1"), 0);
  const outOfBudget = game.onAccuse(room, io, "p1", "p3", mission.id);
  assert.ok(outOfBudget.error);
});

test("onEndGame reveals the full de-anonymized board and reports winners", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onStartMissions(room, io);
  const gs = room.gameState;
  const myMission = gs.missions.find((m) => m.ownerId === "p1");
  game.onClaimMission(room, io, "p1", myMission.id);

  const { io: io2, emitted } = makeStubIo();
  const result = game.onEndGame(room, io2);
  assert.deepEqual(result, {});
  const resultsEvent = emitted.find((e) => e.event === "game:results");
  assert.equal(resultsEvent.payload.reveal.length, 9);
  assert.ok(resultsEvent.payload.reveal.every((m) => m.ownerNickname));
  assert.ok(Array.isArray(resultsEvent.payload.winners) && resultsEvent.payload.winners.length >= 1);
});

test("onPlayerReconnected re-keys mission ownership, score, and accusation budget onto the new socketId", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onStartMissions(room, io);
  const gs = room.gameState;
  const myMission = gs.missions.find((m) => m.ownerId === "p1");
  game.onClaimMission(room, io, "p1", myMission.id);
  game.onAccuse(room, io, "p1", "p3", gs.missions.find((m) => m.ownerId === "p2").id);

  room.players.delete("p1");
  room.players.set("p1-new", { id: "p1-new", nickname: "A", ready: false, connected: true });

  const { io: io2, emitted } = makeStubIo();
  game.onPlayerReconnected(room, io2, "p1", "p1-new");

  assert.equal(gs.missions.filter((m) => m.ownerId === "p1-new").length, 3);
  assert.equal(gs.missions.filter((m) => m.ownerId === "p1").length, 0);
  assert.ok(gs.scores.has("p1-new"));
  assert.ok(!gs.scores.has("p1"));
  assert.ok(gs.accusationsLeft.has("p1-new"));
  assert.ok(!gs.accusationsLeft.has("p1"));

  const yourMissionsEvent = emitted.find((e) => e.event === "game:your-missions" && e.id === "p1-new");
  assert.equal(yourMissionsEvent.payload.missions.length, 3);
});

test("onPlayerSync re-sends private missions and the public board", () => {
  const room = setup(["A", "B", "C"]);
  const { io } = makeStubIo();
  game.onStartMissions(room, io);

  const { io: io2, emitted } = makeStubIo();
  game.onPlayerSync(room, io2, "p1");
  assert.ok(emitted.some((e) => e.event === "game:your-missions" && e.id === "p1"));
  assert.ok(emitted.some((e) => e.event === "game:mission-board" && e.id === "p1"));
});

const test = require("node:test");
const assert = require("node:assert/strict");
const roomService = require("../roomService");

// roomService keeps its `rooms` map at module scope (no per-test reset), so
// every socketId used below must be unique across the whole file -- reusing
// a literal like "p1" in two tests would let removePlayer/markDisconnected/
// findRoomByPlayer (which scan all rooms for a matching socketId) touch the
// wrong room's player entry.

test("joinRoom sets connected: true and rejects unknown nicknames mid-game without allowReconnect", () => {
  const room = roomService.createRoom("host1");
  roomService.joinRoom(room.code, "t1-p1", "Alice");
  assert.equal(room.players.get("t1-p1").connected, true);

  room.state = "in-progress";
  const result = roomService.joinRoom(room.code, "t1-p2", "Bob");
  assert.equal(result.error, "Game already in progress");
});

test("joinRoom rejects mid-game join for an unrecognized nickname even with allowReconnect", () => {
  const room = roomService.createRoom("host2");
  roomService.joinRoom(room.code, "t2-p1", "Alice");
  room.state = "in-progress";

  const result = roomService.joinRoom(room.code, "t2-p2", "Nobody", { allowReconnect: true });
  assert.equal(result.error, "Game already in progress");
});

test("joinRoom reclaims a disconnected player's record onto a new socketId", () => {
  const room = roomService.createRoom("host3");
  roomService.joinRoom(room.code, "t3-p1", "Alice");
  room.state = "in-progress";
  roomService.markDisconnected("t3-p1");
  assert.equal(room.players.get("t3-p1").connected, false);

  const result = roomService.joinRoom(room.code, "t3-p1-new", "alice", { allowReconnect: true });
  assert.equal(result.error, undefined);
  assert.equal(result.reclaimed, true);
  assert.equal(result.oldSocketId, "t3-p1");
  assert.equal(room.players.has("t3-p1"), false);
  const reclaimed = room.players.get("t3-p1-new");
  assert.equal(reclaimed.connected, true);
  assert.equal(reclaimed.id, "t3-p1-new");
  assert.equal(reclaimed.nickname, "Alice");
});

test("joinRoom does not reclaim a still-connected player's record", () => {
  const room = roomService.createRoom("host4");
  roomService.joinRoom(room.code, "t4-p1", "Alice");
  room.state = "in-progress";

  const result = roomService.joinRoom(room.code, "t4-p2", "Alice", { allowReconnect: true });
  assert.equal(result.error, "Game already in progress");
});

test("markDisconnected flags the player without removing them", () => {
  const room = roomService.createRoom("host5");
  roomService.joinRoom(room.code, "t5-p1", "Alice");
  const returnedRoom = roomService.markDisconnected("t5-p1");
  assert.equal(returnedRoom.code, room.code);
  assert.equal(room.players.has("t5-p1"), true);
  assert.equal(room.players.get("t5-p1").connected, false);
});

test("markDisconnected on an unknown socket returns null", () => {
  roomService.createRoom("host6");
  assert.equal(roomService.markDisconnected("t6-no-such-socket"), null);
});

test("findRoomByPlayer locates the room containing a given socketId", () => {
  const room = roomService.createRoom("host7");
  roomService.joinRoom(room.code, "t7-p1", "Alice");
  const found = roomService.findRoomByPlayer("t7-p1");
  assert.equal(found.code, room.code);
  assert.equal(roomService.findRoomByPlayer("t7-nope"), null);
});

test("removePlayer still fully deletes a player (unaffected by reconnect changes)", () => {
  const room = roomService.createRoom("host8");
  roomService.joinRoom(room.code, "t8-p1", "Alice");
  roomService.removePlayer("t8-p1");
  assert.equal(room.players.has("t8-p1"), false);
});

test("publicRoomView reports connected: true by default and false after markDisconnected", () => {
  const room = roomService.createRoom("host9");
  roomService.joinRoom(room.code, "t9-p1", "Alice");
  let view = roomService.publicRoomView(room);
  assert.equal(view.players[0].connected, true);

  roomService.markDisconnected("t9-p1");
  view = roomService.publicRoomView(room);
  assert.equal(view.players[0].connected, false);
});

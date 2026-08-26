const test = require("node:test");
const assert = require("node:assert/strict");
const roomService = require("../roomService");

// Ruling 1: `rooms` inside roomService.js is a module-level Map that is never
// reset between tests, and markPlayerDisconnected scans every room for the
// token. Sharing token constants across tests risks a later test's call
// finding a room left behind by an earlier test. Give every test its own
// unique tokens via a counter so each test only ever touches its own room.
let tokenCounter = 0;
function freshTokens() {
  tokenCounter += 1;
  return {
    host: `hosthosthost${tokenCounter}`,
    a: `tokenaaaaaaaa${tokenCounter}`,
    b: `tokenbbbbbbbb${tokenCounter}`,
  };
}

test("a room is created with the host id and host marked connected", () => {
  const { host: HOST } = freshTokens();
  const room = roomService.createRoom(HOST);
  assert.equal(room.hostId, HOST);
  assert.equal(room.hostConnected, true);
  assert.equal(room.hostDisconnectedAt, null);
});

test("joining stores the player under their token and reports a fresh join", () => {
  const { host: HOST, a: TOKEN_A } = freshTokens();
  const room = roomService.createRoom(HOST);
  const result = roomService.joinRoom(room.code, TOKEN_A, "Alice");
  assert.equal(result.error, undefined);
  assert.equal(result.rejoined, false);
  const player = result.room.players.get(TOKEN_A);
  assert.equal(player.id, TOKEN_A);
  assert.equal(player.nickname, "Alice");
  assert.equal(player.connected, true);
});

test("the same token joining again reclaims the seat rather than duplicating", () => {
  const { host: HOST, a: TOKEN_A } = freshTokens();
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  const again = roomService.joinRoom(room.code, TOKEN_A, "Alice");
  assert.equal(again.rejoined, true);
  assert.equal(again.room.players.size, 1);
});

test("a disconnect in the lobby removes the player outright", () => {
  const { host: HOST, a: TOKEN_A } = freshTokens();
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  const result = roomService.markPlayerDisconnected(TOKEN_A);
  assert.equal(result.removed, true);
  assert.equal(result.room.players.has(TOKEN_A), false);
});

test("a disconnect mid-game keeps the seat and flags it disconnected", () => {
  const { host: HOST, a: TOKEN_A } = freshTokens();
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  room.state = "in-progress";
  const result = roomService.markPlayerDisconnected(TOKEN_A);
  assert.equal(result.removed, false);
  const player = result.room.players.get(TOKEN_A);
  assert.equal(player.connected, false);
  assert.ok(typeof player.disconnectedAt === "number");
});

test("a disconnected player rejoins mid-game and is connected again", () => {
  const { host: HOST, a: TOKEN_A } = freshTokens();
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  room.state = "in-progress";
  roomService.markPlayerDisconnected(TOKEN_A);
  const back = roomService.joinRoom(room.code, TOKEN_A, "Alice");
  assert.equal(back.rejoined, true);
  const player = back.room.players.get(TOKEN_A);
  assert.equal(player.connected, true);
  assert.equal(player.disconnectedAt, null);
});

test("an unknown token still cannot join a game in progress", () => {
  const { host: HOST, b: TOKEN_B } = freshTokens();
  const room = roomService.createRoom(HOST);
  room.state = "in-progress";
  const result = roomService.joinRoom(room.code, TOKEN_B, "Bob");
  assert.equal(result.error, "Game already in progress");
});

test("nickname collisions are still rejected for new players", () => {
  const { host: HOST, a: TOKEN_A, b: TOKEN_B } = freshTokens();
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  const result = roomService.joinRoom(room.code, TOKEN_B, "alice");
  assert.equal(result.error, "Nickname already taken in this room");
});

test("publicRoomView exposes connection state", () => {
  const { host: HOST, a: TOKEN_A } = freshTokens();
  const room = roomService.createRoom(HOST);
  roomService.joinRoom(room.code, TOKEN_A, "Alice");
  const view = roomService.publicRoomView(room);
  assert.equal(view.players[0].id, TOKEN_A);
  assert.equal(view.players[0].connected, true);
});

test("a host disconnect flags the host but keeps the room alive", () => {
  const { host: HOST } = freshTokens();
  const room = roomService.createRoom(HOST);
  const found = roomService.markHostDisconnected(HOST);
  assert.equal(found.code, room.code);
  assert.equal(found.hostConnected, false);
  assert.ok(typeof found.hostDisconnectedAt === "number");
  assert.ok(roomService.getRoom(room.code), "room must still exist");
});

test("the same host token reclaims the room", () => {
  const { host: HOST } = freshTokens();
  const room = roomService.createRoom(HOST);
  roomService.markHostDisconnected(HOST);
  const back = roomService.reclaimHost(room.code, HOST);
  assert.equal(back.code, room.code);
  assert.equal(back.hostConnected, true);
  assert.equal(back.hostDisconnectedAt, null);
});

test("a different token cannot reclaim someone else's room", () => {
  const { host: HOST, b: TOKEN_B } = freshTokens();
  const room = roomService.createRoom(HOST);
  roomService.markHostDisconnected(HOST);
  assert.equal(roomService.reclaimHost(room.code, TOKEN_B), null);
});

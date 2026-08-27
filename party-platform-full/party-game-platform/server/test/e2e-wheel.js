// e2e-wheel.js
// Full-stack punishment-wheel scenario over real sockets: room creation
// seeds the default list, a player join gets the same list, a player add
// broadcasts to everyone, a non-host remove is silently rejected, a host
// remove works, and the list survives host:reset-room. Run with:
//   node test/e2e-wheel.js

const path = require("path");
const { io: ioClient } = require("socket.io-client");

const PORT = 3100;
const URL = `http://localhost:${PORT}`;

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function connect() {
  const socket = ioClient(URL, { transports: ["websocket"] });
  return new Promise((resolve) => socket.once("connect", () => resolve(socket)));
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

let tokenCounter = 0;
function nextToken() {
  return `e2e-wheel-token-${tokenCounter++}`;
}

async function createRoom() {
  const host = await connect();
  const hostToken = nextToken();
  const initialWheelPromise = once(host, "wheel:list-updated");
  host.emit("host:create-room", { token: hostToken });
  const { room } = await once(host, "host:room-created");
  const initialWheel = await initialWheelPromise;
  return { host, hostToken, roomCode: room.code, initialWheel };
}

async function joinPlayer(roomCode, name) {
  const socket = await connect();
  const token = nextToken();
  const wheelPromise = once(socket, "wheel:list-updated");
  socket.emit("player:join-room", { code: roomCode, nickname: name, token });
  await Promise.race([
    once(socket, "player:joined"),
    once(socket, "player:join-error").then((e) => Promise.reject(new Error(e.error))),
  ]);
  const initialWheel = await wheelPromise;
  return { name, socket, token, initialWheel };
}

async function scenarioWheel() {
  const { host, roomCode, initialWheel } = await createRoom();

  assertTrue(initialWheel.items.length === 10, "host should see 10 default items on room creation");
  assertTrue(
    initialWheel.items.every((i) => i.addedBy === "default"),
    "all initial items should be addedBy 'default'"
  );

  const alice = await joinPlayer(roomCode, "Alice");
  const bob = await joinPlayer(roomCode, "Bob");

  assertTrue(alice.initialWheel.items.length === 10, "Alice should see the same 10 default items on join");
  assertTrue(
    JSON.stringify(alice.initialWheel.items.map((i) => i.id).sort()) ===
      JSON.stringify(initialWheel.items.map((i) => i.id).sort()),
    "Alice's initial item ids should match the host's"
  );

  // Alice (a player) submits a new punishment; host and Bob (the other
  // player) should both see the broadcast.
  const hostAfterAliceAdd = once(host, "wheel:list-updated");
  const bobAfterAliceAdd = once(bob.socket, "wheel:list-updated");
  alice.socket.emit("wheel:add-punishment", { code: roomCode, text: "  Do a cartwheel  " });
  const [afterAliceAddHost, afterAliceAddBob] = await Promise.all([hostAfterAliceAdd, bobAfterAliceAdd]);

  assertTrue(afterAliceAddHost.items.length === 11, "host should see 11 items after Alice's add");
  assertTrue(afterAliceAddBob.items.length === 11, "Bob should see 11 items after Alice's add");
  const aliceItem = afterAliceAddHost.items.find((i) => i.text === "Do a cartwheel");
  assertTrue(aliceItem, "Alice's item text should be trimmed and present");
  assertTrue(aliceItem.addedBy === "player" && aliceItem.nickname === "Alice", "Alice's item should be attributed to her");

  // Host submits empty text: should get wheel:add-error, no broadcast.
  const addErrorPromise = once(host, "wheel:add-error");
  host.emit("wheel:add-punishment", { code: roomCode, text: "   " });
  const addError = await addErrorPromise;
  assertTrue(/required/i.test(addError.error), "empty text should produce a 'required' error");

  // Bob (non-host) tries to remove Alice's item: must be silently rejected.
  // Verify by having the host add a distinguishable item afterward and
  // confirming the count only grew by 1 (Bob's removal did nothing) and
  // Alice's item is still present.
  const hostAfterHostAdd = once(host, "wheel:list-updated");
  bob.socket.emit("wheel:remove-punishment", { code: roomCode, id: aliceItem.id });
  host.emit("wheel:add-punishment", { code: roomCode, text: "Host-added marker" });
  const afterHostAdd = await hostAfterHostAdd;
  assertTrue(afterHostAdd.items.length === 12, "count should be 12 (Bob's remove was a no-op, host's add landed)");
  assertTrue(
    afterHostAdd.items.some((i) => i.id === aliceItem.id),
    "Alice's item should still be present after Bob's rejected removal"
  );

  // Host removes Alice's item: should succeed.
  const hostAfterRemove = once(host, "wheel:list-updated");
  host.emit("wheel:remove-punishment", { code: roomCode, id: aliceItem.id });
  const afterRemove = await hostAfterRemove;
  assertTrue(afterRemove.items.length === 11, "count should drop to 11 after host's valid removal");
  assertTrue(
    !afterRemove.items.some((i) => i.id === aliceItem.id),
    "Alice's item should be gone after host's removal"
  );

  // host:reset-room must NOT touch the wheel: a fresh join afterward should
  // still see the post-removal 11 items, not reset back to the 10 defaults.
  host.emit("host:reset-room", { code: roomCode });
  const carol = await joinPlayer(roomCode, "Carol");
  assertTrue(carol.initialWheel.items.length === 11, "wheel items should survive host:reset-room");

  host.close();
  [alice, bob, carol].forEach((p) => p.socket.close());
  console.log("scenarioWheel passed");
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    await scenarioWheel();
    console.log("All Wheel E2E scenarios passed.");
    process.exit(0);
  } catch (err) {
    console.error("Wheel E2E FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

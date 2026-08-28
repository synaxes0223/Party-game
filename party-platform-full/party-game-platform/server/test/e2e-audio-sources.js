// test/e2e-audio-sources.js
// Live integration check for the YouTube and uploaded-file audio sources:
// runs the real server in-process and drives both paths through
// socket.io-client and the real HTTP upload endpoint (no mocks).
// Run with: node test/e2e-audio-sources.js

const path = require("node:path");
const { io } = require("socket.io-client");

const PORT = 3098;
const URL = `http://localhost:${PORT}`;

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

function connect() {
  return new Promise((resolve) => {
    const s = io(URL);
    s.on("connect", () => resolve(s));
  });
}

let tokenCounter = 0;
function nextToken() {
  return `e2e-audio-sources-token-${tokenCounter++}`;
}

async function createRoom() {
  const host = await connect();
  const hostToken = nextToken();
  const created = await new Promise((resolve) => {
    host.once("host:room-created", resolve);
    host.emit("host:create-room", { token: hostToken });
  });
  return { host, hostToken, roomCode: created.room.code };
}

async function joinPlayers(roomCode, names) {
  const players = [];
  for (const name of names) {
    const socket = await connect();
    const token = nextToken();
    await new Promise((resolve, reject) => {
      socket.once("player:joined", () => resolve());
      socket.once("player:join-error", (d) => reject(new Error(d.error)));
      socket.emit("player:join-room", { code: roomCode, nickname: name, token });
    });
    players.push({ name, socket, token });
  }
  return players;
}

async function selectGame(host, roomCode) {
  const pairsPromise = once(host, "game:track-pairs");
  host.emit("host:select-game", { code: roomCode, gameId: "find-the-imposter" });
  await pairsPromise;
}

function assertTrue(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

async function uploadFixtureFile(filename) {
  const form = new FormData();
  form.append("audio", new Blob([`fake audio bytes for ${filename}`], { type: "audio/mpeg" }), filename);
  const res = await fetch(`${URL}/api/upload-audio`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) throw new Error(`Upload of ${filename} failed: ${data.error}`);
  return data;
}

async function scenario_uploadPair() {
  console.log("\n[Scenario 1] upload-pair round: explicit normal + imposter files");
  const fileA = await uploadFixtureFile("fixtureA.mp3");
  const fileB = await uploadFixtureFile("fixtureB.mp3");

  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Alice", "Bob", "Carol"]);
  await selectGame(host, roomCode);

  const listPromise = once(host, "game:uploaded-files");
  host.emit("host:list-uploaded-files", { code: roomCode });
  const list = await listPromise;
  assertTrue(list.files.some((f) => f.id === fileA.id), "expected fixtureA to be in the pool");
  assertTrue(list.files.some((f) => f.id === fileB.id), "expected fixtureB to be in the pool");

  const loadPromises = players.map((p) => once(p.socket, "game:load-audio"));
  host.emit("host:select-upload-pair", { code: roomCode, normalFileId: fileA.id, imposterFileId: fileB.id });
  const loads = await Promise.all(loadPromises);

  const room = await new Promise((resolve) => {
    // We don't have direct room access from the client; infer imposter by
    // which player's audioUrl matches fileB (the imposter file we set).
    resolve(players.find((p, i) => loads[i].audioUrl === fileB.url));
  });
  assertTrue(!!room, "expected exactly one player to receive the imposter file");
  const imposterIndex = players.indexOf(room);
  loads.forEach((load, i) => {
    assertTrue(load.sourceType === "upload", "expected sourceType upload for every player");
    assertTrue(load.startSeconds === 0, "expected upload tracks to have startSeconds 0");
    const expectedUrl = i === imposterIndex ? fileB.url : fileA.url;
    assertTrue(load.audioUrl === expectedUrl, `expected player ${i} to get ${expectedUrl}, got ${load.audioUrl}`);
  });

  console.log("  PASS — explicit upload pair correctly assigned per player");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario_uploadPairRandomFill() {
  console.log("\n[Scenario 2] upload-pair round: one explicit file, one random-filled");
  const fileA = await uploadFixtureFile("fixtureC.mp3");
  await uploadFixtureFile("fixtureD.mp3"); // adds a second pool candidate for random-fill

  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Dan", "Eve", "Frank"]);
  await selectGame(host, roomCode);

  const loadPromises = players.map((p) => once(p.socket, "game:load-audio"));
  host.emit("host:select-upload-pair", { code: roomCode, normalFileId: fileA.id, imposterFileId: null });
  const loads = await Promise.all(loadPromises);

  const urls = new Set(loads.map((l) => l.audioUrl));
  assertTrue(urls.size === 2, "expected exactly 2 distinct audio URLs assigned across the 3 players");
  assertTrue(loads.some((l) => l.audioUrl === fileA.url), "expected fixtureA to still be used for the normal track");

  console.log("  PASS — random-fill produced a valid, distinct second file");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario_uploadPairInsufficientPool() {
  console.log("\n[Scenario 3] upload-pair round: rejected when host picks the same file twice");
  const fileA = await uploadFixtureFile("fixtureE.mp3");

  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Gina", "Hank", "Ivy"]);
  await selectGame(host, roomCode);

  const errorPromise = once(host, "host:error");
  host.emit("host:select-upload-pair", { code: roomCode, normalFileId: fileA.id, imposterFileId: fileA.id });
  const errorMsg = await errorPromise;
  assertTrue(/at least 2 different/.test(errorMsg.error), `expected the duplicate-file error, got: ${errorMsg.error}`);

  console.log("  PASS — duplicate file selection rejected with a clear error");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario_youtubePairWithDifferentStartSeconds() {
  console.log("\n[Scenario 4] YouTube pair round: different start-seconds per track, verified structurally");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Jill", "Kevin", "Liam"]);
  await selectGame(host, roomCode);

  const loadPromises = players.map((p) => once(p.socket, "game:load-audio"));
  host.emit("host:select-youtube-pair", {
    code: roomCode,
    normal: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", startSeconds: 10 },
    imposter: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 40 },
  });
  const loads = await Promise.all(loadPromises);

  loads.forEach((l) => assertTrue(l.sourceType === "youtube" && l.videoId === "dQw4w9WgXcQ", "expected every player to get the same video id"));
  const imposterLoadIndex = loads.findIndex((l) => l.startSeconds === 40);
  assertTrue(imposterLoadIndex !== -1, "expected exactly one player to have startSeconds 40 (the imposter)");
  loads.forEach((l, i) => {
    const expected = i === imposterLoadIndex ? 40 : 10;
    assertTrue(l.startSeconds === expected, `expected player ${i} startSeconds ${expected}, got ${l.startSeconds}`);
  });

  // Ready everyone and play — confirm the broadcast position reflects each
  // player's own start-second (this is the per-player position formula,
  // verified structurally without any real YouTube connectivity).
  const readyPromise = once(host, "game:all-ready");
  players.forEach((p) => p.socket.emit("player:audio-ready", { code: roomCode }));
  await readyPromise;

  const playPromises = players.map((p) => once(p.socket, "game:play-at"));
  host.emit("host:play-audio", { code: roomCode });
  const plays = await Promise.all(playPromises);

  plays.forEach((play, i) => {
    const expected = i === imposterLoadIndex ? 40000 : 10000;
    assertTrue(play.position === expected, `expected player ${i} play position ${expected}, got ${play.position}`);
  });

  console.log("  PASS — per-player start-seconds correctly threaded through load-audio and play-at");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function scenario_youtubeBadUrl() {
  console.log("\n[Scenario 5] YouTube pair round: rejected on an unparseable URL");
  const { host, roomCode } = await createRoom();
  const players = await joinPlayers(roomCode, ["Mona", "Noah", "Owen"]);
  await selectGame(host, roomCode);

  const errorPromise = once(host, "host:error");
  host.emit("host:select-youtube-pair", {
    code: roomCode,
    normal: { url: "not a url", startSeconds: 0 },
    imposter: { url: "https://youtu.be/dQw4w9WgXcQ", startSeconds: 0 },
  });
  const errorMsg = await errorPromise;
  assertTrue(/video ID/.test(errorMsg.error), `expected a video-ID parse error, got: ${errorMsg.error}`);

  console.log("  PASS — unparseable URL rejected with a clear error");
  host.close();
  players.forEach((p) => p.socket.close());
}

async function main() {
  process.env.PORT = String(PORT);
  require(path.join(__dirname, "..", "index.js"));
  await new Promise((r) => setTimeout(r, 300));
  console.log(`Test server up on port ${PORT}`);

  try {
    await scenario_uploadPair();
    await scenario_uploadPairRandomFill();
    await scenario_uploadPairInsufficientPool();
    await scenario_youtubePairWithDifferentStartSeconds();
    await scenario_youtubeBadUrl();

    console.log("\nALL AUDIO-SOURCE E2E SCENARIOS PASSED");
    process.exit(0);
  } catch (err) {
    console.error("\nE2E TEST FAILED:", err.stack || err.message);
    process.exit(1);
  }
}

main();

// e2e-reconnect.js
// Proves the durable-session guarantee: a player who drops mid-game and comes
// back with the same token gets the same seat, and a host who drops does not
// destroy the room.

const { spawn } = require("child_process");
const { io: connect } = require("socket.io-client");

const PORT = 3210;
const URL = `http://127.0.0.1:${PORT}`;
const HOST_TOKEN = "e2e-host-token-0001";
const P1 = "e2e-player-token-001";
const P2 = "e2e-player-token-002";
const P3 = "e2e-player-token-003";

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function main() {
  const server = spawn(process.execPath, ["index.js"], {
    env: { ...process.env, PORT: String(PORT) },
  });
  await new Promise((resolve) => {
    server.stdout.on("data", (d) => {
      if (d.toString().includes("Server running on port")) resolve();
    });
  });

  const host = connect(URL);
  await once(host, "connect");
  host.emit("host:create-room", { token: HOST_TOKEN });
  const { room } = await once(host, "host:room-created");
  const code = room.code;

  const players = [];
  for (const token of [P1, P2, P3]) {
    const s = connect(URL);
    await once(s, "connect");
    s.emit("player:join-room", { code, nickname: `P-${token.slice(-1)}`, token });
    await once(s, "player:joined");
    players.push({ socket: s, token });
  }

  // Put the room into a running game so seats become load-bearing.
  const startedPromise = once(host, "game:started");
  host.emit("host:select-game", { code, gameId: "word-wolf" });
  host.emit("host:select-auto-pair", { code });
  await startedPromise;

  // Reveal words now, so player 0 genuinely receives a private message
  // before dropping -- there is nothing to "re-send" on rejoin otherwise.
  const originalWordPromise = once(players[0].socket, "game:reveal-word");
  host.emit("host:reveal-words", { code });
  const originalWord = await originalWordPromise;

  // --- a player drops and returns ---
  players[0].socket.disconnect();
  await new Promise((r) => setTimeout(r, 200));

  const returning = connect(URL);
  await once(returning, "connect");
  const wordAgainPromise = once(returning, "game:reveal-word");
  returning.emit("player:join-room", { code, nickname: "ignored-on-rejoin", token: P1 });
  const rejoin = await once(returning, "player:rejoined");

  const seat = rejoin.room.players.find((p) => p.id === P1);
  if (!seat) throw new Error("FAIL: the reclaimed seat is missing from the room");
  if (seat.nickname !== "P-1") throw new Error("FAIL: rejoin overwrote the nickname");
  if (rejoin.room.players.length !== 3) {
    throw new Error(`FAIL: expected 3 seats, saw ${rejoin.room.players.length}`);
  }
  console.log("  PASS — a mid-game disconnect keeps the seat and the same token reclaims it");

  const wordAgain = await wordAgainPromise;
  if (!wordAgain || !wordAgain.word) {
    throw new Error("FAIL: a rejoining player was not re-sent their word");
  }
  if (wordAgain.word !== originalWord.word) {
    throw new Error(`FAIL: rejoin word "${wordAgain.word}" does not match the original "${originalWord.word}"`);
  }
  console.log("  PASS — a rejoining player is re-sent their private state");

  // --- a stranger still cannot walk in ---
  const stranger = connect(URL);
  await once(stranger, "connect");
  stranger.emit("player:join-room", { code, nickname: "Gatecrasher", token: "e2e-stranger-0001" });
  const refused = await once(stranger, "player:join-error");
  if (refused.error !== "Game already in progress") {
    throw new Error(`FAIL: expected the in-progress gate, saw "${refused.error}"`);
  }
  console.log("  PASS — an unknown token is still refused mid-game");

  // --- the host drops and reclaims ---
  host.disconnect();
  await new Promise((r) => setTimeout(r, 200));

  const host2 = connect(URL);
  await once(host2, "connect");
  host2.emit("host:reclaim-room", { code, token: HOST_TOKEN });
  const reclaimed = await once(host2, "host:room-reclaimed");
  if (reclaimed.room.code !== code) throw new Error("FAIL: host could not reclaim the room");
  if (reclaimed.room.players.length !== 3) {
    throw new Error("FAIL: reclaiming the room lost players");
  }
  console.log("  PASS — a host disconnect does not destroy the room");

  [returning, stranger, host2, players[1].socket, players[2].socket].forEach((s) => s.disconnect());

  // --- a Word Wolf player rejoining after game-over gets final results, not a stale word ---
  // This uses its own independent room rather than extending the room above,
  // since that room's state has already moved past a game-in-progress rejoin
  // scenario and on to host reclaim.
  const HOST_TOKEN_2 = "e2e-host-token-0002";
  const WW_P1 = "e2e-ww-player-token-001";
  const WW_P2 = "e2e-ww-player-token-002";
  const WW_P3 = "e2e-ww-player-token-003";

  const host2b = connect(URL);
  await once(host2b, "connect");
  host2b.emit("host:create-room", { token: HOST_TOKEN_2 });
  const { room: room2 } = await once(host2b, "host:room-created");
  const code2 = room2.code;

  const wwPlayers = [];
  for (const token of [WW_P1, WW_P2, WW_P3]) {
    const s = connect(URL);
    await once(s, "connect");
    s.emit("player:join-room", { code: code2, nickname: `WW-${token.slice(-1)}`, token });
    await once(s, "player:joined");
    wwPlayers.push({ socket: s, token });
  }

  const ww2StartedPromise = once(host2b, "game:started");
  host2b.emit("host:select-game", { code: code2, gameId: "word-wolf" });
  host2b.emit("host:select-custom-pair", { code: code2, normalWord: "Coffee", imposterWord: "Tea" });
  await ww2StartedPromise;

  const wwWordPromises = wwPlayers.map((p) => once(p.socket, "game:reveal-word"));
  host2b.emit("host:reveal-words", { code: code2 });
  const wwWords = await Promise.all(wwWordPromises);
  const wolfIndex = wwWords.findIndex((w) => w.word === "Tea");
  if (wolfIndex === -1) throw new Error("FAIL: no player received the wolf word");
  const wolf = wwPlayers[wolfIndex];
  const others = wwPlayers.filter((_, i) => i !== wolfIndex);

  // Vote the wolf out directly so the game ends immediately (crew wins).
  const ww2ResultsPromise = once(host2b, "game:results");
  others[0].socket.emit("player:vote", { code: code2, votedForId: wolf.token });
  others[1].socket.emit("player:vote", { code: code2, votedForId: wolf.token });
  wolf.socket.emit("player:vote", { code: code2, votedForId: others[0].token });
  const finalResults = await ww2ResultsPromise;
  if (finalResults.winner !== "crew") {
    throw new Error(`FAIL: expected crew to win, saw "${finalResults.winner}"`);
  }

  // Now the game has ended. Disconnect a player and reconnect with the same
  // token -- before the fix, "game-over" was an unhandled phase and rejoin
  // sent the returning player nothing at all (a blank screen forever); it
  // must now be re-sent game:results, and must NOT get a stale
  // game:reveal-word (the phase that was actually current before game-over).
  others[0].socket.disconnect();
  await new Promise((r) => setTimeout(r, 200));

  const wwReturning = connect(URL);
  await once(wwReturning, "connect");

  let sawStaleWord = false;
  wwReturning.once("game:reveal-word", () => {
    sawStaleWord = true;
  });

  const ww2ResultsAgainPromise = once(wwReturning, "game:results");
  wwReturning.emit("player:join-room", { code: code2, nickname: "ignored-on-rejoin", token: others[0].token });
  await once(wwReturning, "player:rejoined");
  const resultsAgain = await ww2ResultsAgainPromise;

  if (resultsAgain.winner !== "crew") {
    throw new Error(`FAIL: rejoin after game-over returned winner "${resultsAgain.winner}", expected "crew"`);
  }
  if (sawStaleWord) {
    throw new Error("FAIL: rejoin after game-over sent a stale game:reveal-word");
  }
  console.log("  PASS — a Word Wolf player rejoining after game-over is re-sent final results, not a stale word");

  [host2b, wwReturning, wolf.socket, others[1].socket].forEach((s) => s.disconnect());

  server.kill();
  console.log("\nALL RECONNECT E2E SCENARIOS PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

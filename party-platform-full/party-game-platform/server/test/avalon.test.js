const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../games/avalon");

test("meta has the expected shape", () => {
  assert.equal(game.meta.id, "avalon");
  assert.equal(game.meta.name, "Avalon");
  assert.equal(game.meta.minPlayers, 5);
  assert.equal(game.meta.maxPlayers, 10);
});

test("getRoleTable returns the official table for 5-10 players and null outside it", () => {
  assert.deepEqual(game.getRoleTable(5), { evilCount: 2, teamSizes: [2, 3, 2, 3, 3], doubleFailQuestIndex: null });
  assert.deepEqual(game.getRoleTable(7), { evilCount: 3, teamSizes: [2, 3, 3, 4, 4], doubleFailQuestIndex: 3 });
  assert.deepEqual(game.getRoleTable(10), { evilCount: 4, teamSizes: [3, 4, 4, 5, 5], doubleFailQuestIndex: 3 });
  assert.equal(game.getRoleTable(4), null);
  assert.equal(game.getRoleTable(11), null);
});

test("assignRoles errors outside the 5-10 player range", () => {
  const result = game.assignRoles(["p1", "p2", "p3", "p4"]);
  assert.match(result.error, /5-10 players/);
});

function countRoles(roles) {
  const counts = {};
  for (const role of roles.values()) counts[role] = (counts[role] || 0) + 1;
  return counts;
}

test("assignRoles produces exactly one merlin, one percival, one assassin, one morgana for 5 players, no minions", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  const { roles } = game.assignRoles(ids);
  assert.equal(roles.size, 5);
  const counts = countRoles(roles);
  assert.deepEqual(counts, { merlin: 1, percival: 1, "loyal-servant": 1, assassin: 1, morgana: 1 });
});

test("assignRoles fills remaining good/evil slots with loyal-servant/minion for 8 players", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];
  const { roles } = game.assignRoles(ids);
  const counts = countRoles(roles);
  // 8 players -> 3 evil, 5 good
  assert.deepEqual(counts, { merlin: 1, percival: 1, "loyal-servant": 3, assassin: 1, morgana: 1, minion: 1 });
});

test("assignRoles randomizes who gets which role across repeated calls", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5"];
  const seenMerlins = new Set();
  for (let i = 0; i < 30; i++) {
    const { roles } = game.assignRoles(ids);
    for (const [id, role] of roles.entries()) {
      if (role === "merlin") seenMerlins.add(id);
    }
  }
  assert.ok(seenMerlins.size > 1, "merlin should land on different players across repeated assignments");
});

test("computeKnowledge: merlin sees the full evil list, evil players see each other but not themselves", () => {
  const roles = new Map([
    ["p1", "merlin"], ["p2", "percival"], ["p3", "loyal-servant"],
    ["p4", "assassin"], ["p5", "morgana"],
  ]);
  const nicknames = new Map([
    ["p1", "Alice"], ["p2", "Bob"], ["p3", "Carol"], ["p4", "Dave"], ["p5", "Eve"],
  ]);
  const knowledge = game.computeKnowledge(roles, nicknames);

  const merlinView = knowledge.get("p1");
  assert.equal(merlinView.team, "good");
  const merlinEvilIds = merlinView.evilPlayers.map((p) => p.id).sort();
  assert.deepEqual(merlinEvilIds, ["p4", "p5"]);

  const assassinView = knowledge.get("p4");
  assert.equal(assassinView.team, "evil");
  assert.deepEqual(assassinView.evilPlayers.map((p) => p.id), ["p5"]);

  const morganaView = knowledge.get("p5");
  assert.deepEqual(morganaView.evilPlayers.map((p) => p.id), ["p4"]);
});

test("computeKnowledge: percival sees an unordered {merlin, morgana} pair and nothing else", () => {
  const roles = new Map([
    ["p1", "merlin"], ["p2", "percival"], ["p3", "loyal-servant"],
    ["p4", "assassin"], ["p5", "morgana"],
  ]);
  const nicknames = new Map([
    ["p1", "Alice"], ["p2", "Bob"], ["p3", "Carol"], ["p4", "Dave"], ["p5", "Eve"],
  ]);
  const knowledge = game.computeKnowledge(roles, nicknames);

  const percivalView = knowledge.get("p2");
  assert.equal(percivalView.evilPlayers.length, 0);
  const pairIds = percivalView.percivalPair.map((p) => p.id).sort();
  assert.deepEqual(pairIds, ["p1", "p5"]);
});

test("computeKnowledge: loyal servants see nothing extra", () => {
  const roles = new Map([
    ["p1", "merlin"], ["p2", "percival"], ["p3", "loyal-servant"],
    ["p4", "assassin"], ["p5", "morgana"],
  ]);
  const nicknames = new Map([
    ["p1", "Alice"], ["p2", "Bob"], ["p3", "Carol"], ["p4", "Dave"], ["p5", "Eve"],
  ]);
  const knowledge = game.computeKnowledge(roles, nicknames);

  const servantView = knowledge.get("p3");
  assert.equal(servantView.team, "good");
  assert.equal(servantView.evilPlayers.length, 0);
  assert.equal(servantView.percivalPair, null);
});

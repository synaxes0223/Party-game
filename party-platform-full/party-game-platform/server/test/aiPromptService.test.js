const test = require("node:test");
const assert = require("node:assert/strict");
const aiPromptService = require("../games/aiPromptService");

test("isAvailable reflects ANTHROPIC_API_KEY presence", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal(aiPromptService.isAvailable(), false);
  process.env.ANTHROPIC_API_KEY = "test-key";
  assert.equal(aiPromptService.isAvailable(), true);
  if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = original;
});

test("generatePrompts errors when AI is not configured", async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const result = await aiPromptService.generatePrompts({ gameId: "who-wrote-that", topic: "CNY", spice: 1 });
  assert.ok(result.error);
  if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = original;
});

test("generatePrompts requires a non-empty topic", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const result = await aiPromptService.generatePrompts({ gameId: "who-wrote-that", topic: "  ", spice: 1 });
  assert.equal(result.error, "A topic is required.");
});

test("generatePrompts parses a successful structured-output response via an injected client", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const fakeClient = {
    messages: {
      create: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ prompts: ["Prompt one", "Prompt two"] }) }],
      }),
    },
  };
  const result = await aiPromptService.generatePrompts({
    gameId: "who-wrote-that",
    topic: "office life",
    spice: 2,
    client: fakeClient,
  });
  assert.deepEqual(result.prompts, [
    { text: "Prompt one", spice: 2 },
    { text: "Prompt two", spice: 2 },
  ]);
});

test("generatePrompts maps a refusal stop_reason to an error", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const fakeClient = { messages: { create: async () => ({ stop_reason: "refusal", content: [] }) } };
  const result = await aiPromptService.generatePrompts({
    gameId: "who-wrote-that",
    topic: "test",
    spice: 1,
    client: fakeClient,
  });
  assert.ok(result.error);
});

test("generatePrompts maps a max_tokens stop_reason to an error without parsing", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const fakeClient = {
    messages: { create: async () => ({ stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }) },
  };
  const result = await aiPromptService.generatePrompts({
    gameId: "who-wrote-that",
    topic: "test",
    spice: 1,
    client: fakeClient,
  });
  assert.ok(result.error);
});

test("generatePrompts surfaces a rate-limit error with a friendly message", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const err = new Error("rate limited");
  err.name = "RateLimitError";
  const fakeClient = { messages: { create: async () => { throw err; } } };
  const result = await aiPromptService.generatePrompts({
    gameId: "who-wrote-that",
    topic: "test",
    spice: 1,
    client: fakeClient,
  });
  assert.match(result.error, /busy/);
});

test("generatePrompts filters out invalid entries from the AI response", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  const fakeClient = {
    messages: {
      create: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ prompts: ["Good one", "   ", "a".repeat(300)] }) }],
      }),
    },
  };
  const result = await aiPromptService.generatePrompts({
    gameId: "who-wrote-that",
    topic: "test",
    spice: 1,
    client: fakeClient,
  });
  assert.deepEqual(result.prompts, [{ text: "Good one", spice: 1 }]);
});

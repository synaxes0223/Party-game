// aiPromptService.js
// Optional AI-backed prompt generation for the shared prompt pipeline. Wraps
// the Anthropic SDK behind a lazy require so a missing/unset API key never
// crashes server startup -- games that don't touch this module are
// unaffected, and games that do just see the feature disabled.

const { validateSubmission } = require("./promptLogic");

const GAME_DESCRIPTIONS = {
  "who-wrote-that":
    "an anonymous-answer guessing game: every player writes an answer to the prompt, then the group guesses who wrote what",
  "x-people":
    "an anonymous yes/no icebreaker: every player answers yes or no privately, and only the total count of yes answers is revealed",
  "pass-the-bomb":
    "a hot-potato category game: the current holder must name something from the category out loud before passing a bomb to the next player",
  "secret-missions":
    "a background social game: each player secretly gets real-life missions to complete over the course of a party",
};

const SPICE_DESCRIPTIONS = {
  1: "safe and silly, no personal exposure",
  2: "personal and embarrassing, mild secrets",
  3: "no-holds-barred: relationships, money, real confessions",
};

function isAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function buildSystemPrompt(gameId, spice) {
  const gameDescription = GAME_DESCRIPTIONS[gameId] || "a party icebreaker game";
  const spiceDescription = SPICE_DESCRIPTIONS[spice] || SPICE_DESCRIPTIONS[1];
  return `You write party-game prompts for a group of Malaysian Chinese friends in their
mid-20s. Manglish is welcome (walao, bo jio, yumcha, tapau), and so are local
references (mamak, pasar malam, Grab, Shopee, TnG, kopitiam, CNY, LRT).
Prompts must be short (under 140 characters), specific, and funny — never
generic icebreaker filler. Never produce anything hateful or targeting a
specific real person.

Game type: ${gameDescription}
Spice level ${spice} of 3: ${spiceDescription}
  1 = safe and silly, no personal exposure
  2 = personal and embarrassing, mild secrets
  3 = no-holds-barred: relationships, money, real confessions`;
}

// Returns { prompts: [{text, spice}] } or { error }. `client` is injectable
// for tests -- production callers omit it and let this module require the
// real SDK lazily.
async function generatePrompts({ gameId, topic, spice, count = 10, client } = {}) {
  if (!isAvailable()) {
    return { error: "AI prompt generation is not configured on this server." };
  }
  const trimmedTopic = (topic || "").trim();
  if (!trimmedTopic) return { error: "A topic is required." };
  if (trimmedTopic.length > 100) return { error: "Keep the topic under 100 characters." };

  const safeSpice = [1, 2, 3].includes(spice) ? spice : 1;
  const safeCount = Math.max(5, Math.min(20, Number(count) || 10));

  let anthropicClient = client;
  if (!anthropicClient) {
    let Anthropic;
    try {
      Anthropic = require("@anthropic-ai/sdk");
    } catch (err) {
      return { error: "AI prompt generation is unavailable (SDK not installed)." };
    }
    anthropicClient = new Anthropic();
  }

  let res;
  try {
    res = await anthropicClient.messages.create({
      model: process.env.PROMPT_GEN_MODEL || "claude-opus-4-8",
      max_tokens: 2000,
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { prompts: { type: "array", items: { type: "string" } } },
            required: ["prompts"],
            additionalProperties: false,
          },
        },
      },
      system: buildSystemPrompt(gameId, safeSpice),
      messages: [{ role: "user", content: `Generate ${safeCount} prompts about: ${trimmedTopic}` }],
    });
  } catch (err) {
    if (err && err.name === "RateLimitError") {
      return { error: "AI is busy right now — try again in a moment." };
    }
    if (err && err.name === "AuthenticationError") {
      return { error: "The server's AI API key is invalid." };
    }
    return { error: "Couldn't reach the AI service — try again." };
  }

  if (res.stop_reason === "refusal") {
    return { error: "Couldn't generate prompts for that topic." };
  }
  if (res.stop_reason === "max_tokens") {
    return { error: "The AI response was cut off — try a smaller count." };
  }

  const textBlock = (res.content || []).find((b) => b.type === "text");
  if (!textBlock) return { error: "The AI didn't return any prompts." };

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (err) {
    return { error: "Couldn't parse the AI response." };
  }

  const rawPrompts = Array.isArray(parsed.prompts) ? parsed.prompts : [];
  const prompts = [];
  for (const raw of rawPrompts) {
    const validated = validateSubmission(raw);
    if (!validated.error) prompts.push({ text: validated.text, spice: safeSpice });
  }

  if (prompts.length === 0) return { error: "The AI didn't return any usable prompts." };
  return { prompts };
}

module.exports = { isAvailable, generatePrompts, buildSystemPrompt };

// ---------------------------------------------------------------------------
// npc-brain.js — the NPC conversation brain, as a pure-ish function.
//
// This is the only place the Claude prompt + parsing live. It's imported by:
//   - api/chat.js  (the Vercel serverless function — the only file with the key)
//   - smoke tests  (parseNpcReply is unit-checkable without any network)
//
// It does NOT read process.env or talk to the network itself; the caller passes
// in an Anthropic client. That keeps the route a thin validate-and-call wrapper.
// ---------------------------------------------------------------------------

// In-world chat is short and must feel instant. Haiku is the right call here —
// a stronger model adds latency for no quality gain at beginner/intermediate.
// Override with the CHAT_MODEL env var (read in api/chat.js, passed through).
export const DEFAULT_MODEL = "claude-haiku-4-5";

// This repo's level is binary (beginner | advanced), NOT CEFR. Map it to a
// calibration phrase the model can actually act on.
export const LEVEL_PHRASE = {
  beginner:
    "a beginner (CEFR A1–A2): very short, simple sentences, the most common words, mostly present tense, slow and clear",
  advanced:
    "an intermediate/advanced learner (CEFR B1–B2): a natural pace with richer vocabulary and varied tenses, still clear",
};

// Strict schema — every key always present. Belt #1: the model is constrained
// to this via structured output. additionalProperties:false + all keys required.
export const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    reply_en: { type: "string" },
    your_en: { type: "string" },
    correction: { type: "string" },
    feedback: { type: "string" },
    suggestions: { type: "array", items: { type: "string" } },
  },
  required: [
    "reply",
    "reply_en",
    "your_en",
    "correction",
    "feedback",
    "suggestions",
  ],
};

// Build the system prompt from language + mapped level + the NPC persona.
// `opening` (optional) folds the seeded greeting in as context, because that
// greeting was shown locally and is NOT sent as an assistant message (the API
// requires the first message to be `user`).
export function buildSystemPrompt({ language, level, npc, opening }) {
  const levelPhrase = LEVEL_PHRASE[level] ?? LEVEL_PHRASE.beginner;
  const lines = [
    `You are ${npc.name}, an NPC in a language-immersion travel game. Persona: ${npc.persona}`,
    `Stay fully in character at all times — you are ${npc.name}, not an AI assistant.`,
    `Speak ${language}, calibrated to ${levelPhrase}. Keep your spoken line to 1–2 short sentences.`,
  ];
  if (opening) {
    lines.push(
      `You already greeted the player with: "${opening}". Continue the conversation naturally from there; do not greet again.`
    );
  }
  lines.push(
    "You are also a gentle language coach. In addition to your in-character spoken line, you return coaching about what the LEARNER (the player) just wrote:",
    `- "your_en": a natural English translation of the learner's last message. Use "" if the learner wrote nothing or it is untranslatable.`,
    `- "correction": the natural, correct way to say the learner's last message in ${language}. Use "" if what they wrote is already fine.`,
    `- "feedback": one short, kind coaching note in English about their last message (a tip, encouragement, or a gentle fix). Use "" only if there is truly nothing worth saying.`,
    `- "suggestions": 2–3 short phrases in ${language} the learner could say next.`,
    'Return ONLY a JSON object with exactly these keys: "reply" (your in-character spoken line in ' +
      language +
      '), "reply_en" (its English translation), "your_en", "correction", "feedback", "suggestions".'
  );
  return lines.join("\n");
}

// Belt #2: defensive parse. Even with structured output, models occasionally
// wrap JSON in prose or fences — survive it. Strip ```json fences, slice from
// the first { to the last }, parse, and require suggestions to be an array.
export function parseNpcReply(raw) {
  if (typeof raw !== "string") {
    throw new Error("NPC reply was not text");
  }
  let text = raw.trim();
  // strip ```json ... ``` or ``` ... ``` fences
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) {
    throw new Error("No JSON object found in NPC reply");
  }
  const obj = JSON.parse(text.slice(first, last + 1));
  if (!Array.isArray(obj.suggestions)) {
    throw new Error("NPC reply 'suggestions' was not an array");
  }
  // Normalise: guarantee every contract key is a present string/array.
  return {
    reply: typeof obj.reply === "string" ? obj.reply : "",
    reply_en: typeof obj.reply_en === "string" ? obj.reply_en : "",
    your_en: typeof obj.your_en === "string" ? obj.your_en : "",
    correction: typeof obj.correction === "string" ? obj.correction : "",
    feedback: typeof obj.feedback === "string" ? obj.feedback : "",
    suggestions: obj.suggestions.filter((s) => typeof s === "string"),
  };
}

// Generate one NPC reply. `client` is an Anthropic SDK client (injected).
// `history` is oldest-first [{ role:"assistant"|"user", content }]; the last
// entry is the newest learner line. Returns the strict response object.
export async function generateNpcReply(client, { history, language, level, npc, model }) {
  // The API requires messages to start with a user turn. Our history is seeded
  // with the greeting as the first assistant turn — fold any leading assistant
  // turns into the system prompt as `opening` context instead of sending them.
  const messages = history.map((h) => ({ role: h.role, content: h.content }));
  let opening = "";
  while (messages.length && messages[0].role === "assistant") {
    opening = messages.shift().content;
  }
  if (messages.length === 0) {
    // Nothing for the model to respond to (shouldn't happen — the newest entry
    // is always the learner's line) — guard rather than send an empty request.
    throw new Error("No learner message to respond to");
  }

  const system = buildSystemPrompt({ language, level, npc, opening });

  const response = await client.messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 1024,
    system,
    output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
    messages,
  });

  // Concatenate any text blocks, then parse defensively.
  const text = (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parseNpcReply(text);
}

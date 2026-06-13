// ---------------------------------------------------------------------------
// api/chat.js — the NPC brain's server surface (Vercel serverless function).
//
// WHY THIS EXISTS: ANTHROPIC_API_KEY must never reach the browser. The world is
// a static Vite app today, so this is the *added* server surface. The browser
// only ever fetch("/api/chat"); the key lives here and nowhere else. (This is
// not about CORS — calling Anthropic from the client with any key just relocates
// the leak. The secret stays server-side, full stop.)
//
// Locally this runs under `vercel dev`. In production it's a normal Vercel
// function on this project ("world"). The Anthropic SDK isn't edge-friendly, so
// we pin the Node runtime.
// ---------------------------------------------------------------------------

import Anthropic from "@anthropic-ai/sdk";
import { generateNpcReply } from "../src/npc-brain.js";

export const config = { runtime: "nodejs" };

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return send(res, 405, { error: "Method not allowed. Use POST." });
  }

  // Body may arrive parsed (Vercel) or as a raw stream — handle both.
  let body = req.body;
  if (body == null || typeof body === "string") {
    try {
      const raw =
        typeof body === "string" ? body : await readRawBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(res, 400, { error: "Request body must be valid JSON." });
    }
  }

  // --- Validate the contract, fail loud (§3.7) ---------------------------
  const { history, language, level, npc } = body || {};
  if (!Array.isArray(history) || history.length === 0) {
    return send(res, 400, { error: "`history` must be a non-empty array." });
  }
  if (typeof language !== "string" || !language.trim()) {
    return send(res, 400, { error: "`language` must be a non-empty string." });
  }
  if (typeof level !== "string" || !level.trim()) {
    return send(res, 400, { error: "`level` must be a non-empty string." });
  }
  if (
    !npc ||
    typeof npc.name !== "string" ||
    !npc.name.trim() ||
    typeof npc.persona !== "string" ||
    !npc.persona.trim()
  ) {
    return send(res, 400, {
      error: "`npc` must include a string `name` and `persona`.",
    });
  }

  // --- The key must be present, and the error must say where it goes ------
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return send(res, 500, {
      error:
        "ANTHROPIC_API_KEY is not set. Set it in world/.env.local (for local `vercel dev`) or in the Vercel project's environment variables.",
    });
  }

  // --- Call the brain; a brain failure is a 502 (bad upstream) -----------
  try {
    const client = new Anthropic({ apiKey });
    const result = await generateNpcReply(client, {
      history,
      language,
      level,
      npc,
      model: process.env.CHAT_MODEL, // optional override; brain defaults to Haiku
    });
    return send(res, 200, result);
  } catch (err) {
    console.error("NPC brain failed:", err);
    return send(res, 502, {
      error: "The NPC brain failed to generate a reply.",
      detail: err && err.message ? err.message : String(err),
    });
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

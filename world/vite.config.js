import { defineConfig, loadEnv } from "vite";

// ---------------------------------------------------------------------------
// Dev-only NPC chat endpoint.
//
// In production the NPC brain is served by the Vercel function at api/chat.js.
// The committed dev workflow here is plain `vite` (npm run dev), which does NOT
// run Vercel functions — so this middleware serves POST /api/chat using the
// SAME pure brain (src/npc-brain.js). This is the §3.1-sanctioned "tiny Vite
// dev proxy" alternative to requiring `vercel dev`.
//
// The key stays server-side: ANTHROPIC_API_KEY is read here (Node, via
// loadEnv on .env.local) and never reaches the client bundle. The browser only
// ever fetch("/api/chat"). `apply: "serve"` means this never runs at build.
// ---------------------------------------------------------------------------
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [
      {
        name: "npc-chat-dev-api",
        apply: "serve",
        configureServer(server) {
          server.middlewares.use("/api/chat", async (req, res) => {
            const json = (status, body) => {
              res.statusCode = status;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify(body));
            };

            if (req.method !== "POST") {
              return json(405, { error: "Method not allowed. Use POST." });
            }

            let raw = "";
            for await (const chunk of req) raw += chunk;
            let body;
            try {
              body = raw ? JSON.parse(raw) : {};
            } catch {
              return json(400, { error: "Request body must be valid JSON." });
            }

            // Same contract validation as api/chat.js (§3.7).
            const { history, language, level, npc, player } = body || {};
            if (!Array.isArray(history) || history.length === 0)
              return json(400, { error: "`history` must be a non-empty array." });
            if (typeof language !== "string" || !language.trim())
              return json(400, { error: "`language` must be a non-empty string." });
            if (typeof level !== "string" || !level.trim())
              return json(400, { error: "`level` must be a non-empty string." });
            if (
              !npc ||
              typeof npc.name !== "string" ||
              !npc.name.trim() ||
              typeof npc.persona !== "string" ||
              !npc.persona.trim()
            )
              return json(400, {
                error: "`npc` must include a string `name` and `persona`.",
              });
            if (player != null && (typeof player !== "object" || Array.isArray(player)))
              return json(400, { error: "`player`, if provided, must be an object." });

            const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
            if (!apiKey)
              return json(500, {
                error:
                  "ANTHROPIC_API_KEY is not set. Set it in world/.env.local, then restart `npm run dev`.",
              });

            try {
              const { default: Anthropic } = await import("@anthropic-ai/sdk");
              const { generateNpcReply } = await import("./src/npc-brain.js");
              const client = new Anthropic({ apiKey });
              const result = await generateNpcReply(client, {
                history,
                language,
                level,
                npc,
                player, // optional traveler context (name, interests, …)
                model: env.CHAT_MODEL || process.env.CHAT_MODEL,
              });
              json(200, result);
            } catch (err) {
              json(502, {
                error: "The NPC brain failed to generate a reply.",
                detail: err && err.message ? err.message : String(err),
              });
            }
          });
        },
      },
    ],
  };
});

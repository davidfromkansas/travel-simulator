# Session Log — NPC characters + conversation loop (`world/`)

> **Date:** 2026-06-13
> **Repo:** github.com/davidfromkansas/travel-simulator · branch work on `feat/npcs` → merged to `main`
> **Note:** This is an authored summary of the working session (the CLI `/export` did not write a file to disk in this build). It captures the goal, decisions, changes, issues/fixes, commits, and deployment.

## Goal
Implement the spec in `directions.md`: add NPC characters and the conversation/interaction loop inside the walkable splat town (`world/`). Purely **additive** — the existing town (splat + collider) and the existing main character were left untouched.

## What shipped
A player walks the Italian town, walks up to a local, gets an instant in-language greeting in a speech bubble, presses **E** to reply, and the NPC answers in character with a four-part coaching payload (translation, correction, feedback, suggestions). Walk away to end; each NPC keeps its own conversation memory.

### Architecture (three pieces + dev proxy)
- **`world/api/chat.js`** — Vercel Node serverless function; the only place `ANTHROPIC_API_KEY` lives. Validates the request body (→400), names the missing key and where it goes (→500), maps brain failures (→502).
- **`world/src/npc-brain.js`** — pure prompt/parse brain (importable + smoke-testable). Strict JSON enforced two ways: `output_config.format` json_schema structured output **and** a defensive fence-strip parse. Binary level (`beginner`/`advanced`) → CEFR calibration phrase. Default model `claude-haiku-4-5` (latency), `CHAT_MODEL` override. Folds the seeded greeting into system context so the first API message is a valid `user` turn.
- **`world/src/npcs.js`** — cast **derived from language** (`PLACE_KITS`) + generic `arcPositions` layout (no baked coordinates). Italian cast: Giulia (gelato), Marco (trattoria), Sofia (barista). Adding a country = adding one kit.
- **`world/src/main.js`** — loads + ground-snaps idle NPCs (own `AnimationMixer` each), proximity → active NPC, instant greeting bubbles, turn-to-face, E-to-talk with movement gating, walk-away-to-leave, per-NPC memory, DOM bubbles projected from 3D each frame, `?profile=`/`?country=` wiring, beginner-default translation toggle.
- **`world/vite.config.js`** — dev-only `/api/chat` middleware so `npm run dev` (plain Vite) works without `vercel dev`, sharing the same brain. Key stays server-side.
- **`world/.env.example`** — documents the `ANTHROPIC_API_KEY` contract. Real value lives in gitignored `world/.env.local`.

## Key decisions
- **API key never reaches the browser.** Browser only `fetch("/api/chat")`; SDK + key are server-only. Verified the client bundle contains no anthropic/SDK/key references.
- **Strict JSON enforced twice** (schema + defensive parse) so prose/fence-wrapped replies survive.
- **Greetings are local + instant**; only player replies cost an API call.
- **Placement derived, not hardcoded** — arc layout aimed at the open core of the collider bounds; spawn heading set to face the cast on load.
- **Haiku for latency**, env-overridable.
- **Appearance pass:** all NPCs use the animated civilian humanoid (`casual.glb`), each given a distinct clothing tint + height (cloned materials so the player is untouched) so they read as three separate people. Real per-role character GLBs can later drop into `world/public/models/npcs/`.

## Issues encountered & fixes
1. **Dev server bound IPv6-only (`::1`)** → browser hitting `127.0.0.1` got connection-refused. Fixed by relaunching both servers with `--host` (binds all interfaces); `127.0.0.1` + `localhost` both work.
2. **NPCs initially appeared "missing."** They loaded fine; spawn now faces the open core where the arc places them, so they're in view.
3. **NPCs looked like soldiers / clones.** Switched the whole cast to the humanoid model with per-NPC tint + height variation.

## Commits (on `main`)
- `4d8036b` — feat(world): NPC characters + in-world language conversation loop
- `c281ef2` — feat(world): make NPCs distinct people — humanoid model + per-NPC tint & height

## Verification
- Production build passes; defensive parser survives fenced/prose-wrapped JSON.
- Client bundle has **no** SDK/key references (key is server-only).
- `/api/chat`: bad body → 400; missing key → 500 (names the var + location); valid request → 200 with full coaching payload (verified locally **and** in production).

## Deployment (live)
- **GitHub:** `main` pushed (`c281ef2`).
- **Vercel `world`:** https://world-peach-psi.vercel.app — `ANTHROPIC_API_KEY` set as a production env var; `/api/chat` returns 200 live.
- **Vercel `onboarding`:** https://onboarding-henna-chi.vercel.app — production bundle bakes `VITE_TOWN_URL = https://world-peach-psi.vercel.app` (no localhost leftover), so selecting Italy loads the deployed town with the profile passed through.
- One-command future releases: `npm run ship` from the repo root (push `main` + deploy both apps to prod). New env vars must also be added to the Vercel project.

## How to run / test
- **Local:** `npm run dev` from repo root → onboarding on :5173, world on :5174. Open http://localhost:5173, onboard, pick Italy, walk up to a local, press **E**, reply in Italian.
- **Production:** open https://onboarding-henna-chi.vercel.app.
- Controls: `↑/W` forward · `↓/S` back · `←→` turn · `A/D` strafe · `Shift` run · **`E`** talk · `Esc` cancel typing.

# Travel Sim — Onboarding + Globe (front-end)

The "everything before entering a country" build for an immersive travel simulator:
a fast onboarding form → a spinnable 3D globe → click a country → hand off into the
scene. A parallel effort builds the 3D town/world; the two merge into one repo. This
build is written to be **modular and import-friendly** so that merge is mechanical.

```
Onboarding  ──Save──▶  Globe  ──click marker──▶  enterCountry(id)  ──▶  Scene (world build mounts here)
```

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run smoke    # headless Chrome smoke test (needs both dev servers running)
```

`npm run build` produces a production bundle. The earth texture lives at
`public/textures/earth.jpg` (served locally — no runtime CDN dependency).

### Running the full experience (globe → town)

Clicking Italy mounts the world build's town (`~/italy-walk`) in-page. Until the
two repos merge into one origin, run **both** dev servers:

```bash
# terminal 1 — this app (onboarding + globe)
cd ~/travel-sim-onboarding && npm run dev            # :5173

# terminal 2 — the world build (the town)
cd ~/italy-walk && npm run dev -- --port 5174 --strictPort   # :5174
```

The town URL is configurable via `VITE_TOWN_URL` (defaults to
`http://localhost:5174`). See `src/world.ts`. A country with no town configured
falls back to the placeholder scene.

## Stack

Vite + React + TypeScript · `@react-three/fiber` + `@react-three/drei` for the globe.
No backend, no auth. All persistence is `localStorage`. Navigation is client-side
state (`view: "onboarding" | "globe" | "scene"`), not server routes.

---

## ★ The two contracts the world build depends on ★

### Contract #1 — Player profile (`src/types.ts`, written by `src/storage.ts`)

Persisted to `localStorage["playerProfile"]` as JSON, in exactly this shape:

```json
{
  "name": "David",
  "nationality": "American",
  "occupation": "Product manager",
  "interests": ["specialty coffee", "vintage", "food"],
  "travelStyle": "wanders, eats local, off the beaten path",
  "languages": {
    "native": ["English"],
    "learning": "Italian",
    "level": "beginner"
  }
}
```

- `languages.level` is a **binary** `"beginner" | "advanced"` toggle, not a scale.
- `languages.learning` is the trip's target language. It is collected in onboarding
  **and** re-synced to the chosen destination by the handoff seam, so it always
  matches the country the player entered.
- A refresh never wipes the profile — the app hydrates from `localStorage` on load.

Read it from the world build with `loadProfile()` (`src/storage.ts`) or directly
from `localStorage`.

### Contract #2 — The handoff seam (`src/handoff.ts`)  ← critical merge point

**All** country selection flows through one function:

```ts
enterCountry(country: string)   // e.g. enterCountry("italy")
```

- **Default (merged app):** flips the app `view` to `"scene"` and passes the country
  string → seamless, no reload, no white flash. The globe falls away, the town fades
  in. The view switch is wired via `registerSceneHandler()`, which `App.tsx` calls on
  mount.
- **Fallback (merge not ready):** set `USE_REDIRECT_FALLBACK = true` (and
  `WORLD_BUILD_URL`) at the top of `src/handoff.ts`. The same function then redirects
  to the parallel build's URL instead. **Swapping merge↔redirect is a one-function
  change — nothing else in the app moves.**

**What the world build must implement:** when `enterCountry("italy")` fires, mount the
matching town. Two ways to plug in:
1. Render your town in the `"scene"` view this app switches to (replace
   `src/components/Scene.tsx`, which is currently a placeholder), **or**
2. Own the URL we redirect to (flip the fallback).

Either way, read the player profile from `localStorage["playerProfile"]` (Contract #1).

> Dev helper: in dev mode the app exposes `window.enterCountry("italy")` so you can
> trigger the real seam from the console without clicking the globe.

---

## Where things live

| Path | Responsibility |
| --- | --- |
| `src/types.ts` | `PlayerProfile` shape (Contract #1) + `AppView` |
| `src/storage.ts` | `localStorage` read/write/patch helpers |
| `src/handoff.ts` | **`enterCountry()` — the cross-build seam (Contract #2)** |
| `src/data/countries.ts` | Supported destinations + lat/lng + target language |
| `src/world.ts` | Maps a country → its embeddable town build (world-build integration) |
| `src/components/Onboarding.tsx` | 8-field profile form, writes on Save |
| `src/components/Globe.tsx` | r3f globe: texture, stars, auto-rotate, drag, glowing markers |
| `src/components/TownFrame.tsx` | Mounts the world build's town in-page (iframe) for countries that have one |
| `src/components/Scene.tsx` | Routes to TownFrame if a town exists, else a placeholder |
| `src/App.tsx` | View state machine; wires the handoff seam to view state |
| `smoke.mjs` | Headless smoke test (schema + handoff + no console errors) |

### Adding a destination

Add an entry to `COUNTRIES` in `src/data/countries.ts` (id, name, lat, lng, language,
flag, `enabled`). A glowing, clickable marker appears automatically; `enabled: false`
renders it dimmed/"soon" and non-clickable. Markers only ever appear for supported
countries.

The globe's `?off=<radians>` and `?freeze=1` query params are dev-only calibration
hooks for marker/texture alignment.

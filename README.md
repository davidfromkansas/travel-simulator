# Travel Simulator

An immersive travel simulator: build a player profile, spin a 3D globe, click a
country, and walk a character around a real-feeling town built from photos.

This is a **monorepo** of two apps that connect at one well-defined seam:

```
┌─────────────────────────────┐        enterCountry("italy")        ┌──────────────────────────┐
│  onboarding/                │  ───────────────────────────────▶  │  world/                  │
│  React + r3f                │   (handoff seam, profile in URL)    │  three.js + Spark        │
│  • onboarding form          │                                     │  • Gaussian-splat town   │
│  • 3D globe + markers       │   mounted in-page via <iframe>      │  • walkable character    │
└─────────────────────────────┘                                     └──────────────────────────┘
```

| App | Stack | Owns |
| --- | --- | --- |
| [`onboarding/`](./onboarding) | Vite + React + TypeScript, `@react-three/fiber` + `drei` | onboarding form, 3D globe, country selection, the handoff seam |
| [`world/`](./world) | Vite + vanilla three.js + `@sparkjsdev/spark` | the 3D town (Gaussian splats), character movement, collisions |

## Run the full experience

The two apps run as separate dev servers (different origins, for now), but the
root scripts boot both at once so you can't forget one:

```bash
npm run install:all   # installs root + onboarding + world (one time)
npm run dev           # boots BOTH servers: onboarding :5173 + world :5174
```

Then open **http://localhost:5173**, fill the onboarding form, and click **Italy**
on the globe — the town mounts in-page. `npm run dev` uses `--strictPort`, so it
fails loudly if 5173/5174 are taken rather than silently moving the town's port.

<details>
<summary>Or run each app on its own</summary>

```bash
# terminal 1 — onboarding + globe
cd onboarding && npm install && npm run dev      # http://localhost:5173

# terminal 2 — the town (world build)
cd world && npm install && npm run dev -- --port 5174 --strictPort   # http://localhost:5174
```
</details>

## Live (Vercel)

| | URL |
| --- | --- |
| **App (share this)** | https://onboarding-henna-chi.vercel.app |
| Town (embedded by the app) | https://world-peach-psi.vercel.app |

Deployed as **two Vercel projects**. The onboarding app embeds the town in an
iframe; the town URL is baked in at build time via the `VITE_TOWN_URL`
environment variable (set on the `onboarding` Vercel project →
`https://world-peach-psi.vercel.app`). The town's large 3D assets are served
from a **Vercel Blob** store (not git, not the deploy bundle) — see
[Assets](#assets) below.

> Note: these were deployed via the Vercel CLI, **not** linked to this GitHub
> repo, so `git push` does **not** auto-redeploy. To redeploy: `cd onboarding && vercel --prod`
> (or `cd world && vercel --prod`). To enable push-to-deploy, import each app as a
> project in the Vercel dashboard (set the root directory to `onboarding`/`world`
> and re-add `VITE_TOWN_URL` on the onboarding project).
>
> Heads-up: the town downloads a ~29 MB Gaussian splat from Blob, so the first
> load of the town over the public internet takes a few seconds.

## How the two apps connect (two contracts)

1. **Player profile** — `onboarding/` writes a JSON profile to
   `localStorage["playerProfile"]` (name, nationality, occupation, interests,
   travelStyle, languages). The town reads it. Because the apps are currently on
   different origins, the profile is also passed in the iframe URL. See
   `onboarding/src/types.ts` and `onboarding/README.md`.
2. **Handoff seam** — all country selection flows through `enterCountry()` in
   `onboarding/src/handoff.ts`. It flips the app to the scene view and mounts the
   town (`onboarding/src/world.ts` → `TownFrame`). Configurable via
   `VITE_TOWN_URL` (default `http://localhost:5174`).

When the two are eventually served from one origin, point `VITE_TOWN_URL` at a
same-origin route (or mount the town directly) and the `localStorage` profile
works without the URL param — no other changes needed.

## Assets

The town's big binaries — the Gaussian splat (`draft1.spz`, ~29 MB), the
collider (`draft1.glb`), and the character (`casual.glb`) — are **not committed
to git**. They live in a public **Vercel Blob** store and are fetched at
runtime. Git is for code; the assets stay out of history and out of the deploy
bundle (`world/.vercelignore`).

- Resolution lives in [`world/src/assets.js`](./world/src/assets.js): the Blob
  base URL is the default, overridable with `VITE_ASSET_BASE`. Set
  `VITE_ASSET_BASE=` (empty) to serve from `world/public/` for offline dev —
  those dirs (`public/worlds/`, `public/models/`) are git-ignored, so drop the
  files in yourself.
- To update an asset: `cd world && vercel blob put public/worlds/draft1.spz
  --pathname worlds/draft1.spz --access public --allow-overwrite` (the
  `BLOB_READ_WRITE_TOKEN` is in `world/.env.local`).

## Notes

- The town uses `three-mesh-bvh` to accelerate collision raycasts and caps the
  device pixel ratio for performance — see `world/src/main.js`.

Each app has its own README with deeper detail.

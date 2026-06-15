// ---------------------------------------------------------------------------
// assets.js — where the large 3D assets live.
//
// The splat / collider / character models are big binaries (tens of MB), so
// they are NOT committed to git. They live in a public Vercel Blob store and
// are fetched at runtime. This keeps the repo lean (git is for code) and keeps
// the deploy bundle small (the assets are excluded via .vercelignore).
//
// Override the base with VITE_ASSET_BASE:
//   - unset (default) → fetch from the Blob store below (works in dev & prod,
//     and on a fresh clone with no local asset files).
//   - "" (empty)      → serve from the app's own /public during offline dev
//     (you must place the files in public/worlds and public/models yourself;
//     they're git-ignored). e.g. `VITE_ASSET_BASE= npm run dev`.
// ---------------------------------------------------------------------------
export const ASSET_BASE =
  // optional-chain so this module is safe to import outside Vite (e.g. node smoke tests)
  import.meta.env?.VITE_ASSET_BASE ??
  "https://vmewkgifeetbr22r.public.blob.vercel-storage.com";

// Resolve a leading-slash asset path (e.g. "/worlds/draft1.spz") against the base.
export const asset = (path) =>
  `${ASSET_BASE}${path.startsWith("/") ? path : "/" + path}`;

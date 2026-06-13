// ============================================================================
// CONTRACT #2: HANDOFF SEAM  ★ CROSS-BUILD MERGE POINT ★
// ----------------------------------------------------------------------------
// ALL country selection flows through enterCountry(). This is the ONLY place
// that decides what "entering a country" means. To merge with the world build
// vs. fall back to a redirect, you change ONLY the body of enterCountry() —
// no other file in this app should need to change.
//
//   Default (merged app): flip the app view to "scene" and hand off the country
//                          string => SEAMLESS, no page reload, no white flash.
//   Fallback (merge not ready): redirect to the parallel build's URL instead.
//                               Flip USE_REDIRECT_FALLBACK to true + set the URL.
//
// The world build only needs to satisfy: when enterCountry("italy") fires,
// mount the matching town. It can do that by either (a) rendering its town in
// the "scene" view this app switches to, or (b) owning the URL we redirect to.
// ============================================================================

import { getCountry } from "./data/countries";
import { patchProfile, saveSelectedCountry } from "./storage";

// --- Fallback config (only used if the seamless merge isn't ready) -----------
const USE_REDIRECT_FALLBACK = false;
const WORLD_BUILD_URL = "http://localhost:5174"; // parallel build's dev URL

// The merged app registers how to switch into the scene view. Kept as a simple
// registered callback so this module has zero dependency on React internals.
type SceneHandler = (country: string) => void;
let sceneHandler: SceneHandler | null = null;

export function registerSceneHandler(handler: SceneHandler): void {
  sceneHandler = handler;
}

/**
 * Enter a country. THE single entry point for leaving the globe.
 * @param country lowercase id, e.g. "italy"
 */
export function enterCountry(country: string): void {
  const id = country.toLowerCase();

  // Persist the choice + sync the trip's target language to the destination,
  // so the world build reads a consistent profile (Contract #1).
  saveSelectedCountry(id);
  const meta = getCountry(id);
  if (meta) {
    patchProfile({
      languages: readLanguagesWithLearning(meta.language),
    });
  }

  // --- THE SWAP: change only what's below to toggle merge vs. redirect ---
  if (USE_REDIRECT_FALLBACK) {
    window.location.href = `${WORLD_BUILD_URL}?country=${encodeURIComponent(id)}`;
    return;
  }

  if (sceneHandler) {
    sceneHandler(id); // seamless: globe falls away, scene/town mounts in place
  } else {
    // Defensive: seam not wired. Surface loudly rather than failing silently.
    console.error("[handoff] No scene handler registered; cannot enter", id);
  }
}

// Merge the destination language into the existing profile's languages block
// without clobbering native/level.
function readLanguagesWithLearning(learning: string) {
  // Lazy import avoided to keep this module's deps flat; read fresh from storage.
  const raw = localStorage.getItem("playerProfile");
  const native = ["English"];
  let level: "beginner" | "advanced" = "beginner";
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p?.languages?.native)) return { ...p.languages, learning };
      if (p?.languages?.level) level = p.languages.level;
    } catch {
      /* fall through to defaults */
    }
  }
  return { native, learning, level };
}

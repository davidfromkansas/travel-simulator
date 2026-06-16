import type { PlayerProfile } from "./types";

// ============================================================================
// WORLD-BUILD INTEGRATION  (companion to the handoff seam in handoff.ts)
// ----------------------------------------------------------------------------
// Maps a supported country to the embeddable "town" build (the parallel
// world build — currently ~/italy-walk, a vanilla three.js + Spark app).
//
// Today the two run as separate dev servers on different origins, so the town
// is mounted in an <iframe> (see TownFrame.tsx) and the player profile is passed
// in the URL (cross-origin localStorage is NOT shared). When the two builds
// merge into ONE repo/origin, just point VITE_TOWN_URL at a same-origin route
// (or replace the iframe with a direct mount) — Contract #1's localStorage
// profile then works directly and the ?profile= param becomes redundant.
// ============================================================================

const TOWN_BASE = import.meta.env.VITE_TOWN_URL ?? "http://localhost:5174";

// Only countries with a ready town are listed. Others fall back to the
// placeholder scene until their world build exists.
const TOWN_BY_COUNTRY: Record<string, string> = {
  italy: TOWN_BASE,
  japan: TOWN_BASE, // procedural Shibuya (no splat) — see world/src/shibuya.js
};

// Countries that have a captured Gaussian-splat scene (the "real scene"). Others
// only have a procedural model world, so the splat/model toggle is hidden.
const SPLAT_COUNTRIES = new Set(["italy", "japan"]);

export function hasTown(country: string): boolean {
  return country.toLowerCase() in TOWN_BY_COUNTRY;
}

export function hasSplat(country: string): boolean {
  return SPLAT_COUNTRIES.has(country.toLowerCase());
}

// Which world the town renders: the photoreal Gaussian splat (the actual
// captured scene) or the stylized low-poly piazza. Splat is the default.
export type WorldMode = "splat" | "town";

// Build the iframe src for a country's town, handing off the country + profile
// via query params so the world build can read them cross-origin today. The
// world mode is passed through too so the toggle in TownFrame can flip it.
export function townUrlFor(
  country: string,
  profile: PlayerProfile | null,
  world: WorldMode = "splat"
): string | null {
  const base = TOWN_BY_COUNTRY[country.toLowerCase()];
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set("country", country.toLowerCase());
  url.searchParams.set("world", world);
  if (profile) url.searchParams.set("profile", JSON.stringify(profile));
  return url.toString();
}

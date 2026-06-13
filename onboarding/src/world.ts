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
};

export function hasTown(country: string): boolean {
  return country.toLowerCase() in TOWN_BY_COUNTRY;
}

// Build the iframe src for a country's town, handing off the country + profile
// via query params so the world build can read them cross-origin today.
export function townUrlFor(country: string, profile: PlayerProfile | null): string | null {
  const base = TOWN_BY_COUNTRY[country.toLowerCase()];
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set("country", country.toLowerCase());
  if (profile) url.searchParams.set("profile", JSON.stringify(profile));
  return url.toString();
}

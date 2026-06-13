import type { PlayerProfile } from "./types";

// Single source of truth for the localStorage key the world build also reads.
export const PROFILE_KEY = "playerProfile";
export const COUNTRY_KEY = "selectedCountry";

export function saveProfile(profile: PlayerProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function loadProfile(): PlayerProfile | null {
  const raw = localStorage.getItem(PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlayerProfile;
  } catch {
    // Corrupt JSON — treat as no profile rather than crashing the app.
    return null;
  }
}

// Patch a subset of the stored profile (used by the handoff seam to set the
// trip's target language from the chosen country).
export function patchProfile(patch: Partial<PlayerProfile>): void {
  const current = loadProfile();
  if (!current) return;
  saveProfile({ ...current, ...patch });
}

export function saveSelectedCountry(country: string): void {
  localStorage.setItem(COUNTRY_KEY, country);
}

export function loadSelectedCountry(): string | null {
  return localStorage.getItem(COUNTRY_KEY);
}

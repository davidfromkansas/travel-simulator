// ============================================================================
// CONTRACT #1: PLAYER PROFILE
// This is the exact shape the WORLD BUILD reads from localStorage["playerProfile"].
// Do not change field names/shape without coordinating with the world build.
// ============================================================================

export type LanguageLevel = "beginner" | "advanced"; // binary toggle, NOT a scale

export interface PlayerLanguages {
  native: string[];
  learning: string; // target language for the trip (e.g. "Italian")
  level: LanguageLevel;
}

export interface PlayerProfile {
  name: string;
  nationality: string;
  occupation: string;
  interests: string[];
  travelStyle: string;
  languages: PlayerLanguages;
}

// Client-side navigation state. Not server routes.
export type AppView = "onboarding" | "globe" | "scene";

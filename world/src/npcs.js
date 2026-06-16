// ---------------------------------------------------------------------------
// npcs.js — DATA: country/language → the cast that stands in the town.
//
// Pure module: no THREE, no DOM, no I/O. Given a language + level + spawn,
// it returns plain NPC descriptors. main.js turns those into models, bubbles,
// and conversations; api/chat.js is the brain. Adding a country = adding one
// kit to PLACE_KITS — nothing else here changes.
//
// The cast (who's there, what they say) is DERIVED FROM THE LANGUAGE. Positions
// come from a generic arc layout, never hand-measured coordinates. (Optional
// per-town `stations` overrides are supported but must be named, commented, and
// visually verified — see castForLanguage. None are baked in by default.)
// ---------------------------------------------------------------------------

// NPC character models live in public/models/. These are rigged glTF like the
// player (NOT the player — additional people layered onto the splat). Each gets
// its own AnimationMixer in main.js, which resolves the idle clip case-insensitively.
//
// We use the rigged humanoid (casual.glb — a civilian, already animated) for the
// whole cast and make each NPC read as a DIFFERENT person via a per-NPC look
// (clothing tint + height), applied in main.js. The player is left untinted, so
// the NPCs are also clearly distinct from you. (To swap in real per-role
// character models later: drop GLBs in public/models/npcs/ and set `model` here.)
// The model is fetched from Vercel Blob at runtime (see assets.js), not git.
import { asset } from "./assets.js";
const NPC_MODEL = asset("/models/casual.glb");

// One look per role (same order as kit.roles): distinct hue + slight height
// difference so the three read as separate people at a glance.
const PERSON_LOOKS = [
  { tint: "#3f7d5a", scale: 0.97 }, // green
  { tint: "#9c3b34", scale: 1.08 }, // deep red, a touch taller
  { tint: "#2f5d8a", scale: 0.90 }, // blue, a touch shorter
  { tint: "#8a6d3b", scale: 1.02 }, // ochre
  { tint: "#6b3f7a", scale: 0.94 }, // plum
];

// Place kits, keyed by language (matching profile.languages.learning). Each kit
// is a country's cast: an accent colour for the speech bubbles plus the roles
// that populate a plausible town — vendor, host, barista. Their greetings are
// shown instantly on approach with zero network (see §4.2), so first contact is
// free and snappy; only the player's replies hit /api/chat.
export const PLACE_KITS = {
  Italian: {
    language: "Italian",
    accent: "#8ad58a", // soft green — bubble accent
    roles: [
      {
        role: "Gelato vendor",
        name: "Giulia",
        persona:
          "A sunny gelateria vendor. Loves helping you pick a flavour, very encouraging.",
        greeting: "Ciao! Che gusto ti va oggi?",
        greeting_en: "Hi! What flavour do you fancy today?",
      },
      {
        role: "Trattoria host",
        name: "Marco",
        persona:
          "A warm trattoria host seating guests outdoors. Jovial, proud of the kitchen.",
        greeting: "Buonasera! Tavolo per uno?",
        greeting_en: "Good evening! Table for one?",
      },
      {
        role: "Barista",
        name: "Sofia",
        persona:
          "A brisk, friendly espresso-bar barista. Quick and cheerful.",
        greeting: "Ciao! Un caffè al volo?",
        greeting_en: "Hi! A quick coffee?",
      },
    ],
  },

  Japanese: {
    language: "Japanese",
    accent: "#ff6b9d", // neon pink — bubble accent
    roles: [
      {
        role: "Izakaya master",
        name: "Haruto",
        persona:
          "A cheerful izakaya master behind a smoky yakitori grill. Warm, a little gruff, proud of his skewers.",
        greeting: "いらっしゃい！焼き鳥どう？",
        greeting_en: "Welcome! How about some yakitori?",
      },
      {
        role: "Ramen shop owner",
        name: "Yui",
        persona:
          "A friendly ramen shop owner who loves recommending her tonkotsu broth. Energetic and kind.",
        greeting: "こんばんは！ラーメン食べていく？",
        greeting_en: "Good evening! Staying for some ramen?",
      },
      {
        role: "Konbini clerk",
        name: "Ren",
        persona:
          "A polite, slightly sleepy late-shift convenience-store clerk. Helpful and unfailingly courteous.",
        greeting: "いらっしゃいませ！何かお探しですか？",
        greeting_en: "Welcome! Are you looking for something?",
      },
      {
        role: "Takoyaki vendor",
        name: "Aoi",
        persona:
          "A bubbly street takoyaki vendor flipping batter at her stall. Playful and chatty.",
        greeting: "たこ焼きいかが？できたてだよ！",
        greeting_en: "Fancy some takoyaki? Fresh off the grill!",
      },
      {
        role: "Local student",
        name: "Mei",
        persona:
          "A friendly local university student heading to the crossing. Curious about travellers, happy to give directions.",
        greeting: "あ、こんばんは！スクランブル交差点、見に行く？",
        greeting_en: "Oh, hi! Heading to the scramble crossing?",
      },
    ],
  },
};

// Case-insensitive lookup with an Italian fallback so the demo always runs even
// if a profile arrives with an unexpected language string.
export function kitForLanguage(language) {
  if (language) {
    const key = Object.keys(PLACE_KITS).find(
      (k) => k.toLowerCase() === String(language).toLowerCase()
    );
    if (key) return PLACE_KITS[key];
  }
  return PLACE_KITS.Italian;
}

// Lay N NPCs on an arc in front of spawn. R and SPREAD are layout CONSTANTS,
// not coordinates measured from one specific town. `facing` (radians) is the
// direction the arc fans out toward — main.js derives it from the world bounds,
// so this stays town-agnostic. Y is left at 0 and resolved by ground-snap.
export function arcPositions(n, spawn, facing = 0) {
  const R = 4.2;
  const SPREAD = Math.PI * 0.75;
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const angle = facing + t * SPREAD;
    return [spawn.x + Math.sin(angle) * R, 0, spawn.z - Math.cos(angle) * R];
  });
}

// Build the cast for a language. `spawn` is { x, z, facing? } — the player's
// start point and the direction the arc should open toward. Returns an array of
// plain NPC descriptors ready for main.js to instantiate.
//
// Optional per-town placement: if you have VISUALLY-VERIFIED venue positions,
// pass `spawn.stations` as an array of [x, z] (each tied to a real feature and
// commented at the call site). When present and long enough it overrides the
// arc; otherwise we use the derived arc rather than guess coordinates.
export function castForLanguage(language, level, spawn) {
  const kit = kitForLanguage(language);
  const roles = kit.roles;
  const lvl = level || "beginner";

  const stations = spawn && spawn.stations;
  const positions =
    Array.isArray(stations) && stations.length >= roles.length
      ? stations.map(([x, z]) => [x, 0, z])
      : arcPositions(roles.length, spawn, spawn ? spawn.facing : 0);

  return roles.map((r, i) => ({
    id: `npc-${i}`,
    name: r.name,
    role: r.role,
    persona: r.persona,
    language: kit.language,
    level: lvl,
    greeting: r.greeting,
    greeting_en: r.greeting_en,
    modelUrl: NPC_MODEL,
    look: PERSON_LOOKS[i % PERSON_LOOKS.length],
    pos: positions[i],
    accent: kit.accent,
  }));
}

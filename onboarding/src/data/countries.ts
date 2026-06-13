// Supported destinations. Markers are rendered ONLY for entries listed here.
// Each country maps to a lat/lng (for placing the glowing marker on the globe)
// and the target language the world build should use for the trip.

export interface Country {
  id: string; // lowercase key passed to enterCountry(), e.g. "italy"
  name: string; // display label
  lat: number;
  lng: number;
  language: string; // target "learning" language for this destination
  flag: string;
  enabled: boolean; // false => "coming soon" (rendered dimmed, not clickable)
}

export const COUNTRIES: Country[] = [
  // The hero destination for the demo.
  { id: "italy", name: "Italy", lat: 41.9, lng: 12.5, language: "Italian", flag: "🇮🇹", enabled: true },

  // Additional supported markers (polish). They route through the same seam
  // and land on the placeholder scene until the world build adds their towns.
  { id: "japan", name: "Japan", lat: 36.2, lng: 138.2, language: "Japanese", flag: "🇯🇵", enabled: true },
  { id: "france", name: "France", lat: 46.6, lng: 2.2, language: "French", flag: "🇫🇷", enabled: true },
  { id: "spain", name: "Spain", lat: 40.4, lng: -3.7, language: "Spanish", flag: "🇪🇸", enabled: true },
  { id: "mexico", name: "Mexico", lat: 23.6, lng: -102.5, language: "Spanish", flag: "🇲🇽", enabled: true },
];

export function getCountry(id: string): Country | undefined {
  return COUNTRIES.find((c) => c.id === id.toLowerCase());
}

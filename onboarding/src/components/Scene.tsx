import { useState } from "react";
import { getCountry } from "../data/countries";
import { loadProfile } from "../storage";
import { townUrlFor, type WorldMode } from "../world";
import TownFrame from "./TownFrame";

interface Props {
  country: string;
  onChangeDestination: () => void;
}

// The scene the player enters after the globe. If the world build has a town for
// this country, it mounts in-page (TownFrame). Otherwise we show a placeholder
// that confirms the handoff worked + dumps the live profile.
export default function Scene({ country, onChangeDestination }: Props) {
  const meta = getCountry(country);
  const profile = loadProfile();

  // Default to the photoreal splat (the actual captured scene); the toggle in
  // TownFrame flips this, which re-points the iframe at the chosen world.
  const [worldMode, setWorldMode] = useState<WorldMode>("splat");

  // World build is ready for this country → drop straight into the town.
  const townSrc = townUrlFor(country, profile, worldMode);
  if (townSrc) {
    return (
      <TownFrame
        src={townSrc}
        countryName={meta?.name ?? country}
        onChangeDestination={onChangeDestination}
        worldMode={worldMode}
        onToggleWorld={() =>
          setWorldMode((m) => (m === "splat" ? "town" : "splat"))
        }
      />
    );
  }

  // Fallback placeholder (countries whose town isn't built yet).
  return (
    <div className="scene">
      <div className="scene-card">
        <div className="scene-flag">{meta?.flag ?? "🌍"}</div>
        <h1>Welcome to {meta?.name ?? country}</h1>
        <p className="subtitle">
          You'll be practicing <strong>{profile?.languages.learning ?? "—"}</strong>{" "}
          ({profile?.languages.level}) here.
        </p>

        <div className="scene-note">
          <strong>World-build mount point.</strong> The town for{" "}
          <code>{country}</code> isn't built yet. The player profile is live in{" "}
          <code>localStorage["playerProfile"]</code>.
        </div>

        {profile && (
          <pre className="profile-dump">{JSON.stringify(profile, null, 2)}</pre>
        )}

        <button className="primary ghost" onClick={onChangeDestination}>
          ← Change destination
        </button>
      </div>
    </div>
  );
}

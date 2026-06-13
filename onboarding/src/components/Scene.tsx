import { getCountry } from "../data/countries";
import { loadProfile } from "../storage";
import { townUrlFor } from "../world";
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

  // World build is ready for this country → drop straight into the town.
  const townSrc = townUrlFor(country, profile);
  if (townSrc) {
    return (
      <TownFrame
        src={townSrc}
        countryName={meta?.name ?? country}
        onChangeDestination={onChangeDestination}
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

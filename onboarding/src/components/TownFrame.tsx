import { useRef, useState } from "react";
import type { WorldMode } from "../world";

interface Props {
  src: string;
  countryName: string;
  onChangeDestination: () => void;
  worldMode: WorldMode;
  onToggleWorld: () => void;
}

// Mounts the world build's town in-page via an iframe. Keeps the experience
// seamless (the globe view simply swaps to this — no full-page navigation) while
// the town remains its own independent build. Replace with a direct mount once
// the two builds share one origin/renderer.
export default function TownFrame({
  src,
  countryName,
  onChangeDestination,
  worldMode,
  onToggleWorld,
}: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="townframe">
      {!loaded && (
        <div className="town-loading">Arriving in {countryName}…</div>
      )}
      <iframe
        ref={frameRef}
        title={`${countryName} town`}
        // Re-keying on src forces a fresh load when the world mode flips, so the
        // iframe actually swaps scenes rather than reusing the old document.
        key={src}
        src={src}
        className="town-iframe"
        allow="fullscreen; gamepad; accelerometer; xr-spatial-tracking"
        onLoad={() => {
          setLoaded(true);
          // Hand keyboard focus to the town so WASD/arrows work immediately.
          frameRef.current?.focus();
        }}
      />
      <div className="town-controls">
        <button className="town-back" onClick={onChangeDestination}>
          ← Change destination
        </button>
        <button
          className="town-toggle"
          onClick={() => {
            // The new scene reloads; show the loader until it's ready.
            setLoaded(false);
            onToggleWorld();
          }}
          title={
            worldMode === "splat"
              ? "Showing the real captured scene — switch to the low-poly model"
              : "Showing the low-poly model — switch to the real captured scene"
          }
        >
          {worldMode === "splat" ? "🧱 Show model" : "📷 Show real scene"}
        </button>
      </div>
    </div>
  );
}

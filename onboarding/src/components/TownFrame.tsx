import { useRef, useState } from "react";

interface Props {
  src: string;
  countryName: string;
  onChangeDestination: () => void;
}

// Mounts the world build's town in-page via an iframe. Keeps the experience
// seamless (the globe view simply swaps to this — no full-page navigation) while
// the town remains its own independent build. Replace with a direct mount once
// the two builds share one origin/renderer.
export default function TownFrame({ src, countryName, onChangeDestination }: Props) {
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
        src={src}
        className="town-iframe"
        allow="fullscreen; gamepad; accelerometer; xr-spatial-tracking"
        onLoad={() => {
          setLoaded(true);
          // Hand keyboard focus to the town so WASD/arrows work immediately.
          frameRef.current?.focus();
        }}
      />
      <button className="town-back" onClick={onChangeDestination}>
        ← Change destination
      </button>
    </div>
  );
}

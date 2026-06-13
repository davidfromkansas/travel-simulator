import { useEffect, useState } from "react";
import type { AppView } from "./types";
import { loadProfile, loadSelectedCountry } from "./storage";
import { registerSceneHandler, enterCountry } from "./handoff";
import Onboarding from "./components/Onboarding";
import Globe from "./components/Globe";
import Scene from "./components/Scene";
import "./App.css";

export default function App() {
  // Hydrate from localStorage so a refresh never wipes progress.
  const [view, setView] = useState<AppView>(() =>
    loadProfile() ? "globe" : "onboarding"
  );
  const [country, setCountry] = useState<string>(() => loadSelectedCountry() ?? "");

  // Wire the handoff seam to our view state. enterCountry() (in handoff.ts)
  // calls this => seamless globe→scene transition, no reload.
  useEffect(() => {
    registerSceneHandler((c) => {
      setCountry(c);
      setView("scene");
    });
    // Dev-only: lets the world-build team (and smoke tests) trigger the real
    // handoff seam from the console, e.g. window.enterCountry("italy").
    if (import.meta.env.DEV) {
      (window as unknown as { enterCountry: typeof enterCountry }).enterCountry =
        enterCountry;
    }
  }, []);

  return (
    <div className="app">
      {view === "onboarding" && <Onboarding onDone={() => setView("globe")} />}
      {view === "globe" && <Globe />}
      {view === "scene" && (
        <Scene country={country} onChangeDestination={() => setView("globe")} />
      )}
    </div>
  );
}

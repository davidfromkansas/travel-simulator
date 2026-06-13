import { useState } from "react";
import type { PlayerProfile, LanguageLevel } from "../types";
import { saveProfile } from "../storage";

interface Props {
  onDone: () => void;
}

// Fast 8-field form. A judge should be able to blow through it to reach the globe.
export default function Onboarding({ onDone }: Props) {
  const [name, setName] = useState("David");
  const [nationality, setNationality] = useState("American");
  const [occupation, setOccupation] = useState("Product manager");
  const [interests, setInterests] = useState("specialty coffee, vintage, food");
  const [travelStyle, setTravelStyle] = useState("wanders, eats local, off the beaten path");
  const [nativeLang, setNativeLang] = useState("English");
  const [learning, setLearning] = useState("Italian");
  const [level, setLevel] = useState<LanguageLevel>("beginner");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const profile: PlayerProfile = {
      name: name.trim(),
      nationality: nationality.trim(),
      occupation: occupation.trim(),
      interests: interests
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      travelStyle: travelStyle.trim(),
      languages: {
        native: nativeLang
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        learning: learning.trim(),
        level,
      },
    };
    saveProfile(profile);
    onDone();
  }

  return (
    <div className="onboarding">
      <form className="card" onSubmit={handleSubmit}>
        <h1>Before you travel</h1>
        <p className="subtitle">Tell us who's going. This shapes who you'll meet.</p>

        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <div className="row">
          <label>
            Nationality
            <input value={nationality} onChange={(e) => setNationality(e.target.value)} />
          </label>
          <label>
            Occupation
            <input value={occupation} onChange={(e) => setOccupation(e.target.value)} />
          </label>
        </div>

        <label>
          Interests <span className="hint">comma separated</span>
          <input value={interests} onChange={(e) => setInterests(e.target.value)} />
        </label>

        <label>
          Travel style
          <input value={travelStyle} onChange={(e) => setTravelStyle(e.target.value)} />
        </label>

        <div className="row">
          <label>
            Native language(s) <span className="hint">comma separated</span>
            <input value={nativeLang} onChange={(e) => setNativeLang(e.target.value)} />
          </label>
          <label>
            Learning
            <input value={learning} onChange={(e) => setLearning(e.target.value)} />
          </label>
        </div>

        <div className="level-toggle">
          <span>Level</span>
          <div className="toggle">
            <button
              type="button"
              className={level === "beginner" ? "active" : ""}
              onClick={() => setLevel("beginner")}
            >
              Beginner
            </button>
            <button
              type="button"
              className={level === "advanced" ? "active" : ""}
              onClick={() => setLevel("advanced")}
            >
              Advanced
            </button>
          </div>
        </div>

        <button type="submit" className="primary">
          Save &amp; pick a destination →
        </button>
      </form>
    </div>
  );
}

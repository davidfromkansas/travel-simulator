import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { castForLanguage } from "./npcs.js";
import { buildTown } from "./town.js";
import { asset } from "./assets.js";
window.THREE = THREE; // debug handle

// Several NPCs may share a character model — cache the fetched glTF so we only
// download each file once (each NPC still gets its own parsed scene + mixer).
THREE.Cache.enabled = true;

// Which world to render: the photoreal Gaussian splat ("splat") — the actual
// captured Italian scene — or the stylized low-poly Three.js piazza ("town").
// Defaults to the splat; ?world=town switches to the lightweight piazza.
const WORLD_MODE = new URLSearchParams(location.search).get("world") === "town" ? "town" : "splat";

// When embedded in the onboarding app (iframe), that app owns the world-mode
// toggle (next to "Change destination"), so we hide the in-iframe one to avoid
// two competing toggles stacked in the same corner.
const EMBEDDED = window.self !== window.top;

// Baked NPC positions for the splat world (set after placing them with the
// "Move NPCs" tool). null → fall back to the generic arc layout. Order matches
// the kit's roles (gelato vendor → trattoria host → barista).
const SPLAT_STATIONS = [
  [-4.09, -0.93], // Giulia (gelato) — arc spot
  [1.22, 2.25],   // Marco (trattoria) — placed out of the fountain
  [3.56, -2.23],  // Sofia (barista) — arc spot
];

// Accelerate raycasts with a BVH. The movement loop fires ~8 rays/frame against
// the collider mesh; without this they brute-force every triangle (stutter).
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ---------------------------------------------------------------------------
// Asset paths. These big binaries are fetched from Vercel Blob at runtime (not
// committed to git) — see src/assets.js for the base URL + how to override it.
//   - draft1.spz      the Gaussian splat the town is rendered from
//   - draft1.glb      Marble's collider mesh (used for ground + walls)
// The character is a standard rigged glTF with Idle / Walk / Run clips.
// ---------------------------------------------------------------------------
const ASSETS = {
  splat: asset("/worlds/draft1.spz"),
  collider: asset("/worlds/draft1.glb"),
  character: asset("/models/casual.glb"),
};

// Tunables ------------------------------------------------------------------
// The Marble town is generated at roughly half real-world scale, so the
// character (a real 1.8m) is shrunk to fit. Most heights below derive from
// CHAR_H so everything stays consistent if you change CHARACTER_SCALE.
const CHARACTER_SCALE = 0.5;          // shrink the 1.81m model to fit the town
const CHAR_H = 1.81 * CHARACTER_SCALE; // resulting character height (~0.9m)

const WALK_SPEED = 1.6;        // metres / second
const RUN_SPEED = 3.4;
const TURN_SPEED = 2.6;        // radians / second (← →)

// Foot-slide control (Task 2): match clip cadence to ground speed via timeScale.
// casual.glb's walk/run clips are IN-PLACE (zero root translation — measured), so
// their ground-equivalent speed can't be read from root motion. These are
// eyeball placeholders. TODO: calibrate from foot-bone travel per cycle if exact
// foot-lock is wanted — do not treat these as verified.
const CLIP_WALK_SPEED = 1.4; // TODO: calibrate (in-place clip; placeholder)
const CLIP_RUN_SPEED = 3.2;  // TODO: calibrate (in-place clip; placeholder)
const BODY_RADIUS = CHAR_H * 0.28;   // how close the character can get to a wall
const CAMERA_DIST = CHAR_H * 2.6;    // how far the camera trails behind
const CAMERA_HEIGHT = CHAR_H * 1.25;
const HEAD_H = CHAR_H * 0.9;         // eye/look-at height

// Ground-follow. STEP_UP is the most the floor can rise in one frame: the
// ground ray starts only this far above the feet, so a snap can never mount a
// wall, awning, or rooftop (that's what flung the player skyward). Drops fall
// smoothly under GRAVITY instead of teleporting.
const STEP_UP = CHAR_H * 0.6;        // max climbable step (also caps any up-snap)
const GRAVITY = 22;                  // m/s² — smooth falls off ledges

// How close you must get to an NPC to talk. Derived from CHAR_H so it scales
// with the half-scale town instead of hardcoding metres.
const TALK_RANGE = CHAR_H * 3;
const BUBBLE_H = CHAR_H * 1.25;      // speech-bubble anchor height above a head

// Keep the player inside the cleanly-reconstructed core of the splat.
// Piazza world (marble-1.1-plus): collider extent after the X-flip is
// X:[-11.6,10.0]  Z:[-13.5,4.2]. Leave ~1.5m margin off the low-detail fringe.
let BOUNDS = { minX: -10, maxX: 8.5, minZ: -11.5, maxZ: 2.7 }; // overridden in town mode
const SPLAT_ROTATION_X = 0; // draft1 export is already Y-up (the old town.spz needed Math.PI)
const DEBUG_CAM = false;

// ---------------------------------------------------------------------------
const canvas = document.getElementById("app");
const loadingEl = document.getElementById("loading");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Cap below the native retina ratio: the 65 MB splat is GPU-bound, so rendering
// at 2x quadruples fragment work. 1.25 is the biggest single FPS win here.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc3e8);

const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.35, 1000
);
camera.position.set(0, CAMERA_HEIGHT, CAMERA_DIST);

// Spark needs a SparkRenderer bound to the WebGL renderer, added to the scene.
const spark = new SparkRenderer({ renderer });
scene.add(spark);

// Lights (the splat is pre-lit, but the character needs lighting) -----------
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6b55, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(5, 10, 6);
scene.add(sun);

// Fallback ground so you can walk before adding a collider ------------------
const fallbackGround = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0x3e7d3a })
);
fallbackGround.rotation.x = -Math.PI / 2;
scene.add(fallbackGround);
const grid = new THREE.GridHelper(200, 200, 0x888888, 0x555555);
grid.position.y = 0.01;
scene.add(grid);

const loader = new GLTFLoader();
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true; // three-mesh-bvh: stop at closest hit (we only use [0])
const DOWN = new THREE.Vector3(0, -1, 0);

let colliderMeshes = [fallbackGround]; // raycast targets for ground/walls
let townStations = null; // NPC venue positions when the Three.js town is active
let townGroup = null;    // the Three.js town root (for GLB export to Marble Studio)

// --- Load splat town -------------------------------------------------------
let townSplat = null;
// Vertical nudge to seat the splat's visual ground exactly on the collider you
// walk on (Marble exports the splat and collider with a small floor offset).
// Tune live with [ / ] in splat mode, then bake the value here.
let splatOffsetY = -0.08; // draft1: seats the splat ground onto the collider
async function loadSplat() {
  try {
    const splat = new SplatMesh({ url: ASSETS.splat });
    await splat.initialized;
    splat.rotation.x = SPLAT_ROTATION_X;
    splat.position.y = splatOffsetY;
    scene.add(splat);
    townSplat = splat;
    grid.visible = false;
    fallbackGround.visible = false;
  } catch (e) {
    console.warn("No town.spz yet — showing placeholder grid.", e);
  }
}

// --- Load collider mesh (invisible, used for physics) ----------------------
async function loadCollider() {
  try {
    const gltf = await loader.loadAsync(ASSETS.collider);
    const root = gltf.scene;
    root.rotation.x = SPLAT_ROTATION_X; // match the splat orientation
    const meshes = [];
    root.traverse((o) => {
      if (o.isMesh) {
        o.visible = false;       // colliders are invisible
        o.geometry.computeBoundsTree(); // BVH for fast raycasts
        meshes.push(o);
      }
    });
    scene.add(root);
    if (meshes.length) colliderMeshes = meshes;
  } catch (e) {
    console.warn("No collider.glb yet — walking on flat fallback ground.", e);
  }
}

// --- Load character --------------------------------------------------------
const character = new THREE.Group();
scene.add(character);
let mixer = null;
const actions = {};
let active = null;

function play(name) {
  if (active === actions[name] || !actions[name]) return;
  const next = actions[name];
  next.reset().fadeIn(0.2).play();
  if (active) active.fadeOut(0.2);
  active = next;
}

async function loadCharacter() {
  const gltf = await loader.loadAsync(ASSETS.character);
  const model = gltf.scene;
  model.scale.setScalar(CHARACTER_SCALE);
  model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  character.add(model);

  mixer = new THREE.AnimationMixer(model);
  for (const clip of gltf.animations) {
    actions[clip.name] = mixer.clipAction(clip);
  }
  // Match clip cadence to ground speed so the feet don't skate (Task 2).
  if (actions.walk) actions.walk.timeScale = WALK_SPEED / (CLIP_WALK_SPEED * CHARACTER_SCALE);
  if (actions.run) actions.run.timeScale = RUN_SPEED / (CLIP_RUN_SPEED * CHARACTER_SCALE);
  // casual.glb (Xbot) ships: idle, walk, run (+ others)
  play("idle");
}

// ===========================================================================
// NPCs — locals you can walk up to and talk with, in the target language.
// Purely additive: separate rigged-glTF characters layered on top of the splat
// (the town/player are untouched). Greetings are instant + local; only the
// player's replies hit /api/chat.
// ===========================================================================

// --- Profile (the world is launched with ?profile=<json> & ?country=) -------
// Read language + level so the cast and the brain are calibrated to the player,
// plus the player's identity/interests so NPCs can talk to them as a person.
// Falls back to the country default + beginner if the world is opened directly.
const COUNTRY_DEFAULT_LANGUAGE = { italy: "Italian" };
const str = (v) => (typeof v === "string" ? v.trim() : "");
const strArr = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()) : []);
function readProfile() {
  const params = new URLSearchParams(location.search);
  const country = (params.get("country") || "italy").toLowerCase();
  let language = COUNTRY_DEFAULT_LANGUAGE[country] || "Italian";
  let level = "beginner";
  let player = null; // the rest of the onboarding answers, for the NPC brain
  const raw = params.get("profile");
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p?.languages?.learning) language = p.languages.learning;
      if (p?.languages?.level) level = p.languages.level;
      // Keep the whole person (name, where they're from, what they're into) so
      // NPCs can greet by name and lean into interests — not just language/level.
      const built = {
        name: str(p?.name),
        nationality: str(p?.nationality),
        occupation: str(p?.occupation),
        interests: strArr(p?.interests),
        travelStyle: str(p?.travelStyle),
        nativeLanguages: strArr(p?.languages?.native),
      };
      // Only keep it if at least one field is non-empty (a directly-opened
      // world has no profile → leave player null so the brain skips the block).
      if (Object.values(built).some((v) => (Array.isArray(v) ? v.length : v))) {
        player = built;
      }
    } catch (e) {
      console.warn("Could not parse ?profile= — using defaults.", e);
    }
  }
  return { country, language, level, player };
}
const PROFILE = readProfile();

// --- Speech-bubble + HUD DOM (created in JS so index.html stays untouched) --
const npcStyle = document.createElement("style");
npcStyle.textContent = `
  .bubble {
    position: fixed; max-width: 260px; transform: translate(-50%, -100%);
    background: rgba(15,17,22,0.86); color: #fff; padding: 8px 11px;
    border-radius: 12px; border: 1px solid rgba(255,255,255,0.18);
    font-size: 13px; line-height: 1.4; pointer-events: none;
    backdrop-filter: blur(4px); white-space: pre-wrap; z-index: 5;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
  }
  .bubble .en { display:block; margin-top:3px; font-size:11px; color:#b9c0cc; }
  .bubble .fix { display:block; margin-top:4px; font-size:11px; color:#ffd24a; }
  #npc-hint {
    position: fixed; transform: translate(-50%, 0); margin-top: 6px;
    background: rgba(0,0,0,0.6); color:#fff; padding:4px 9px; border-radius:8px;
    font-size:12px; pointer-events:none; z-index:6; white-space:nowrap;
  }
  #npc-hint b { color:#ffd24a; }
  #reply-bar {
    position: fixed; left:50%; bottom:84px; transform: translateX(-50%);
    width: min(540px, 92vw); z-index:7; display:none;
  }
  #reply-bar input {
    width:100%; box-sizing:border-box; padding:11px 14px; border-radius:12px;
    border:1px solid rgba(255,255,255,0.25); background:rgba(15,17,22,0.92);
    color:#fff; font-size:15px; outline:none;
  }
  #reply-suggest { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; justify-content:center; }
  #reply-suggest button {
    background:rgba(255,255,255,0.1); color:#dfe5ee; border:1px solid rgba(255,255,255,0.2);
    border-radius:999px; padding:4px 10px; font-size:12px; cursor:pointer;
  }
  #reply-suggest button:hover { background:rgba(255,255,255,0.2); }
  #npc-toggle {
    position: fixed; right:16px; top:16px; z-index:7;
    background:rgba(0,0,0,0.5); color:#fff; border:1px solid rgba(255,255,255,0.2);
    border-radius:8px; padding:6px 10px; font-size:12px; cursor:pointer;
    backdrop-filter: blur(6px);
  }
`;
document.head.appendChild(npcStyle);

// --- FPS counter (top-right, stacked under the English toggle) --------------
// A small monospace badge with a health dot: green ≥50, amber ≥30, red below.
// FPS is measured from real frame times (not the movement dt, which is clamped),
// smoothed with an EMA, and written to the DOM ~4×/sec to avoid layout churn.
const fpsEl = document.createElement("div");
fpsEl.style.cssText =
  "position:fixed;right:16px;top:52px;z-index:7;display:flex;align-items:center;gap:7px;" +
  "background:rgba(0,0,0,0.5);color:#fff;border:1px solid rgba(255,255,255,0.2);" +
  "border-radius:8px;padding:6px 10px;font:600 12px ui-monospace,SFMono-Regular,Menlo,monospace;" +
  "backdrop-filter:blur(6px);pointer-events:none;";
const fpsDot = document.createElement("span");
fpsDot.style.cssText =
  "width:8px;height:8px;border-radius:50%;background:#7ee787;color:#7ee787;box-shadow:0 0 6px currentColor;";
const fpsText = document.createElement("span");
fpsText.textContent = "— fps";
fpsEl.append(fpsDot, fpsText);
document.body.appendChild(fpsEl);

let fpsLast = performance.now();
let fpsAvg = 60;        // EMA of instantaneous fps
let fpsSince = 0;       // ms since last DOM write
function updateFps() {
  const now = performance.now();
  const frameMs = now - fpsLast;
  fpsLast = now;
  if (frameMs > 0) fpsAvg += (1000 / frameMs - fpsAvg) * 0.1;
  fpsSince += frameMs;
  if (fpsSince >= 250) {
    const fps = Math.round(fpsAvg);
    const color = fps >= 50 ? "#7ee787" : fps >= 30 ? "#f0c674" : "#ff7b72";
    fpsText.textContent = fps + " fps";
    fpsText.style.color = color;
    fpsDot.style.color = color;
    fpsDot.style.background = color;
    fpsSince = 0;
  }
}

function makeBubble() {
  const el = document.createElement("div");
  el.className = "bubble";
  el.style.display = "none";
  document.body.appendChild(el);
  return el;
}
const npcBubble = makeBubble();    // the active NPC's line, over its head
const playerBubble = makeBubble(); // what you said + coaching, over your head

const hintEl = document.createElement("div");
hintEl.id = "npc-hint";
hintEl.style.display = "none";
document.body.appendChild(hintEl);

const replyBar = document.createElement("div");
replyBar.id = "reply-bar";
const replyInput = document.createElement("input");
replyInput.type = "text";
replyInput.setAttribute("placeholder", `Type your reply in ${PROFILE.language}…`);
const replySuggest = document.createElement("div");
replySuggest.id = "reply-suggest";
replyBar.appendChild(replyInput);
replyBar.appendChild(replySuggest);
document.body.appendChild(replyBar);

// Translation crutch: show the English lines. Defaults ON for beginners.
let showEnglish = PROFILE.level !== "advanced";
const toggleEl = document.createElement("button");
toggleEl.id = "npc-toggle";
function refreshToggleLabel() {
  toggleEl.textContent = showEnglish ? "English: on" : "English: off";
}
refreshToggleLabel();
toggleEl.addEventListener("click", () => {
  showEnglish = !showEnglish;
  refreshToggleLabel();
  rerenderActiveBubbles();
});
document.body.appendChild(toggleEl);

// --- NPC runtime state ------------------------------------------------------
let npcObjs = [];                 // { id, def, pos, root, mixer, yaw }
const npcHistories = new Map();   // id -> [{ role, content }]   (per-NPC memory)
const greeted = new Set();        // ids that have been greeted
const lastNpcLine = new Map();    // id -> { reply, reply_en } (for re-show)
const lastPlayerCoach = new Map();// id -> { text, your_en, correction }
let activeNpcId = null;
let talking = false;

// --- DOM projection: world point -> screen, hide if behind camera ----------
const _proj = new THREE.Vector3();
function place(el, x, y, z) {
  _proj.set(x, y, z).project(camera);
  if (_proj.z > 1) { el.style.display = "none"; return; }
  el.style.display = "block";
  el.style.left = `${(_proj.x * 0.5 + 0.5) * window.innerWidth}px`;
  el.style.top = `${(-_proj.y * 0.5 + 0.5) * window.innerHeight}px`;
}

function npcById(id) { return npcObjs.find((n) => n.id === id); }

// --- Bubble rendering -------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}
function renderNpcBubble(def, line) {
  const accent = def ? def.accent : "#8ad58a";
  npcBubble.style.borderColor = accent;
  let html = escapeHtml(line.reply || "…");
  if (showEnglish && line.reply_en) html += `<span class="en">${escapeHtml(line.reply_en)}</span>`;
  npcBubble.innerHTML = html;
}
function renderPlayerBubble(coach) {
  let html = escapeHtml(coach.text || "");
  if (showEnglish && coach.your_en) html += `<span class="en">${escapeHtml(coach.your_en)}</span>`;
  if (coach.correction) html += `<span class="fix">✏️ ${escapeHtml(coach.correction)}</span>`;
  playerBubble.innerHTML = html;
}
function rerenderActiveBubbles() {
  if (activeNpcId) {
    const line = lastNpcLine.get(activeNpcId);
    if (line) renderNpcBubble(npcById(activeNpcId)?.def, line);
    const coach = lastPlayerCoach.get(activeNpcId);
    if (coach && playerBubble.style.display !== "none") renderPlayerBubble(coach);
  }
}

// --- Talk mode --------------------------------------------------------------
function renderSuggestions(list) {
  replySuggest.innerHTML = "";
  (list || []).slice(0, 3).forEach((s) => {
    const b = document.createElement("button");
    b.textContent = s;
    b.addEventListener("click", () => { replyInput.value = s; replyInput.focus(); });
    replySuggest.appendChild(b);
  });
}
function enterTalk() {
  if (!activeNpcId) return;
  talking = true;
  replyBar.style.display = "block";
  renderSuggestions(lastNpcLine.get(activeNpcId)?.suggestions);
  replyInput.value = "";
  replyInput.focus();
}
function exitTalk() {
  talking = false;
  replyBar.style.display = "none";
  if (document.activeElement === replyInput) replyInput.blur();
}

async function sendReply() {
  const text = replyInput.value.trim();
  const id = activeNpcId;
  if (!text || !id) return;
  const def = npcById(id)?.def;
  if (!def) return;

  // 1. Show the player's own line immediately; leave talk mode so you can walk.
  const coach = { text, your_en: "", correction: "" };
  lastPlayerCoach.set(id, coach);
  renderPlayerBubble(coach);
  playerBubble.style.display = "block";
  exitTalk();

  // 2. Record the turn; show a thinking bubble on the NPC.
  const history = npcHistories.get(id);
  history.push({ role: "user", content: text });
  const thinking = { reply: "…", reply_en: "", suggestions: [] };
  lastNpcLine.set(id, thinking);
  if (activeNpcId === id) renderNpcBubble(def, thinking);

  // 3. Call the brain.
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        history,
        language: def.language,
        level: def.level,
        npc: { name: def.name, persona: def.persona },
        player: PROFILE.player || undefined, // who the traveler is (optional)
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    history.push({ role: "assistant", content: data.reply });
    const line = { reply: data.reply, reply_en: data.reply_en, suggestions: data.suggestions };
    lastNpcLine.set(id, line);
    const fullCoach = { text, your_en: data.your_en, correction: data.correction };
    lastPlayerCoach.set(id, fullCoach);

    // 4. Guard late responses: only paint the screen if still talking to this NPC.
    if (activeNpcId === id) {
      renderNpcBubble(def, line);
      renderPlayerBubble(fullCoach);
      playerBubble.style.display = "block";
      if (talking) renderSuggestions(data.suggestions);
    }
  } catch (err) {
    // 5. Never crash the loop — surface the error in the NPC bubble.
    const errLine = { reply: `⚠️ ${err.message}`, reply_en: "", suggestions: [] };
    lastNpcLine.set(id, errLine);
    if (activeNpcId === id) renderNpcBubble(def, errLine);
    console.error("Chat request failed:", err);
  }
}

// E to talk; Esc / blur to leave (walking out of range ends it — see tick).
addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") {
    if (e.code === "Enter") { e.preventDefault(); sendReply(); }
    else if (e.code === "Escape") { e.preventDefault(); exitTalk(); }
    return;
  }
  if (e.code === "KeyE" && activeNpcId && !talking) { e.preventDefault(); enterTalk(); }
});
replyInput.addEventListener("blur", () => { if (talking) exitTalk(); });

// --- Active-NPC transitions (greet / re-show / clear) -----------------------
function clearConversationUI() {
  npcBubble.style.display = "none";
  playerBubble.style.display = "none";
  hintEl.style.display = "none";
  exitTalk();
}
function onActiveChanged(prev, next) {
  if (next == null) { clearConversationUI(); return; }
  const obj = npcById(next);
  if (!obj) return;
  playerBubble.style.display = "none"; // fresh NPC — don't carry over the old coaching
  if (!greeted.has(next)) {
    // First contact: greet instantly, seed history with the greeting (so the
    // brain has context on the first real reply). Zero network.
    greeted.add(next);
    const def = obj.def;
    npcHistories.set(next, [{ role: "assistant", content: def.greeting }]);
    const line = { reply: def.greeting, reply_en: def.greeting_en, suggestions: [] };
    lastNpcLine.set(next, line);
    renderNpcBubble(def, line);
    npcBubble.style.display = "block";
  } else {
    // Returning: re-show this NPC's last line + the last thing you said to them.
    const line = lastNpcLine.get(next);
    if (line) { renderNpcBubble(obj.def, line); npcBubble.style.display = "block"; }
    const coach = lastPlayerCoach.get(next);
    if (coach) { renderPlayerBubble(coach); playerBubble.style.display = "block"; }
  }
}

// --- Load the cast ----------------------------------------------------------
// Pick an idle clip case-insensitively (casual.glb has "idle", Soldier.glb has
// "Idle"), falling back to the first clip so any rigged glTF animates.
function findIdleAction(mixer, clips) {
  let clip = clips.find((c) => /idle/i.test(c.name)) || clips[0];
  return clip ? mixer.clipAction(clip) : null;
}

async function loadNpcs() {
  // Derive the arc's facing from the world bounds (NOT a screenshot): point the
  // cast toward the centre of the clean walkable core so they stand in the open.
  const spawn = {
    x: character.position.x,
    z: character.position.z,
    facing: Math.atan2(
      (BOUNDS.minX + BOUNDS.maxX) / 2 - character.position.x,
      -((BOUNDS.minZ + BOUNDS.maxZ) / 2 - character.position.z)
    ),
    // In town mode, stand the locals at their built venues (verified positions),
    // overriding the generic arc — exactly the per-town `stations` data §4.4 wants.
    stations: townStations || undefined,
  };

  const cast = castForLanguage(PROFILE.language, PROFILE.level, spawn);

  for (const def of cast) {
    try {
      const gltf = await loader.loadAsync(def.modelUrl);
      const root = gltf.scene;
      // Per-NPC height so the cast aren't identical-sized clones.
      root.scale.setScalar(CHARACTER_SCALE * (def.look?.scale ?? 1));
      // Tint this instance so each NPC is a distinct person (and not the player).
      // Clone the material first — never mutate the shared one the player uses.
      const tint = def.look?.tint ? new THREE.Color(def.look.tint) : null;
      root.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        if (tint && o.material) {
          const recolor = (m) => {
            const c = m.clone();
            if (c.color) c.color.copy(tint);
            if ("metalness" in c) c.metalness = Math.min(c.metalness ?? 0, 0.15);
            if ("roughness" in c) c.roughness = Math.max(c.roughness ?? 0.5, 0.75);
            return c;
          };
          o.material = Array.isArray(o.material) ? o.material.map(recolor) : recolor(o.material);
        }
      });

      // Ground-snap onto the SAME floor the player stands on. Start the ray
      // just above an NPC's head (player floor + ~1.5 heads) so it begins below
      // any overhead collider — awnings, balconies, the trattoria roof — and
      // hits the walkable floor instead of snapping the NPC up onto a structure.
      // Fall back to the player's floor height (never world-0) if nothing's hit.
      const [x, , z] = def.pos;
      const gy = groundHeight(x, z, character.position.y + CHAR_H * 1.5);
      root.position.set(x, gy !== null ? gy : character.position.y, z);

      // Face roughly toward the player's spawn (model faces +Z; see player code).
      const yaw = Math.atan2(spawn.x - x, spawn.z - z);
      root.rotation.y = yaw;
      scene.add(root);

      const mixer = new THREE.AnimationMixer(root);
      const idle = findIdleAction(mixer, gltf.animations || []);
      if (idle) idle.play();

      npcObjs.push({ id: def.id, def, pos: { x, z }, root, mixer, yaw });
    } catch (e) {
      console.warn(`Failed to load NPC ${def.name} (${def.modelUrl})`, e);
    }
  }
  window.__npcs = npcObjs; // debug handle
}

// --- Per-frame NPC update: mixers, proximity, turn-to-face, bubbles ---------
function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
function updateNpcs(dt) {
  // Advance every NPC's idle animation (clips are per-model — own mixer each).
  for (const n of npcObjs) if (n.mixer) n.mixer.update(dt);

  // Nearest NPC within TALK_RANGE (XZ distance).
  let nearest = null;
  let nearestD2 = TALK_RANGE * TALK_RANGE;
  for (const n of npcObjs) {
    const dx = n.pos.x - character.position.x;
    const dz = n.pos.z - character.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= nearestD2) { nearestD2 = d2; nearest = n; }
  }
  const nextId = nearest ? nearest.id : null;
  if (nextId !== activeNpcId) {
    const prev = activeNpcId;
    activeNpcId = nextId;
    onActiveChanged(prev, nextId);
  }

  // Turn the active NPC to look at the player.
  if (activeNpcId) {
    const n = npcById(activeNpcId);
    if (n) {
      const target = Math.atan2(
        character.position.x - n.pos.x,
        character.position.z - n.pos.z
      );
      n.yaw = lerpAngle(n.yaw, target, Math.min(1, dt * 6));
      n.root.rotation.y = n.yaw;
    }
  }

  // Project bubbles + hint from 3D to screen each frame.
  if (activeNpcId) {
    const n = npcById(activeNpcId);
    if (n) {
      if (npcBubble.style.display !== "none") {
        place(npcBubble, n.pos.x, n.root.position.y + BUBBLE_H, n.pos.z);
      }
      if (!talking) {
        place(hintEl, n.pos.x, n.root.position.y + BUBBLE_H * 0.5, n.pos.z);
        hintEl.innerHTML = `<b>E</b> talk to ${escapeHtml(n.def.name)}`;
      } else {
        hintEl.style.display = "none";
      }
    }
  }
  if (playerBubble.style.display !== "none") {
    place(playerBubble, character.position.x, character.position.y + BUBBLE_H, character.position.z);
  }
}

// --- Input -----------------------------------------------------------------
const keys = {};
// Movement input also written by the touch joystick (Task 4); summed with the
// keyboard each frame so a single movement path serves both.
const touch = { fwd: 0, strafe: 0, run: false };
addEventListener("keydown", (e) => {
  // Ignore keys typed into the reply box so WASD etc. don't drive the player.
  if (e.target && e.target.tagName === "INPUT") return;
  keys[e.code] = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => {
  if (e.target && e.target.tagName === "INPUT") return;
  keys[e.code] = false;
});

// Splat vertical-alignment nudge (splat mode): [ lowers, ] raises the splat so
// its visual ground sits exactly on the collider. The readout shows the value
// to bake into `splatOffsetY` above.
let splatNudgeHud = null;
addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT") return;
  if ((e.code === "BracketLeft" || e.code === "BracketRight") && townSplat) {
    splatOffsetY += e.code === "BracketRight" ? 0.02 : -0.02;
    townSplat.position.y = splatOffsetY;
    if (!splatNudgeHud) {
      splatNudgeHud = document.createElement("div");
      splatNudgeHud.style.cssText =
        "position:fixed;left:16px;top:88px;z-index:9;background:rgba(0,0,0,.6);color:#9fe39f;" +
        "font:12px ui-monospace,monospace;padding:6px 9px;border-radius:8px;pointer-events:none;";
      document.body.appendChild(splatNudgeHud);
    }
    splatNudgeHud.textContent = `splat Y offset: ${splatOffsetY.toFixed(2)}   ( [ down · ] up )`;
  }
});

// --- NPC placement tool: toggle with the "Move NPCs" button, press 1/2/3 to
// pick a local, click the ground to move them. Read the coords to bake as
// SPLAT_STATIONS so the positions persist.
let npcEditMode = false;
let npcSel = 0;
let npcEditHud = null;
function updateNpcEditHud() {
  if (!npcEditHud) return;
  const lines = npcObjs.map(
    (n, i) => `${i === npcSel ? "▶" : " "} ${i + 1}  ${n.def.name}: [${n.pos.x.toFixed(2)}, ${n.pos.z.toFixed(2)}]`
  );
  npcEditHud.textContent = "MOVE NPCs — press 1/2/3, then click the ground\n" + lines.join("\n");
}
addEventListener("keydown", (e) => {
  if (!npcEditMode || (e.target && e.target.tagName === "INPUT")) return;
  if (e.code === "Digit1") npcSel = 0;
  else if (e.code === "Digit2") npcSel = 1;
  else if (e.code === "Digit3") npcSel = 2;
  else return;
  npcSel = Math.max(0, Math.min(npcSel, npcObjs.length - 1));
  updateNpcEditHud();
});
canvas.addEventListener("pointerdown", (e) => {
  if (!npcEditMode) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = 1000;
  const hit = raycaster.intersectObjects(colliderMeshes, true)[0];
  const n = npcObjs[npcSel];
  if (!hit || !n) return;
  n.pos.x = hit.point.x;
  n.pos.z = hit.point.z;
  const gy = groundHeight(hit.point.x, hit.point.z, hit.point.y + 5);
  n.root.position.set(hit.point.x, gy != null ? gy : hit.point.y, hit.point.z);
  updateNpcEditHud();
});

// --- Snap a point to the ground via downward raycast -----------------------
function groundHeight(x, z, fromY) {
  raycaster.set(new THREE.Vector3(x, fromY, z), DOWN);
  raycaster.far = fromY + 50;
  const hits = raycaster.intersectObjects(colliderMeshes, true);
  return hits.length ? hits[0].point.y : null;
}

// Median of a few ground rays around the feet. Rejects single-frame spikes and
// small holes in the coarse Marble collider that make a single ray pop or miss.
function groundHeightRobust(x, z, fromY, r = BODY_RADIUS * 0.6) {
  const offs = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];
  const ys = [];
  for (const [ox, oz] of offs) {
    const h = groundHeight(x + ox, z + oz, fromY);
    if (h !== null) ys.push(h);
  }
  if (!ys.length) return null;
  ys.sort((a, b) => a - b);
  return ys[ys.length >> 1]; // median
}

// Move horizontally, blocking against walls. Each axis is checked separately
// so the character slides along a wall instead of sticking to it.
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();
function clampAxis(dist, axis) { // axis: "x" or "z"
  if (dist === 0) return 0;
  const s = Math.sign(dist);
  // probe at knee, waist and chest so low walls / railings also block
  for (const h of [CHAR_H * 0.25, CHAR_H * 0.55, CHAR_H * 0.85]) {
    _origin.set(character.position.x, character.position.y + h, character.position.z);
    _dir.set(axis === "x" ? s : 0, 0, axis === "z" ? s : 0);
    raycaster.set(_origin, _dir);
    raycaster.far = Math.abs(dist) + BODY_RADIUS;
    const hit = raycaster.intersectObjects(colliderMeshes, true)[0];
    if (hit) return s * Math.max(0, hit.distance - BODY_RADIUS);
  }
  return dist;
}
function moveWithCollision(dx, dz) {
  character.position.x += clampAxis(dx, "x");
  character.position.z += clampAxis(dz, "z");
}

// --- Main loop -------------------------------------------------------------
const clock = new THREE.Clock();
let heading = 0; // character yaw
let camDist = CAMERA_DIST; // eased camera distance (for wall collision)
let camSnapped = false;    // snap the camera into place on the first frame
let velY = 0;              // vertical velocity, for smooth gravity falls
const vel = new THREE.Vector2(0, 0); // eased planar velocity (x = world X, y = world Z)
const MOVE_ACCEL = 12;               // higher = snappier start/stop

// --- Touch controls (Task 4): on-screen joystick + drag-to-turn, additive.
// Writes the same `touch` / `heading` state the keyboard uses. Only created on
// coarse-pointer devices, so desktop is visually and behaviourally unchanged.
function setupTouchControls() {
  const IS_TOUCH =
    (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) ||
    "ontouchstart" in window;
  if (!IS_TOUCH) return;
  canvas.style.touchAction = "none";

  // Joystick (bottom-left) → fwd/strafe with analog magnitude; full push = run.
  const base = document.createElement("div");
  base.style.cssText =
    "position:fixed;left:22px;bottom:22px;width:120px;height:120px;border-radius:50%;" +
    "background:rgba(255,255,255,0.12);border:2px solid rgba(255,255,255,0.35);z-index:8;touch-action:none;";
  const knob = document.createElement("div");
  knob.style.cssText =
    "position:absolute;left:50%;top:50%;width:54px;height:54px;margin:-27px 0 0 -27px;" +
    "border-radius:50%;background:rgba(255,255,255,0.5);";
  base.appendChild(knob);
  document.body.appendChild(base);

  const R = 60;
  let jid = null;
  base.addEventListener("pointerdown", (e) => { jid = e.pointerId; base.setPointerCapture(jid); e.preventDefault(); });
  base.addEventListener("pointermove", (e) => {
    if (e.pointerId !== jid) return;
    const rect = base.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy) || 1;
    const cl = Math.min(len, R), nx = dx / len, ny = dy / len, mag = cl / R;
    knob.style.transform = `translate(${nx * cl}px, ${ny * cl}px)`;
    touch.fwd = -ny * mag;     // up = forward
    touch.strafe = -nx * mag;  // left = +strafe (matches A)
    touch.run = mag > 0.9;     // push to the edge to run
  });
  const reset = (e) => {
    if (e.pointerId !== jid) return;
    jid = null; touch.fwd = 0; touch.strafe = 0; touch.run = false;
    knob.style.transform = "translate(0,0)";
  };
  base.addEventListener("pointerup", reset);
  base.addEventListener("pointercancel", reset);

  // Right half of the screen: drag to turn (heading). Skips the NPC UI.
  let lid = null, lx = 0;
  addEventListener("pointerdown", (e) => {
    if (lid !== null || e.clientX < innerWidth / 2 || talking) return;
    if (e.target && e.target.closest && e.target.closest("#reply-bar,#npc-toggle,#reply-suggest")) return;
    lid = e.pointerId; lx = e.clientX;
  });
  addEventListener("pointermove", (e) => {
    if (e.pointerId !== lid) return;
    heading -= (e.clientX - lx) * 0.005; // drag right → turn right
    lx = e.clientX;
  });
  const lend = (e) => { if (e.pointerId === lid) lid = null; };
  addEventListener("pointerup", lend);
  addEventListener("pointercancel", lend);
}
setupTouchControls();

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  updateFps(); // measure real frame time every frame (before any early return)

  // Turn — gated while typing a reply so the keys go to the input, not the player.
  if (!talking && keys.ArrowLeft) heading += TURN_SPEED * dt;
  if (!talking && keys.ArrowRight) heading -= TURN_SPEED * dt;

  // Move — keyboard + (touch) joystick summed into the same fwd/strafe.
  const running = keys.ShiftLeft || keys.ShiftRight || touch.run;
  const speed = running ? RUN_SPEED : WALK_SPEED;
  let fwd = 0, strafe = 0;
  if (!talking) {
    if (keys.ArrowUp || keys.KeyW) fwd += 1;
    if (keys.ArrowDown || keys.KeyS) fwd -= 1;
    if (keys.KeyA) strafe += 1;
    if (keys.KeyD) strafe -= 1;
    fwd += touch.fwd;
    strafe += touch.strafe;
  }

  // Direction is normalized so diagonals aren't faster; magnitude is clamped to
  // 1 (keeps full keyboard speed while preserving analog joystick tilt). Velocity
  // eases toward the target for soft starts/stops, and the walk/run clip is gated
  // on actual planar speed so it lingers while decelerating instead of cutting
  // off on keyup. Heading stays ←/→-driven (back-to-camera design).
  const sin = Math.sin(heading), cos = Math.cos(heading);
  let tx = 0, tz = 0;
  const m = Math.hypot(fwd, strafe);
  if (m > 0.001) {
    const nf = fwd / m, ns = strafe / m;
    const mag = Math.min(1, m) * speed;
    tx = (-sin * nf - cos * ns) * mag;
    tz = (-cos * nf + sin * ns) * mag;
  }
  const k = Math.min(1, dt * MOVE_ACCEL);
  vel.x += (tx - vel.x) * k;
  vel.y += (tz - vel.y) * k;
  moveWithCollision(vel.x * dt, vel.y * dt);

  const planarSpeed = vel.length();
  if (planarSpeed > 0.05) play(running ? "run" : "walk");
  else play("idle");

  // Keep the player within the clean core of the world.
  character.position.x = THREE.MathUtils.clamp(character.position.x, BOUNDS.minX, BOUNDS.maxX);
  character.position.z = THREE.MathUtils.clamp(character.position.z, BOUNDS.minZ, BOUNDS.maxZ);

  // Face the travel direction. Xbot's model faces +Z, opposite the movement
  // vector, so add π — this makes the character stride forward (no moonwalk)
  // and puts its back to the camera.
  character.rotation.y = heading + Math.PI;

  // Stick to the ground — smooth and step-limited.
  // Cast DOWN from just above the feet (feet + STEP_UP) so the snap can only
  // ever raise us by a small step, never onto a wall/awning/roof. Small steps
  // settle instantly; walking off a ledge falls smoothly under gravity.
  const ground = groundHeightRobust(character.position.x, character.position.z, character.position.y + STEP_UP);
  if (ground === null) {
    // Off-map safety: nothing within reach below — recover onto whatever floor
    // exists by snapping from high above (rare; keeps us from falling forever).
    const recover = groundHeight(character.position.x, character.position.z, 50);
    if (recover !== null) { character.position.y = recover; velY = 0; }
  } else if (character.position.y <= ground + 0.02) {
    // Settle onto the floor; ease UP-steps over a few frames so collider noise
    // within STEP_UP no longer pops. Downward never needs damping.
    const rise = ground - character.position.y;
    character.position.y += rise > 0 ? rise * Math.min(1, dt * 14) : rise;
    velY = 0;
  } else {
    // Above the ground (stepped off a ledge): accelerate downward, then land.
    velY -= GRAVITY * dt;
    character.position.y += velY * dt;
    if (character.position.y <= ground) { character.position.y = ground; velY = 0; }
  }

  if (DEBUG_CAM) {
    // piazza center after rotation.x=PI is approx (-0.8, 3, -4.7)
    const cx = -0.8, cy = 3, cz = -4.7;
    const t = clock.elapsedTime * 0.3;
    camera.position.set(cx + Math.sin(t) * 12, cy + 6, cz + Math.cos(t) * 12);
    camera.lookAt(cx, cy, cz);
    if (mixer) mixer.update(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
    return;
  }

  // Third-person camera: always directly behind the character's heading.
  const back = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)); // behind direction
  const head = new THREE.Vector3(character.position.x, character.position.y + HEAD_H, character.position.z);

  // Wall-aware distance, eased so it never snaps.
  let targetDist = CAMERA_DIST;
  raycaster.set(head, back);
  raycaster.far = CAMERA_DIST + 0.3;
  const camHits = raycaster.intersectObjects(colliderMeshes, true);
  if (camHits.length) targetDist = Math.max(1.3, camHits[0].distance - 0.3);
  camDist += (targetDist - camDist) * Math.min(1, dt * 6);

  const desired = new THREE.Vector3(
    character.position.x + back.x * camDist,
    character.position.y + CAMERA_HEIGHT,
    character.position.z + back.z * camDist
  );
  if (camSnapped) {
    camera.position.lerp(desired, Math.min(1, dt * 8)); // smooth follow
  } else {
    camera.position.copy(desired); // no swing on first frame
    camSnapped = true;
  }
  camera.lookAt(character.position.x, character.position.y + HEAD_H * 0.9, character.position.z);

  if (mixer) mixer.update(dt);
  updateNpcs(dt); // NPC mixers, proximity, turn-to-face, speech bubbles
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Boot ----------------------------------------------------------------------
function hideLoading() {
  if (!loadingEl) return;
  loadingEl.style.opacity = "0";
  setTimeout(() => loadingEl.remove(), 400);
}

(async () => {
  try {
    await loadCharacter();
  } catch (e) {
    console.error("Character failed to load:", e); // keep going anyway
  }
  if (WORLD_MODE === "town") {
    // Stylized Three.js piazza (smooth, light). Its meshes ARE the colliders.
    const town = buildTown(CHAR_H);
    scene.add(town.group);
    townGroup = town.group;
    colliderMeshes = town.colliders;
    BOUNDS = town.bounds;
    townStations = town.stations;
    scene.background = new THREE.Color(town.sky);
    scene.fog = new THREE.Fog(new THREE.Color(town.fog.color), town.fog.near, town.fog.far);
    grid.visible = false;
    fallbackGround.visible = false;
    character.position.set(town.spawn.x, 5.0, town.spawn.z);
  } else {
    // Photoreal Gaussian-splat world (the original).
    await Promise.all([loadSplat(), loadCollider()]); // optional, degrade gracefully
    townStations = SPLAT_STATIONS; // use baked NPC spots if set, else the arc
    character.position.set(0, 5.0, 0);
  }
  // Face −Z (the open side / piazza centre) so the cast is in view on spawn —
  // first contact works without turning around first.
  heading = 0;
  window.__char = character; // debug handle
  // Ground/NPC raycasts run here BEFORE the first render, so the collider's
  // world matrix (which carries the 180° X-flip) isn't current yet — force it
  // now or the snaps hit a stale transform and the cast floats. The player
  // hides this by re-snapping every frame; NPCs snap once, so they need this.
  scene.updateMatrixWorld(true);
  // Drop a ground-snap before loading NPCs so they place relative to the
  // character's resolved floor position, and load the cast onto the collider.
  const spawnGy = groundHeight(character.position.x, character.position.z, character.position.y + 5);
  if (spawnGy !== null) character.position.y = spawnGy;
  await loadNpcs(); // additive: locals standing in the existing town
  hideLoading();

  // World toggle (standalone only): reload flipping ?world (splat ⟷ town) so you
  // can compare live. When embedded, the onboarding app provides this toggle.
  if (!EMBEDDED) {
    const wbtn = document.createElement("button");
    wbtn.textContent = WORLD_MODE === "town" ? "🏛 Town — switch to Splat" : "📷 Splat — switch to Town";
    wbtn.style.cssText =
      "position:fixed;left:16px;top:16px;z-index:8;background:rgba(0,0,0,0.5);color:#fff;" +
      "border:1px solid rgba(255,255,255,0.25);border-radius:8px;padding:6px 10px;" +
      "font:12px system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(6px);";
    wbtn.addEventListener("click", () => {
      const u = new URL(location.href);
      u.searchParams.set("world", WORLD_MODE === "town" ? "splat" : "town");
      location.href = u.toString();
    });
    document.body.appendChild(wbtn);
  }

  // Export the Three.js town as a .glb — for importing into Marble Studio as a
  // layout scaffold. GLTFExporter is dynamically imported so it's only fetched
  // when you actually export.
  if (WORLD_MODE === "town" && townGroup) {
    const ebtn = document.createElement("button");
    ebtn.textContent = "⬇ Export .glb";
    ebtn.style.cssText =
      "position:fixed;left:16px;top:52px;z-index:8;background:rgba(0,0,0,0.5);color:#fff;" +
      "border:1px solid rgba(255,255,255,0.25);border-radius:8px;padding:6px 10px;" +
      "font:12px system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(6px);";
    ebtn.addEventListener("click", async () => {
      ebtn.textContent = "exporting…";
      try {
        const { GLTFExporter } = await import("three/addons/exporters/GLTFExporter.js");
        new GLTFExporter().parse(
          townGroup,
          (res) => {
            const blob = new Blob([res], { type: "model/gltf-binary" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "italy-piazza.glb";
            a.click();
            URL.revokeObjectURL(a.href);
            ebtn.textContent = "⬇ Export .glb";
          },
          (err) => { console.error("GLB export failed", err); ebtn.textContent = "export failed"; },
          { binary: true }
        );
      } catch (err) {
        console.error("GLB export failed", err);
        ebtn.textContent = "export failed";
      }
    });
    document.body.appendChild(ebtn);
  }

  // Move-NPCs tool: toggle placement mode; 1/2/3 select, click ground to move.
  if (npcObjs.length) {
    const nbtn = document.createElement("button");
    nbtn.textContent = "✥ Move NPCs";
    nbtn.style.cssText =
      "position:fixed;left:16px;top:88px;z-index:8;background:rgba(0,0,0,0.5);color:#fff;" +
      "border:1px solid rgba(255,255,255,0.25);border-radius:8px;padding:6px 10px;" +
      "font:12px system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(6px);";
    nbtn.addEventListener("click", () => {
      npcEditMode = !npcEditMode;
      nbtn.textContent = npcEditMode ? "✥ Move NPCs: ON" : "✥ Move NPCs";
      nbtn.style.borderColor = npcEditMode ? "#9fe39f" : "rgba(255,255,255,0.25)";
      if (npcEditMode && !npcEditHud) {
        npcEditHud = document.createElement("div");
        npcEditHud.style.cssText =
          "position:fixed;left:16px;top:124px;z-index:9;background:rgba(0,0,0,.6);color:#9fe39f;" +
          "font:12px ui-monospace,monospace;padding:6px 9px;border-radius:8px;white-space:pre;pointer-events:none;";
        document.body.appendChild(npcEditHud);
      }
      if (npcEditHud) npcEditHud.style.display = npcEditMode ? "block" : "none";
      if (npcEditMode) updateNpcEditHud();
    });
    document.body.appendChild(nbtn);
  }

  tick();
})();

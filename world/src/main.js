import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
import { castForLanguage } from "./npcs.js";
window.THREE = THREE; // debug handle

// Several NPCs may share a character model — cache the fetched glTF so we only
// download each file once (each NPC still gets its own parsed scene + mixer).
THREE.Cache.enabled = true;

// Accelerate raycasts with a BVH. The movement loop fires ~8 rays/frame against
// the collider mesh; without this they brute-force every triangle (stutter).
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ---------------------------------------------------------------------------
// Asset paths. Drop your Marble exports into public/worlds/.
//   - town.spz        the Gaussian splat the town is rendered from
//   - collider.glb    Marble's collider mesh (used for ground + walls)
// The character is a standard rigged glTF with Idle / Walk / Run clips.
// ---------------------------------------------------------------------------
// v2 — town loaded
const ASSETS = {
  splat: "/worlds/town.spz",
  collider: "/worlds/collider.glb",
  character: "/models/casual.glb",
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
const BODY_RADIUS = CHAR_H * 0.28;   // how close the character can get to a wall
const CAMERA_DIST = CHAR_H * 2.6;    // how far the camera trails behind
const CAMERA_HEIGHT = CHAR_H * 1.25;
const HEAD_H = CHAR_H * 0.9;         // eye/look-at height

// How close you must get to an NPC to talk. Derived from CHAR_H so it scales
// with the half-scale town instead of hardcoding metres.
const TALK_RANGE = CHAR_H * 3;
const BUBBLE_H = CHAR_H * 1.25;      // speech-bubble anchor height above a head

// Keep the player inside the cleanly-reconstructed core of the splat.
// Piazza world (marble-1.1-plus): collider extent after the X-flip is
// X:[-11.6,10.0]  Z:[-13.5,4.2]. Leave ~1.5m margin off the low-detail fringe.
const BOUNDS = { minX: -10, maxX: 8.5, minZ: -11.5, maxZ: 2.7 };
const SPLAT_ROTATION_X = Math.PI; // Marble splats usually need a 180° flip
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

// --- Load splat town -------------------------------------------------------
let townSplat = null;
async function loadSplat() {
  try {
    const splat = new SplatMesh({ url: ASSETS.splat });
    await splat.initialized;
    splat.rotation.x = SPLAT_ROTATION_X;
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
// Read language + level so the cast and the brain are calibrated to the player.
// Falls back to the country default + beginner if the world is opened directly.
const COUNTRY_DEFAULT_LANGUAGE = { italy: "Italian" };
function readProfile() {
  const params = new URLSearchParams(location.search);
  const country = (params.get("country") || "italy").toLowerCase();
  let language = COUNTRY_DEFAULT_LANGUAGE[country] || "Italian";
  let level = "beginner";
  const raw = params.get("profile");
  if (raw) {
    try {
      const p = JSON.parse(raw);
      if (p?.languages?.learning) language = p.languages.learning;
      if (p?.languages?.level) level = p.languages.level;
    } catch (e) {
      console.warn("Could not parse ?profile= — using defaults.", e);
    }
  }
  return { country, language, level };
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
  };

  const cast = castForLanguage(PROFILE.language, PROFILE.level, spawn);

  for (const def of cast) {
    try {
      const gltf = await loader.loadAsync(def.modelUrl);
      const root = gltf.scene;
      root.scale.setScalar(CHARACTER_SCALE); // same scale as the player
      root.traverse((o) => { if (o.isMesh) o.castShadow = true; });

      // Ground-snap with the existing collider raycast so they don't float.
      const [x, , z] = def.pos;
      const gy = groundHeight(x, z, character.position.y + 5);
      root.position.set(x, gy !== null ? gy : 0, z);

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

// --- Snap a point to the ground via downward raycast -----------------------
function groundHeight(x, z, fromY) {
  raycaster.set(new THREE.Vector3(x, fromY, z), DOWN);
  raycaster.far = fromY + 50;
  const hits = raycaster.intersectObjects(colliderMeshes, true);
  return hits.length ? hits[0].point.y : null;
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

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);

  // Turn — gated while typing a reply so the keys go to the input, not the player.
  if (!talking && keys.ArrowLeft) heading += TURN_SPEED * dt;
  if (!talking && keys.ArrowRight) heading -= TURN_SPEED * dt;

  // Move
  const running = keys.ShiftLeft || keys.ShiftRight;
  const speed = running ? RUN_SPEED : WALK_SPEED;
  let fwd = 0, strafe = 0;
  if (!talking) {
    if (keys.ArrowUp || keys.KeyW) fwd += 1;
    if (keys.ArrowDown || keys.KeyS) fwd -= 1;
    if (keys.KeyA) strafe += 1;
    if (keys.KeyD) strafe -= 1;
  }

  const moving = fwd !== 0 || strafe !== 0;
  if (moving) {
    const sin = Math.sin(heading), cos = Math.cos(heading);
    // forward follows the current heading; strafe is perpendicular.
    // Heading is NOT recomputed from movement — only ← → turn changes it,
    // so the character always faces away from the camera (back view).
    const dx = (-sin * fwd - cos * strafe) * speed * dt;
    const dz = (-cos * fwd + sin * strafe) * speed * dt;
    moveWithCollision(dx, dz);
    play(running ? "run" : "walk");
  } else {
    play("idle");
  }

  // Keep the player within the clean core of the world.
  character.position.x = THREE.MathUtils.clamp(character.position.x, BOUNDS.minX, BOUNDS.maxX);
  character.position.z = THREE.MathUtils.clamp(character.position.z, BOUNDS.minZ, BOUNDS.maxZ);

  // Face the travel direction. Xbot's model faces +Z, opposite the movement
  // vector, so add π — this makes the character stride forward (no moonwalk)
  // and puts its back to the camera.
  character.rotation.y = heading + Math.PI;

  // Stick to the ground
  const gy = groundHeight(character.position.x, character.position.z, character.position.y + 5);
  if (gy !== null) character.position.y = gy;

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
  await Promise.all([loadSplat(), loadCollider()]); // optional, degrade gracefully
  // Spawn at the capture point (0,0,0 = guaranteed open center of the piazza).
  // Y is set above the floor; the first ground-snap drops the character onto it.
  character.position.set(0, 5.0, 0);
  // Face the open core of the piazza (−Z, toward the bounds centre) so the cast,
  // which loadNpcs() lays out on an arc into that same open area, is in view on
  // spawn — first contact then works without turning around first.
  heading = 0;
  window.__char = character; // debug handle
  // Drop a ground-snap before loading NPCs so they place relative to the
  // character's resolved floor position, and load the cast onto the collider.
  const spawnGy = groundHeight(character.position.x, character.position.z, character.position.y + 5);
  if (spawnGy !== null) character.position.y = spawnGy;
  await loadNpcs(); // additive: locals standing in the existing town
  hideLoading();
  tick();
})();

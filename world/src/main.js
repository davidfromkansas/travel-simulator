import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";
window.THREE = THREE; // debug handle

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

// --- Input -----------------------------------------------------------------
const keys = {};
addEventListener("keydown", (e) => {
  keys[e.code] = true;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
});
addEventListener("keyup", (e) => { keys[e.code] = false; });

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

  // Turn
  if (keys.ArrowLeft) heading += TURN_SPEED * dt;
  if (keys.ArrowRight) heading -= TURN_SPEED * dt;

  // Move
  const running = keys.ShiftLeft || keys.ShiftRight;
  const speed = running ? RUN_SPEED : WALK_SPEED;
  let fwd = 0, strafe = 0;
  if (keys.ArrowUp || keys.KeyW) fwd += 1;
  if (keys.ArrowDown || keys.KeyS) fwd -= 1;
  if (keys.KeyA) strafe += 1;
  if (keys.KeyD) strafe -= 1;

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
  heading = Math.PI; // face into the piazza
  window.__char = character; // debug handle
  hideLoading();
  tick();
})();

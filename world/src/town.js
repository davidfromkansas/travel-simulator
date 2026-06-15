import * as THREE from "three";

// ---------------------------------------------------------------------------
// town.js — a stylized low-poly Italian piazza built entirely from Three.js
// primitives (an alternative to the Gaussian-splat world). Everything is plain
// geometry, so it renders perfectly smooth, is light, and gives clean collision.
//
// buildTown(U) returns:
//   group     – add this to the scene
//   colliders – meshes for the existing ground-snap + wall raycasts
//   bounds    – { minX, maxX, minZ, maxZ } walkable clamp
//   spawn     – { x, z } player start (open south side, facing the venues)
//   stations  – [ [x,z] … ] NPC venue positions, in the kit's role order
//               (gelato cart → trattoria → café), so locals stand at their spot
//   sky / fog – colours for main.js to apply in town mode
//
// U is the world unit (the player's height, ~0.9 in this half-scale town); every
// size derives from it so the town matches the character.
// ---------------------------------------------------------------------------
export function buildTown(U = 0.9) {
  const group = new THREE.Group();
  const colliders = [];
  const mat = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.95, metalness: 0, ...extra });

  const P = 12 * U; // half-extent of the open piazza

  // --- Ground -------------------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90 * U, 90 * U), mat("#b6a684"));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(ground); // flat → perfectly smooth ground-follow

  // central round inlay (visual only)
  const inlay = new THREE.Mesh(new THREE.CircleGeometry(P * 0.92, 48), mat("#c8b78c"));
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.012;
  group.add(inlay);

  // --- Perimeter buildings ------------------------------------------------
  const facades = ["#d98c4a", "#e3c07a", "#e7dcc2", "#c66b46", "#cf9b53", "#b5532f", "#e8d6b0", "#d2a256"];
  const roofMat = mat("#9c4a30", { flatShading: true });
  const winMat = mat("#39505f", { roughness: 0.35, metalness: 0.1 });
  let facadeIdx = 0;

  function building(cx, cz, w, d, h, rot) {
    const b = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(facades[facadeIdx++ % facades.length]));
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    b.add(body);
    colliders.push(body); // walls

    // low hip roof (terracotta pyramid)
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(w, d) * 0.58, 1.2 * U, 4), roofMat);
    roof.position.y = h + 0.55 * U;
    roof.rotation.y = Math.PI / 4;
    b.add(roof);

    // windows on the front face (+Z, before the group's rotation)
    const cols = Math.max(2, Math.round(w / (1.7 * U)));
    const rows = Math.max(1, Math.round(h / (1.9 * U)));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.72 * U, 1.0 * U), winMat);
        win.position.set((c - (cols - 1) / 2) * (w / cols), 1.5 * U + r * 1.9 * U, d / 2 + 0.02);
        b.add(win);
      }
    }
    b.position.set(cx, 0, cz);
    b.rotation.y = rot;
    group.add(b);
  }

  // Line three edges with buildings; leave the south edge open (spawn side).
  const depth = 4 * U;
  const per = 4; // buildings per edge
  const edges = [
    { axis: "x", sign: -1 }, // north (−Z)
    { axis: "z", sign: -1 }, // west  (−X)
    { axis: "z", sign: +1 }, // east  (+X)
  ];
  for (const e of edges) {
    for (let i = 0; i < per; i++) {
      const t = ((i + 0.5) / per) * 2 - 1; // −1..1 across the edge
      const w = ((P * 2) / per) * 0.9;
      const h = (3.2 + ((i % 3) * 0.8)) * U; // varied heights
      if (e.axis === "x") building(t * P, e.sign * (P + depth / 2), w, depth, h, 0);
      else building(e.sign * (P + depth / 2), t * P, depth, w, h, e.sign > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
  }

  // --- Central fountain ---------------------------------------------------
  const fountain = new THREE.Group();
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(2.6 * U, 2.8 * U, 0.6 * U, 24), mat("#cfc6b0"));
  basin.position.y = 0.3 * U;
  fountain.add(basin);
  colliders.push(basin);
  const water = new THREE.Mesh(new THREE.CircleGeometry(2.3 * U, 24), mat("#5b86a8", { roughness: 0.2, metalness: 0.2 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.55 * U;
  fountain.add(water);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * U, 0.5 * U, 1.4 * U, 16), mat("#cfc6b0"));
  pillar.position.y = 1.0 * U;
  fountain.add(pillar);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.0 * U, 0.3 * U, 0.3 * U, 16), mat("#cfc6b0"));
  bowl.position.y = 1.7 * U;
  fountain.add(bowl);
  group.add(fountain);

  // --- NPC venue positions only (no props — buildings + fountain world). The
  // locals still stand at these spots so they read as the gelato/host/barista.
  const GELATO = [-5 * U, -3 * U];
  const TRATTORIA = [5 * U, -4 * U];
  const CAFE = [0, -7 * U];

  return {
    group,
    colliders,
    bounds: { minX: -P + U, maxX: P - U, minZ: -P + U, maxZ: P - U },
    spawn: { x: 0, z: 7 * U },          // open south side, looking toward the venues
    stations: [GELATO, TRATTORIA, CAFE], // matches kit role order
    sky: "#cfe1f0",
    fog: { color: "#cfe1f0", near: 18 * U, far: 60 * U },
  };
}

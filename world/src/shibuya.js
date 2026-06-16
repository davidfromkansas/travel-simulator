import * as THREE from "three";

// ---------------------------------------------------------------------------
// shibuya.js — a stylized low-poly Tokyo scene built from Three.js primitives,
// the Japan counterpart to town.js. Same contract as buildTown().
//
// Layout (player walks along −Z from the spawn):
//   • spawn sits in a narrow, lantern-lit IZAKAYA ALLEY (warm shopfronts both
//     sides, paper lanterns, glowing signs) — the "fun street".
//   • walking forward the alley opens into the SHIBUYA SCRAMBLE CROSSING: a wide
//     dark-asphalt intersection painted with zebra + diagonal crosswalks, ringed
//     by tall neon-billboard towers.
//
// buildShibuya(U) returns { group, colliders, bounds, spawn, stations, sky, fog }
// exactly like buildTown(U). U is the world unit (≈ the player's height).
// ---------------------------------------------------------------------------
export function buildShibuya(U = 0.9) {
  const group = new THREE.Group();
  const colliders = [];
  const mat = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.9, metalness: 0, ...extra });
  // Emissive material — neon signs, billboards, lanterns glow at dusk.
  const glow = (color, intensity = 1) =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      emissive: new THREE.Color(color),
      emissiveIntensity: intensity,
      roughness: 0.6,
      metalness: 0,
    });

  // --- Geometry envelope --------------------------------------------------
  const AX = 3.4 * U;        // alley corridor half-width (walkable)
  const ALLEY_FAR = 16 * U;  // south end (behind spawn)
  const ALLEY_MOUTH = 1.5 * U; // where the alley meets the crossing
  const PX = 13 * U;         // crossing half-width
  const PZ_FAR = -16 * U;    // crossing far (north) edge

  // --- Ground: dark wet asphalt over the whole walkable area --------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(120 * U, 120 * U), mat("#26282d", { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(ground); // flat → smooth ground-follow

  // Alley pavement strip (slightly lighter) so the corridor reads as a street.
  const alley = new THREE.Mesh(new THREE.PlaneGeometry(AX * 2, ALLEY_FAR - ALLEY_MOUTH + 2 * U), mat("#34373d"));
  alley.rotation.x = -Math.PI / 2;
  alley.position.set(0, 0.01, (ALLEY_FAR + ALLEY_MOUTH) / 2);
  group.add(alley);

  // --- Scramble crosswalk: white zebra bands + the iconic diagonals -------
  const stripeMat = glow("#dfe6ea", 0.18); // faintly lit white paint
  function zebra(cx, cz, along, count, len, w, gap, rotY = 0) {
    // `along` = "x" lays stripes spread along X (a crossing you walk N↔S).
    const span = count * w + (count - 1) * gap;
    for (let i = 0; i < count; i++) {
      const off = -span / 2 + i * (w + gap) + w / 2;
      const s = new THREE.Mesh(new THREE.PlaneGeometry(along === "x" ? w : len, along === "x" ? len : w), stripeMat);
      s.rotation.x = -Math.PI / 2;
      s.rotation.z = rotY;
      const dx = along === "x" ? off : 0;
      const dz = along === "x" ? 0 : off;
      // rotate offset by rotY for diagonals
      const rx = dx * Math.cos(rotY) - dz * Math.sin(rotY);
      const rz = dx * Math.sin(rotY) + dz * Math.cos(rotY);
      s.position.set(cx + rx, 0.02, cz + rz);
      group.add(s);
    }
  }
  const CX = 0, CZ = -7.5 * U; // crossing centre
  zebra(CX, CZ + 6 * U, "x", 9, 5.5 * U, 0.45 * U, 0.5 * U);  // south crossing
  zebra(CX, CZ - 6 * U, "x", 9, 5.5 * U, 0.45 * U, 0.5 * U);  // north crossing
  zebra(CX - 6 * U, CZ, "z", 9, 5.5 * U, 0.45 * U, 0.5 * U);  // west crossing
  zebra(CX + 6 * U, CZ, "z", 9, 5.5 * U, 0.45 * U, 0.5 * U);  // east crossing
  zebra(CX, CZ, "x", 12, 7 * U, 0.4 * U, 0.6 * U, Math.PI / 4);   // diagonal ↘
  zebra(CX, CZ, "x", 12, 7 * U, 0.4 * U, 0.6 * U, -Math.PI / 4);  // diagonal ↙

  // --- Izakaya alley shopfronts -------------------------------------------
  const izakayaFacades = ["#7a3b2a", "#8a4a2f", "#5e3320", "#9c5a32", "#6b2f28"];
  const signColors = ["#ff3b6b", "#ffd400", "#39ff88", "#00e0ff", "#ff7b00", "#ff2f5e"];
  let signIdx = 0;
  const winWarm = glow("#ffd9a0", 0.5);

  function shopfront(side, z, depth) {
    // side = -1 (left, −X) or +1 (right, +X)
    const T = 4 * U;                 // building thickness (into −/+X)
    const h = (3.2 + Math.random() * 1.6) * U;
    const cx = side * (AX + T / 2);
    const body = new THREE.Mesh(new THREE.BoxGeometry(T, h, depth - 0.2 * U), mat(izakayaFacades[(Math.abs(z) | 0) % izakayaFacades.length]));
    body.position.set(cx, h / 2, z);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    colliders.push(body);

    // Warm shop window facing the alley (inner face).
    const win = new THREE.Mesh(new THREE.PlaneGeometry(depth * 0.6, 1.2 * U), winWarm);
    win.position.set(side * (AX + 0.02), 1.1 * U, z);
    win.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(win);

    // Vertical neon sign board on the inner face.
    const sc = signColors[signIdx++ % signColors.length];
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6 * U, 2.2 * U), glow(sc, 1.4));
    sign.position.set(side * (AX + 0.05), h * 0.6, z + depth * 0.28);
    sign.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(sign);

    // A paper lantern hanging at the storefront.
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.28 * U, 12, 10), glow("#ff5a3c", 1.1));
    lantern.scale.y = 1.3;
    lantern.position.set(side * (AX - 0.3 * U), 2.0 * U, z - depth * 0.25);
    group.add(lantern);
  }

  // Line both sides of the alley with shopfront segments.
  const segs = 4;
  const segLen = (ALLEY_FAR - ALLEY_MOUTH) / segs;
  for (let s = 0; s < segs; s++) {
    const z = ALLEY_MOUTH + segLen * (s + 0.5);
    shopfront(-1, z, segLen);
    shopfront(+1, z, segLen);
  }

  // --- Crossing towers with neon billboards -------------------------------
  const towerFacades = ["#2f3540", "#384150", "#454f60", "#2a313c"];
  const winCool = glow("#9fd2ff", 0.35);
  let towerIdx = 0;

  function tower(cx, cz, w, d, h, faceDir) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(towerFacades[towerIdx++ % towerFacades.length]));
    body.position.set(cx, h / 2, cz);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    colliders.push(body);

    // Window grid on the face toward the crossing.
    const cols = Math.max(3, Math.round(w / (1.4 * U)));
    const rows = Math.max(3, Math.round(h / (1.8 * U)));
    const faceZ = faceDir.z !== 0 ? d / 2 * Math.sign(faceDir.z) + 0.02 * Math.sign(faceDir.z) : 0;
    const faceX = faceDir.x !== 0 ? w / 2 * Math.sign(faceDir.x) + 0.02 * Math.sign(faceDir.x) : 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.random() < 0.35) continue; // some windows dark
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7 * U, 1.0 * U), winCool);
        if (faceDir.z !== 0) {
          win.position.set(cx + (c - (cols - 1) / 2) * (w / cols), 1.6 * U + r * 1.8 * U, cz + faceZ);
        } else {
          win.position.set(cx + faceX, 1.6 * U + r * 1.8 * U, cz + (c - (cols - 1) / 2) * (d / cols));
          win.rotation.y = Math.PI / 2;
        }
        group.add(win);
      }
    }

    // A big neon billboard on the lower-mid of the face.
    const bc = signColors[(towerIdx * 2) % signColors.length];
    const bw = w * 0.8, bh = h * 0.28;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(faceDir.z !== 0 ? bw : d * 0.8, bh), glow(bc, 1.6));
    if (faceDir.z !== 0) {
      board.position.set(cx, h * 0.45, cz + faceZ + 0.03 * Math.sign(faceDir.z));
    } else {
      board.position.set(cx + faceX + 0.03 * Math.sign(faceDir.x), h * 0.45, cz);
      board.rotation.y = Math.PI / 2;
    }
    group.add(board);
  }

  // North wall of towers (facing +Z toward the player).
  for (let i = 0; i < 4; i++) {
    const w = (PX * 2 / 4) * 0.92;
    tower(-PX + (i + 0.5) * (PX * 2 / 4), PZ_FAR - 2 * U, w, 4 * U, (8 + (i % 3) * 2.5) * U, { x: 0, z: 1 });
  }
  // East + west walls of towers (facing inward), skipping the alley mouth gap.
  for (let i = 0; i < 3; i++) {
    const d = ((Math.abs(PZ_FAR) - 1 * U) / 3) * 0.9;
    const cz = PZ_FAR + (i + 0.5) * (Math.abs(PZ_FAR) / 3);
    tower(-PX - 2 * U, cz, 4 * U, d, (7 + (i % 2) * 3) * U, { x: 1, z: 0 });
    tower(PX + 2 * U, cz, 4 * U, d, (7 + ((i + 1) % 2) * 3) * U, { x: -1, z: 0 });
  }

  // --- NPC stations (kit role order: izakaya master, ramen, konbini, takoyaki,
  // local). Four vendors line the fun alley; the local waits at the crossing
  // mouth so you meet the street first, then get drawn into the scramble.
  const stations = [
    [-2.8 * U, 12 * U], // izakaya master (left, near spawn)
    [2.8 * U, 12 * U],  // ramen owner   (right, near spawn)
    [-2.8 * U, 6 * U],  // konbini clerk (left, mid-alley)
    [2.8 * U, 6 * U],   // takoyaki vendor (right, mid-alley)
    [0, 0 * U],         // friendly local at the mouth of the crossing
  ];

  return {
    group,
    colliders,
    // Walkable clamp spans alley + crossing; building colliders keep you in lane.
    bounds: { minX: -PX + U, maxX: PX - U, minZ: PZ_FAR + 2 * U, maxZ: ALLEY_FAR - U },
    spawn: { x: 0, z: 14 * U }, // in the alley, facing −Z down the street
    stations,
    sky: "#150f24",            // deep dusk
    fog: { color: "#150f24", near: 22 * U, far: 80 * U },
  };
}

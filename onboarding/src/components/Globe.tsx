import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Stars, useTexture, Html } from "@react-three/drei";
import * as THREE from "three";
import { COUNTRIES, type Country } from "../data/countries";
import { enterCountry } from "../handoff";

const RADIUS = 2;
// Aligns the equirectangular texture's longitude with our lat/lng math.
// Markers live in the SAME rotated frame as the mesh, so this offset moves
// both together — it only sets where "Greenwich" sits, keeping pins on land.
// Calibrated empirically (see ?off= / ?freeze= dev hooks below).
const params = new URLSearchParams(window.location.search);
const TEXTURE_OFFSET = params.has("off")
  ? parseFloat(params.get("off")!)
  : (3 * Math.PI) / 2; // start facing Europe/Mediterranean (the Italy hero)
const FREEZE = params.has("freeze");

// Convert geographic coords to a point on the sphere surface.
function latLngToVector3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -r * Math.sin(phi) * Math.cos(theta);
  const z = r * Math.sin(phi) * Math.sin(theta);
  const y = r * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function Marker({ country }: { country: Country }) {
  const [hovered, setHovered] = useState(false);
  const ringRef = useRef<THREE.Mesh>(null);
  const pos = latLngToVector3(country.lat, country.lng, RADIUS * 1.01);

  // Gentle pulse on the glow ring.
  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const t = clock.getElapsedTime();
    const s = 1 + Math.sin(t * 2.5) * 0.15 + (hovered ? 0.5 : 0);
    ringRef.current.scale.set(s, s, s);
  });

  const color = country.enabled ? "#ffcf5c" : "#5a6b7a";

  function handleClick(e: { stopPropagation: () => void }) {
    e.stopPropagation();
    if (!country.enabled) return;
    enterCountry(country.id); // ★ the single handoff seam
  }

  return (
    <group
      position={pos}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (country.enabled) {
          setHovered(true);
          document.body.style.cursor = "pointer";
        }
      }}
      onPointerOut={() => {
        setHovered(false);
        document.body.style.cursor = "auto";
      }}
      onClick={handleClick}
    >
      {/* core dot */}
      <mesh>
        <sphereGeometry args={[0.045, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2} toneMapped={false} />
      </mesh>
      {/* pulsing glow ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.07, 0.1, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {(hovered || country.enabled) && (
        <Html distanceFactor={8} position={[0, 0.18, 0]} center occlude={false} style={{ pointerEvents: "none" }}>
          <div className={`marker-label ${hovered ? "hovered" : ""}`}>
            {country.flag} {country.name}
            {!country.enabled && <span className="soon"> · soon</span>}
          </div>
        </Html>
      )}
    </group>
  );
}

function Earth() {
  const groupRef = useRef<THREE.Group>(null);
  const texture = useTexture("/textures/earth.jpg");

  // Subtle auto-rotation. OrbitControls drag composes on top of this.
  useFrame((_, delta) => {
    if (groupRef.current && !FREEZE) groupRef.current.rotation.y += delta * 0.04;
  });

  return (
    <group ref={groupRef}>
      {/* Texture + markers share ONE rotated frame, so pins stay on land. */}
      <group rotation={[0, TEXTURE_OFFSET, 0]}>
        <mesh>
          <sphereGeometry args={[RADIUS, 64, 64]} />
          <meshStandardMaterial map={texture} metalness={0.1} roughness={0.85} />
        </mesh>
        {COUNTRIES.map((c) => (
          <Marker key={c.id} country={c} />
        ))}
      </group>
      {/* faint atmosphere (rotation-symmetric, lives outside the frame) */}
      <mesh>
        <sphereGeometry args={[RADIUS * 1.025, 64, 64]} />
        <meshBasicMaterial color="#4ea3ff" transparent opacity={0.08} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

export default function Globe() {
  return (
    <div className="globe-wrap">
      <Canvas camera={{ position: [0, 1.5, 4.7], fov: 45 }} gl={{ antialias: true }}>
        <color attach="background" args={["#05060d"]} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[5, 3, 5]} intensity={1.6} />
        <Stars radius={120} depth={60} count={6000} factor={4} saturation={0} fade speed={1} />
        <Earth />
        <OrbitControls
          enablePan={false}
          minDistance={3.2}
          maxDistance={8}
          rotateSpeed={0.6}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
      <div className="globe-hint">Drag to spin · click a glowing marker to travel</div>
    </div>
  );
}

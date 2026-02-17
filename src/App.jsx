import { Canvas } from "@react-three/fiber";
import { OrbitControls, useAnimations, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useLoader } from "@react-three/fiber";

import * as THREE from "three";
import { useThree } from "@react-three/fiber";






function FrogWanderer({
  url = `${import.meta.env.BASE_URL}models/chew6.glb`,
  scale = 1,
  idleSecondsMin = 2,
  idleSecondsMax = 4,
  walkSpeed = 10, // units per second
  roamRadius = 8, // random target within [-roamRadius, +roamRadius] on X/Z
  blendSeconds = 0.2,
}) {
  const group = useRef();
  const gltf = useGLTF(url);
  useEffect(() => {
    gltf.scene.traverse((node) => {
      if (!node.isMesh) return;
      const mat = Array.isArray(node.material) ? node.material[0] : node.material;
      console.log("mesh:", node.name, "material:", mat?.name);
    });
}, [gltf]);






const newTexture = useLoader(THREE.TextureLoader, `${import.meta.env.BASE_URL}textures/chew_padded.png`);
newTexture.flipY = false;                 
newTexture.colorSpace = THREE.SRGBColorSpace;
newTexture.magFilter = THREE.NearestFilter;
newTexture.minFilter = THREE.NearestFilter;
newTexture.generateMipmaps = false;
newTexture.needsUpdate = true;




useEffect(() => {
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;

    const wasArray = Array.isArray(node.material);
    const srcMats = wasArray ? node.material : [node.material];

    const newMats = srcMats.map((m) => {
      if (!m) return m;

      const tex = m.map ?? null;

      // Apply pixel-art filtering to embedded texture
      if (tex) {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
      }

      const basic = new THREE.MeshBasicMaterial({
        name: m.name ? `${m.name}_unlit` : "unlit",

        map: tex,
        transparent: m.transparent ?? false,
        opacity: m.opacity ?? 1,
        alphaTest: m.alphaTest ?? 0,
        side: m.side ?? THREE.FrontSide,
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),

        // CRITICAL for animated GLB characters
        
      });

      basic.needsUpdate = true;
      return basic;
    });

    node.material = wasArray ? newMats : newMats[0];
  });
}, [gltf]);


  const { actions, names } = useAnimations(gltf.animations, group);

  // Find clips by name (idle/walk), case-insensitive.
  const { idleName, walkName } = useMemo(() => {
    const lower = names.map((n) => n.toLowerCase());
    const idleIdx = lower.findIndex((n) => n.includes("idle"));
    const walkIdx = lower.findIndex((n) => n.includes("walk"));
    return {
      idleName: idleIdx >= 0 ? names[idleIdx] : names[0],
      walkName: walkIdx >= 0 ? names[walkIdx] : names[1] ?? names[0],
    };
  }, [names]);

  const [mode, setMode] = useState("idle"); // "idle" | "walk"
  const idleTimer = useRef(0);
  const idleWait = useRef(0);
  const target = useRef(new THREE.Vector3());
  const velocity = useRef(new THREE.Vector3());

  // Helper: pick a random point on flat plane (X/Z), keep Y.
  const pickRandomTarget = () => {
    const x = (Math.random() * 2 - 1) * roamRadius;
    const z = (Math.random() * 2 - 1) * roamRadius;
    const currentY = group.current?.position.y ?? 0;
    target.current.set(x, currentY, z);
  };

  // Helper: crossfade between actions
  const crossfadeTo = (from, to) => {
    if (!from || !to || from === to) return;
    to.reset().play();
    from.crossFadeTo(to, blendSeconds, false);
  };

  // Initialize: start in idle
  useEffect(() => {
    if (!actions || !idleName || !walkName) return;

    // Stop all actions cleanly
    Object.values(actions).forEach((a) => a?.stop());

    const idle = actions[idleName];
    const walk = actions[walkName];

    idle?.setLoop(THREE.LoopRepeat, Infinity);
    idle && (idle.clampWhenFinished = false);

    walk?.setLoop(THREE.LoopRepeat, Infinity);
    walk && (walk.clampWhenFinished = false);







    // Ensure both exist
    idle?.reset().play();
    walk?.stop();

    // Choose initial idle duration
    idleTimer.current = 0;
    idleWait.current =
      idleSecondsMin + Math.random() * (idleSecondsMax - idleSecondsMin);

    setMode("idle");
  }, [actions, idleName, walkName, idleSecondsMin, idleSecondsMax]);

  useFrame((state, delta) => {
    if (!group.current) return;
    if (!actions || !idleName || !walkName) return;

    const idle = actions[idleName];
    const walk = actions[walkName];

    if (mode === "idle") {
      idleTimer.current += delta;

      // After waiting, switch to walk mode and pick a new target
      if (idleTimer.current >= idleWait.current) {
        pickRandomTarget();
        idleTimer.current = 0;
        idleWait.current =
          idleSecondsMin + Math.random() * (idleSecondsMax - idleSecondsMin);

        // Blend idle -> walk
        crossfadeTo(idle, walk);
        setMode("walk");
      }
      return;
    }

    // mode === "walk"
    const pos = group.current.position;
    const to = target.current;

    // Direction on X/Z plane only (keep Y constant)
    velocity.current.set(to.x - pos.x, 0, to.z - pos.z);

    const dist = velocity.current.length();

    // Arrive threshold
    const arriveEpsilon = 0.05;

    if (dist <= arriveEpsilon) {
      // Snap to target
      pos.set(to.x, pos.y, to.z);

      // Blend walk -> idle
      crossfadeTo(walk, idle);
      setMode("idle");
      return;
    }

    // Normalize direction and move
    velocity.current.normalize();
    pos.x += velocity.current.x * walkSpeed * delta;
    pos.z += velocity.current.z * walkSpeed * delta;

    // Face movement direction (optional, but usually desired)
    // Turn smoothly toward direction
    const desiredYaw = Math.atan2(velocity.current.x, velocity.current.z);
    const currentYaw = group.current.rotation.y;
    const turnSpeed = 8; // radians/sec-ish smoothing
    group.current.rotation.y = THREE.MathUtils.lerp(
      currentYaw,
      desiredYaw,
      1 - Math.exp(-turnSpeed * delta)
    );
  });

  return (
    <primitive
      ref={group}
      object={gltf.scene}
      scale={scale * 2}
      position={[0, 0, 0]}
    />
  );
}










function Skybox() {
  const { scene } = useThree();

  useEffect(() => {
    const loader = new THREE.CubeTextureLoader();
    const base = import.meta.env.BASE_URL;
    const texture = loader.load([
      `${base}skybox/nx_left.jpg`,
      `${base}skybox/px_right.jpg`,
      `${base}skybox/py_top.jpg`,
      `${base}skybox/ny_bottom.jpg`,
      `${base}skybox/pz_front.jpg`,
      `${base}skybox/nz_back.jpg`,
    ]);

    scene.background = texture;
  }, [scene]);

  return null;
}











export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <Canvas camera={{ position: [6, 42, 10], fov: 45 }}>
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />

        
        {/* Ground plane (visual reference) */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[50, 50]} />
          <meshStandardMaterial color="#666666" />
        </mesh>

        {/* Chew */}
        <FrogWanderer
          url={`${import.meta.env.BASE_URL}models/chew6.glb`}     
          scale={1}               
          roamRadius={12}
          walkSpeed={4}
          blendSeconds={0.2}
          idleSecondsMin={2}
          idleSecondsMax={4}
        />

        <Skybox />
        <OrbitControls />
      </Canvas>
    </div>
  );
}

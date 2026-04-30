import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, OrbitControls, ContactShadows } from "@react-three/drei";
import { Component, Suspense, useRef } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AvatarModel } from "./AvatarModel";
import { resolveAvatarUrl } from "../utils/resolveAvatarUrl";
import * as THREE from "three";
import { useAvatarTrackSubscription } from "../hooks/useAvatar";
import type { VisemeKeyframe, VisemeKey } from "../types";

interface AvatarCanvasProps {
  avatarUrl: string;
}

/** Catches WebGL / GLB load errors so the rest of the app keeps running. */
class CanvasErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean; errorMsg: string }
> {
  state = { hasError: false, errorMsg: "" };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorMsg: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn("[AvatarCanvas] Canvas error caught:", error.message, info.componentStack);
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

/** Simple placeholder avatar: head + torso + shoulders rendered with Three.js primitives. */
function PlaceholderAvatar() {
  const { chunkStartedAt, visemes } = useAvatarTrackSubscription();
  const mouth = (t: number) => {
    if (!visemes.length) return 0;
    let cur: VisemeKeyframe = visemes[0];
    for (const f of visemes) {
      if (f.time <= t) cur = f;
      else break;
    }
    const w = cur.viseme === ("sil" as VisemeKey) ? 0 : cur.weight;
    return THREE.MathUtils.clamp(w, 0, 1);
  };

  const g = useRef<THREE.Group>(null);
  const m = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const now = performance.now() / 1000;
    const idle = Math.sin(now * Math.PI * 2 * 0.25) * THREE.MathUtils.degToRad(4);
    const bob = Math.sin(now * Math.PI * 2 * 0.18) * 0.03;
    if (g.current) {
      g.current.rotation.y = idle;
      g.current.position.y = -0.6 + bob;
    }

    const elapsed = chunkStartedAt != null ? Math.max(0, (performance.now() - chunkStartedAt) / 1000) : 0;
    const open = mouth(elapsed);
    if (m.current) {
      // Scale "jaw" open/close.
      const targetY = 0.012 + open * 0.12;
      m.current.scale.y = THREE.MathUtils.lerp(m.current.scale.y, targetY, 0.25);
      m.current.position.y = 0.98 - open * 0.01;
    }
  });

  return (
    <group ref={g} position={[0, -0.6, 0]}>
      {/* Torso */}
      <mesh position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.55, 16]} />
        <meshStandardMaterial color="#1e40af" roughness={0.6} />
      </mesh>
      {/* Neck */}
      <mesh position={[0, 0.87, 0]}>
        <cylinderGeometry args={[0.065, 0.075, 0.12, 12]} />
        <meshStandardMaterial color="#b45309" roughness={0.5} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.06, 0]}>
        <sphereGeometry args={[0.155, 24, 24]} />
        <meshStandardMaterial color="#d97706" roughness={0.4} />
      </mesh>
      {/* Mouth (animated) */}
      <mesh ref={m} position={[0, 0.98, 0.14]} scale={[0.11, 0.012, 0.02]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#0f172a" roughness={0.8} />
      </mesh>
      {/* Left shoulder */}
      <mesh position={[-0.28, 0.75, 0]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#1e40af" roughness={0.5} />
      </mesh>
      {/* Right shoulder */}
      <mesh position={[0.28, 0.75, 0]}>
        <sphereGeometry args={[0.07, 12, 12]} />
        <meshStandardMaterial color="#1e40af" roughness={0.5} />
      </mesh>
    </group>
  );
}

/** Loading skeleton while GLB is fetching. */
function LoadingAvatar() {
  return (
    <mesh>
      <boxGeometry args={[0.35, 0.45, 0.22]} />
      <meshStandardMaterial color="#334155" transparent opacity={0.5} />
    </mesh>
  );
}

export function AvatarCanvas({ avatarUrl }: AvatarCanvasProps) {
  const url = resolveAvatarUrl(avatarUrl);

  const fallbackOverlay = (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      {/* Mini Three.js-free placeholder when the whole canvas crashes */}
      <div className="flex flex-col items-center gap-1 opacity-60">
        <div className="h-16 w-12 rounded-full" style={{ background: "rgb(var(--c-accent2) / 0.22)" }} />
        <div className="h-24 w-16 rounded-t-xl" style={{ background: "rgb(var(--c-accent) / 0.18)" }} />
      </div>
      <p className="text-xs text-muted">Avatar unavailable (GLB load failed)</p>
    </div>
  );

  return (
    <div
      className="panel-strong relative h-full min-h-[280px] w-full overflow-hidden md:min-h-[420px]"
      style={{
        background:
          "linear-gradient(165deg, rgb(var(--c-surface2) / 0.92), rgb(var(--c-surface) / 0.72))",
      }}
    >
      <CanvasErrorBoundary fallback={fallbackOverlay}>
        <Canvas camera={{ position: [0, 1.15, 2.45], fov: 28 }} dpr={[1, 2]} gl={{ alpha: true }}>
          <ambientLight intensity={0.55} />
          <directionalLight position={[2, 3, 2]} intensity={1.1} castShadow />
          <Suspense fallback={<LoadingAvatar />}>
            <AvatarModel url={url} fallback={<PlaceholderAvatar />} />
            <ContactShadows opacity={0.45} scale={10} blur={2.4} far={4} position={[0, -1.35, 0]} />
            <Environment preset="city" />
          </Suspense>
          <OrbitControls
            enablePan={false}
            minPolarAngle={Math.PI / 2.35}
            maxPolarAngle={Math.PI / 2}
            minDistance={1.6}
            maxDistance={3.2}
            target={[0, 1.05, 0]}
          />
        </Canvas>
      </CanvasErrorBoundary>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{
          background: "linear-gradient(180deg, transparent, rgb(var(--c-bg) / 0.55))",
        }}
      />
    </div>
  );
}

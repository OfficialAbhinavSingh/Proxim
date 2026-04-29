import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, ContactShadows } from "@react-three/drei";
import { Component, Suspense } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AvatarModel } from "./AvatarModel";
import { resolveAvatarUrl } from "../utils/resolveAvatarUrl";

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
  return (
    <group position={[0, -0.6, 0]}>
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
        <div className="h-16 w-12 rounded-full bg-blue-900/80" />
        <div className="h-24 w-16 rounded-t-xl bg-blue-800/80" />
      </div>
      <p className="text-xs text-slate-500">Avatar unavailable (GLB load failed)</p>
    </div>
  );

  return (
    <div className="relative h-full min-h-[280px] w-full overflow-hidden rounded-2xl bg-gradient-to-b from-proxim-800 to-proxim-950 shadow-inner ring-1 ring-white/10 md:min-h-[420px]">
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-proxim-950/90 to-transparent" />
    </div>
  );
}

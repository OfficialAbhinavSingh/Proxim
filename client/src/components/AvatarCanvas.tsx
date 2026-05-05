import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, ContactShadows } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { AvatarModel } from "./AvatarModel";
import {
  buildRpmLoadCandidateUrls,
  isProxiedRpmAssetUrl,
  resolveAvatarUrl,
} from "../utils/resolveAvatarUrl";
import * as THREE from "three";
import { useAvatarTrackSubscription } from "../hooks/useAvatar";
import type { VisemeKeyframe, VisemeKey } from "../types";

interface AvatarCanvasProps {
  avatarUrl: string;
}

/**
 * Locks the default scene camera every frame. Drei's `<PerspectiveCamera>` runs internal
 * layout/render logic that can fight with other systems; pinning here stops any drift
 * (trackpad zoom, env helpers, mistaken bindings) from dollying through the face mesh.
 */
function PinBustCamera() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const pos = useMemo(() => new THREE.Vector3(0, 1.48, 0.82), []);
  const target = useMemo(() => new THREE.Vector3(0, 1.46, 0), []);

  useFrame(() => {
    camera.position.copy(pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    if (camera instanceof THREE.PerspectiveCamera) {
      // Flex/resize glitches can briefly report a ~0 height; unclamped aspect blows up WebGL + layout.
      const h = Math.max(1, size.height);
      const w = Math.max(1, size.width);
      const nextAspect = THREE.MathUtils.clamp(w / h, 0.02, 32);
      if (Math.abs(camera.aspect - nextAspect) > 1e-6) {
        camera.aspect = nextAspect;
        camera.updateProjectionMatrix();
      }
    }
  });

  return null;
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

/**
 * Placeholder avatar rendered from Three.js primitives.
 * BASE_Y = 0.52 puts the head at world-y ≈ 1.58, centred in the bust camera
 * (camera at y=1.48 looking at y=1.46, fov=32 → visible range ≈ [1.22, 1.70]).
 */
function PlaceholderAvatar() {
  const { chunkStartedAt, visemes } = useAvatarTrackSubscription();
  const BASE_Y = 0.52;

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
    const idle = Math.sin(now * Math.PI * 2 * 0.25) * THREE.MathUtils.degToRad(3.5);
    const bob = Math.sin(now * Math.PI * 2 * 0.18) * 0.018;
    if (g.current) {
      g.current.rotation.y = idle;
      g.current.position.y = BASE_Y + bob;
    }
    const elapsed = chunkStartedAt != null ? Math.max(0, (performance.now() - chunkStartedAt) / 1000) : 0;
    const open = mouth(elapsed);
    if (m.current) {
      const targetY = 0.012 + open * 0.12;
      m.current.scale.y = THREE.MathUtils.lerp(m.current.scale.y, targetY, 0.25);
      m.current.position.y = 0.98 - open * 0.01;
    }
  });

  return (
    <group ref={g} position={[0, BASE_Y, 0]}>
      {/* Jacket / torso */}
      <mesh position={[0, 0.40, 0]}>
        <cylinderGeometry args={[0.19, 0.25, 0.62, 18]} />
        <meshStandardMaterial color="#1e3a5f" roughness={0.55} metalness={0.08} />
      </mesh>
      {/* White collar */}
      <mesh position={[0, 0.73, 0.045]}>
        <boxGeometry args={[0.13, 0.055, 0.035]} />
        <meshStandardMaterial color="#e8e8e8" roughness={0.3} />
      </mesh>
      {/* Neck */}
      <mesh position={[0, 0.84, 0]}>
        <cylinderGeometry args={[0.058, 0.068, 0.14, 12]} />
        <meshStandardMaterial color="#c09275" roughness={0.5} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.06, 0]}>
        <sphereGeometry args={[0.155, 28, 28]} />
        <meshStandardMaterial color="#c8956c" roughness={0.35} />
      </mesh>
      {/* Hair cap (hemisphere on top of head) */}
      <mesh position={[0, 1.185, 0]} scale={[1.0, 0.55, 1.0]}>
        <sphereGeometry args={[0.168, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#1a0a05" roughness={0.85} />
      </mesh>
      {/* Left eye white */}
      <mesh position={[-0.057, 1.075, 0.134]}>
        <sphereGeometry args={[0.023, 10, 10]} />
        <meshStandardMaterial color="#f2f2f2" roughness={0.15} />
      </mesh>
      {/* Left pupil */}
      <mesh position={[-0.057, 1.075, 0.154]}>
        <sphereGeometry args={[0.012, 8, 8]} />
        <meshStandardMaterial color="#120600" roughness={0.9} />
      </mesh>
      {/* Right eye white */}
      <mesh position={[0.057, 1.075, 0.134]}>
        <sphereGeometry args={[0.023, 10, 10]} />
        <meshStandardMaterial color="#f2f2f2" roughness={0.15} />
      </mesh>
      {/* Right pupil */}
      <mesh position={[0.057, 1.075, 0.154]}>
        <sphereGeometry args={[0.012, 8, 8]} />
        <meshStandardMaterial color="#120600" roughness={0.9} />
      </mesh>
      {/* Mouth (animated open/close) */}
      <mesh ref={m} position={[0, 0.98, 0.143]} scale={[0.095, 0.012, 0.018]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6b2737" roughness={0.7} />
      </mesh>
      {/* Left shoulder */}
      <mesh position={[-0.265, 0.70, 0]}>
        <sphereGeometry args={[0.088, 12, 12]} />
        <meshStandardMaterial color="#162e52" roughness={0.55} metalness={0.08} />
      </mesh>
      {/* Right shoulder */}
      <mesh position={[0.265, 0.70, 0]}>
        <sphereGeometry args={[0.088, 12, 12]} />
        <meshStandardMaterial color="#162e52" roughness={0.55} metalness={0.08} />
      </mesh>
    </group>
  );
}

export function AvatarCanvas({ avatarUrl }: AvatarCanvasProps) {
  /** Final GLB URL after optional RPM proxy preflight (avoids 502 loop + runaway canvas when load fails). */
  const [gltfUrl, setGltfUrl] = useState<string | null>(null);
  /**
   * If the GLB hasn't loaded within AVATAR_LOAD_TIMEOUT_MS, stop waiting and show
   * PlaceholderAvatar. This handles blocked / slow CDNs (e.g. models.readyplayer.me
   * unreachable on some networks) without hanging the canvas forever.
   */
  // 30 s — RPM GLBs can be 5–20 MB; 5 s was firing before the download finished.
  const AVATAR_LOAD_TIMEOUT_MS = 30_000;
  const [avatarTimedOut, setAvatarTimedOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let fromOverride = false;
    try {
      const o = window.localStorage.getItem("proxim.avatarOverrideUrl");
      fromOverride = !!(o && o.trim());
    } catch {
      /* ignore */
    }
    const resolved = resolveAvatarUrl(avatarUrl);
    const rpmCandidates = fromOverride ? null : buildRpmLoadCandidateUrls(avatarUrl);

    const isSameOriginOrLocalApi = (u: string) => {
      if (u.startsWith("/__rpm/")) return true;
      try {
        const p = new URL(u, window.location.href);
        if (p.origin === window.location.origin) return true;
        if (p.hostname === "localhost" || p.hostname === "127.0.0.1") return true;
      } catch {
        return false;
      }
      return false;
    };

    if (!rpmCandidates?.length) {
      setGltfUrl(resolved);
      return () => {
        cancelled = true;
      };
    }

    if (!isProxiedRpmAssetUrl(resolved) && !resolved.startsWith("/__rpm/")) {
      setGltfUrl(resolved);
      return () => {
        cancelled = true;
      };
    }

    setGltfUrl(null);
    void (async () => {
      for (const u of rpmCandidates) {
        if (cancelled) return;
        if (!isSameOriginOrLocalApi(u)) continue;
        try {
          const r = await fetch(u, { method: "HEAD", cache: "no-store" });
          if (cancelled) return;
          if (r.ok) {
            setGltfUrl(u);
            return;
          }
        } catch {
          /* try next candidate */
        }
      }
      if (!cancelled) {
        const preferApiOverBrokenVite =
          rpmCandidates.length > 1 && rpmCandidates[0].startsWith("/__rpm/");
        setGltfUrl((preferApiOverBrokenVite ? rpmCandidates[1] : rpmCandidates[0]) ?? resolved);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [avatarUrl]);

  // Reset + start the per-URL load timeout whenever gltfUrl changes.
  useEffect(() => {
    if (!gltfUrl) return;
    setAvatarTimedOut(false);
    const id = setTimeout(() => setAvatarTimedOut(true), AVATAR_LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [gltfUrl]); // eslint-disable-line react-hooks/exhaustive-deps

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
      className="panel-strong relative w-full overflow-hidden"
      style={{
        height: "clamp(280px, min(52vh, 560px), 620px)",
        background:
          "linear-gradient(165deg, rgb(var(--c-surface2) / 0.92), rgb(var(--c-surface) / 0.72))",
      }}
    >
      {!gltfUrl ? (
        <div className="flex h-full w-full items-center justify-center">
          <p className="text-xs text-muted">Preparing avatar…</p>
        </div>
      ) : (
        <CanvasErrorBoundary fallback={fallbackOverlay}>
          <Canvas
            key={gltfUrl}
            className="block h-full w-full touch-none"
            style={{ width: "100%", height: "100%", display: "block" }}
            dpr={[1, 2]}
            gl={{ alpha: true }}
            camera={{ position: [0, 1.48, 0.82], fov: 32, near: 0.08, far: 80 }}
            onCreated={({ camera }) => {
              camera.up.set(0, 1, 0);
              camera.lookAt(0, 1.46, 0);
            }}
          >
            <PinBustCamera />
            <ambientLight intensity={0.55} />
            <directionalLight position={[2, 3, 2]} intensity={1.1} castShadow />
            {/* PlaceholderAvatar is used as both Suspense fallback and timeout fallback so
                the canvas is never black: it shows instantly while the GLB loads, and
                permanently when the CDN is unreachable (models.readyplayer.me blocked). */}
            <Suspense fallback={<PlaceholderAvatar />}>
              {avatarTimedOut ? (
                <PlaceholderAvatar />
              ) : (
                <AvatarModel url={gltfUrl} fallback={<PlaceholderAvatar />} />
              )}
              <ContactShadows opacity={0.45} scale={10} blur={2.4} far={4} position={[0, -1.42, 0]} />
              <Environment preset="city" />
            </Suspense>
          </Canvas>
        </CanvasErrorBoundary>
      )}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
        style={{
          background: "linear-gradient(180deg, transparent, rgb(var(--c-bg) / 0.55))",
        }}
      />
    </div>
  );
}

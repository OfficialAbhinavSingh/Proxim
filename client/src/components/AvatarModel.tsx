import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useAvatarMorphs, useAvatarIdleClock, useAvatarTrackSubscription } from "../hooks/useAvatar";
import { useSessionStore } from "../store/sessionStore";
import { useAvatarStore } from "../store/avatarStore";
import { KTX2Loader } from "three-stdlib";
import type { VisemeKeyframe, VisemeKey } from "../types";

type MorphHost = THREE.SkinnedMesh | THREE.Mesh;

function findMorphHost(root: THREE.Object3D): { mesh: MorphHost; dict: Record<string, number> } | null {
  let bestScore = -1;
  let picked: { mesh: MorphHost; dict: Record<string, number> } | null = null;
  root.traverse((obj) => {
    const m = obj as MorphHost;
    const meshAny = m as unknown as { isSkinnedMesh?: boolean; isMesh?: boolean };
    if (!meshAny.isMesh && !meshAny.isSkinnedMesh) return;
    const dict = m.morphTargetDictionary as Record<string, number> | undefined;
    const infl = m.morphTargetInfluences;
    if (!dict || !infl) return;
    const keys = Object.keys(dict);
    const lower = keys.map((k) => k.toLowerCase());
    const visemeCount = lower.filter((k) => k.startsWith("viseme_") || k.includes("viseme")).length;
    // Many GLBs (ARKit / MetaHuman / Apple blendshapes) don't have `viseme_*` but do have mouth/jaw shapes.
    const mouthCount = lower.filter(
      (k) =>
        k.includes("mouth") ||
        k.includes("jaw") ||
        k.includes("lip") ||
        k.includes("smile") ||
        k.includes("funnel") ||
        k.includes("pucker")
    ).length;
    const blinkCount = lower.filter((k) => k.includes("blink") || k.includes("eyeclose") || k.includes("eye_close")).length;
    const emotionCount = lower.filter((k) => k.startsWith("emotion_")).length;
    // Prefer meshes that look like a face:
    // - Strongly prefer visemes
    // - Prefer head/face meshes over eyes/teeth (RPM often has separate EyeLeft/EyeRight meshes)
    const name = (m.name || "").toLowerCase();
    const isHeadLike = /head|face|wolf3d|avatar/i.test(name);
    const isEyeLike = /eye|eyelash|brow/i.test(name);
    const isTeethLike = /teeth|tongue/i.test(name);

    // Base score from morph inventory.
    let score = visemeCount * 100 + mouthCount * 6 + blinkCount * 2 + emotionCount;
    // Name-based priors.
    if (isHeadLike) score += 5000;
    if (isTeethLike) score -= 500; // teeth meshes can have mouthOpen etc but not the full face
    if (isEyeLike) score -= 8000; // avoid selecting eye meshes even if they expose some viseme keys

    // Hard requirement: if it has viseme keys but also looks like an eye, don't pick it.
    if (isEyeLike && visemeCount > 0) score -= 20000;
    if (score > bestScore) {
      bestScore = score;
      picked = { mesh: m as MorphHost, dict };
    }
  });
  return picked;
}

function findBlinkIndex(dict: Record<string, number>): number | undefined {
  const keys = Object.keys(dict);
  const preferred = ["eyeBlinkLeft", "eyeBlinkRight", "eyesClosed", "EyeBlink_L", "EyeBlink_R"];
  for (const p of preferred) {
    if (typeof dict[p] === "number") return dict[p];
  }
  const k = keys.find((x) => /blink/i.test(x) && !/viseme/i.test(x));
  return k !== undefined ? dict[k] : undefined;
}

function findFirstBoneByName(root: THREE.Object3D, patterns: RegExp[]): THREE.Bone | null {
  let picked: THREE.Bone | null = null;
  root.traverse((obj) => {
    if (picked) return;
    if (!(obj as THREE.Bone).isBone) return;
    const b = obj as THREE.Bone;
    const n = b.name || "";
    if (patterns.some((p) => p.test(n))) picked = b;
  });
  return picked;
}

function pickVisemeAtTime(frames: VisemeKeyframe[], t: number): { key: VisemeKey; weight: number } {
  if (!frames.length) return { key: "sil", weight: 0 };
  let cur = frames[0];
  for (const f of frames) {
    if (f.time <= t) cur = f;
    else break;
  }
  return { key: cur.viseme, weight: cur.weight };
}

interface AvatarModelProps {
  url: string;
  /** Rendered instead of the GLB when the model fails to load. */
  fallback?: ReactNode;
}

/**
 * Loads a Ready Player Me GLB and drives viseme / emotion morph targets each frame.
 * If the GLB fetch fails (network error, 404, CORS) it renders the `fallback` node
 * instead of propagating the error up to crash the canvas.
 */
export function AvatarModel({ url, fallback }: AvatarModelProps) {
  return <AvatarModelInner url={url} fallback={fallback} />;
}

function AvatarModelInner({
  url,
  fallback,
}: {
  url: string;
  fallback?: ReactNode;
}) {
  const gl = useThree((s) => s.gl);
  // Record the resolved URL so diagnostics can confirm what we attempted to load.
  useEffect(() => {
    useAvatarStore.getState().setAvatarAssetInfo({ resolvedUrl: url, loadError: null });
  }, [url]);

  // Ready Player Me GLBs commonly use KTX2/Basis textures (KHR_texture_basisu).
  // Configure KTX2Loader per renderer, and attach it to GLTFLoader via drei's extendLoader.
  const ktx2 = useMemo(() => {
    const loader = new KTX2Loader();
    loader.setTranscoderPath("https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/basis/");
    loader.detectSupport(gl);
    return loader;
  }, [gl]);

  useEffect(() => {
    return () => {
      try {
        ktx2.dispose();
      } catch {
        // ignore
      }
    };
  }, [ktx2]);

  let gltf: ReturnType<typeof useGLTF> | null = null;
  try {
    // useGLTF suspends while loading; on error it throws which Suspense re-throws
    // eslint-disable-next-line react-hooks/rules-of-hooks
    gltf = useGLTF(url, true, true, (loader) => {
      // three-stdlib GLTFLoader supports KTX2Loader via setKTX2Loader.
      (loader as unknown as { setKTX2Loader?: (l: KTX2Loader) => void }).setKTX2Loader?.(ktx2);
    });
  } catch (e) {
    // If it's a Promise (suspense), rethrow so Suspense can handle it
    if (e instanceof Promise) throw e;
    // Otherwise it's a real error — render fallback without setState during render.
    console.warn("[AvatarModel] GLB load failed:", e);
    useAvatarStore.getState().setAvatarAssetInfo({
      resolvedUrl: url,
      loadError: e instanceof Error ? e.message : String(e),
      loadedAt: null,
    });
    return <>{fallback ?? null}</>;
  }

  const { scene } = gltf;
  const clone = useMemo(() => scene.clone(true), [scene]);
  const group = useRef<THREE.Group>(null);
  const [morphHost, setMorphHost] = useState<{ mesh: MorphHost; dict: Record<string, number> } | null>(
    null
  );

  useLayoutEffect(() => {
    const host = findMorphHost(clone);
    setMorphHost(host);
    if (!host) {
      useAvatarStore.getState().setMorphInventory(0);
      useAvatarStore.getState().setMorphHostInfo({
        meshName: null,
        morphKeySample: [],
        totalMorphTargets: 0,
      });
      return;
    }
    const keys = Object.keys(host.dict);
    const count = keys.filter((k) => /^viseme_/i.test(k) || /^Viseme_/i.test(k) || /viseme/i.test(k)).length;
    useAvatarStore.getState().setMorphInventory(count);
    useAvatarStore.getState().setMorphHostInfo({
      meshName: host.mesh.name || "(unnamed-mesh)",
      morphKeySample: keys.slice(0, 35),
      totalMorphTargets: keys.length,
    });
  }, [clone]);

  // Mark successful load for diagnostics.
  useEffect(() => {
    useAvatarStore.getState().setAvatarAssetInfo({
      resolvedUrl: url,
      loadError: null,
      loadedAt: Date.now(),
    });
  }, [url]);

  // Auto-frame: center model & scale to consistent height so camera shows full body.
  useLayoutEffect(() => {
    const g = group.current;
    if (!g) return;

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Avoid divide-by-zero if a model is malformed.
    const height = Math.max(0.0001, size.y || 0.0001);
    const desiredHeight = 1.65;
    const scale = desiredHeight / height;

    // Move model so it's centered on X/Z, and its feet are near our shadow plane.
    // Many humanoid rigs have origin at feet; others are centered. Using bbox minY is robust.
    g.scale.setScalar(scale);
    // Previous hard-coded offset (-1.25) worked for one demo GLB but pushes RPM avatars far below frame.
    // Place feet near y=-1.25 only when the model would otherwise float too high.
    const feetY = -box.min.y * scale;
    const desiredFeetY = -1.25;
    // Clamp keeps the avatar from sinking out of view while still sitting nicely on the shadow plane.
    const yBase = THREE.MathUtils.clamp(feetY, desiredFeetY - 0.2, desiredFeetY + 1.2);
    // Nudge avatar down slightly so shoulders enter frame under the bust camera.
    const bustFrameNudge = -0.11;
    g.position.set(-center.x * scale, yBase + bustFrameNudge, -center.z * scale);
  }, [clone]);

  const { applyFrame } = useAvatarMorphs(morphHost?.dict);
  const { tickIdle } = useAvatarIdleClock();
  const { chunkStartedAt, visemes } = useAvatarTrackSubscription();
  const currentEmotion = useSessionStore((s) => s.currentEmotion);

  const blinkIdx = useMemo(
    () => (morphHost ? findBlinkIndex(morphHost.dict) : undefined),
    [morphHost]
  );

  // Cache commonly named bones for simple procedural animation.
  const bones = useMemo(() => {
    const root = clone as unknown as THREE.Object3D;
    const head =
      findFirstBoneByName(root, [/^head$/i, /head/i]) ??
      findFirstBoneByName(root, [/neck/i, /spine.*3/i, /spine.*2/i, /spine/i]);
    const spine = findFirstBoneByName(root, [/spine/i, /chest/i, /upperchest/i, /hips/i, /^hips$/i]);
    // RPM rigs commonly use LeftShoulder/LeftArm/LeftForeArm naming.
    const lArm = findFirstBoneByName(root, [/leftshoulder/i, /leftarm/i, /leftupperarm/i, /l.*upperarm/i, /^arm_l/i, /upperarm_l/i]);
    const rArm = findFirstBoneByName(root, [/rightshoulder/i, /rightarm/i, /rightupperarm/i, /r.*upperarm/i, /^arm_r/i, /upperarm_r/i]);
    const lFore = findFirstBoneByName(root, [/leftforearm/i, /leftlowerarm/i, /l.*forearm/i, /^forearm_l/i, /lowerarm_l/i]);
    const rFore = findFirstBoneByName(root, [/rightforearm/i, /rightlowerarm/i, /r.*forearm/i, /^forearm_r/i, /lowerarm_r/i]);
    return { head, spine, lArm, rArm, lFore, rFore };
  }, [clone]);

  const restRot = useRef<{
    head?: THREE.Euler;
    spine?: THREE.Euler;
    lArm?: THREE.Euler;
    rArm?: THREE.Euler;
    lFore?: THREE.Euler;
    rFore?: THREE.Euler;
  }>({});

  useLayoutEffect(() => {
    // Store rest rotations once we have the bones.
    restRot.current = {
      head: bones.head?.rotation.clone(),
      spine: bones.spine?.rotation.clone(),
      lArm: bones.lArm?.rotation.clone(),
      rArm: bones.rArm?.rotation.clone(),
      lFore: bones.lFore?.rotation.clone(),
      rFore: bones.rFore?.rotation.clone(),
    };
  }, [bones]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;

    const infl = morphHost?.mesh.morphTargetInfluences;

    const elapsed =
      chunkStartedAt != null ? Math.max(0, (performance.now() - chunkStartedAt) / 1000) : 0;
    const frames = visemes.length ? visemes : [{ time: 0, viseme: "sil" as const, weight: 0 }];
    if (infl && morphHost) {
      applyFrame(infl, elapsed, frames, currentEmotion);
    }

    // Speaking intensity (0..1) from current viseme frame.
    const { key, weight } = pickVisemeAtTime(frames, elapsed);
    const speaking = key !== "sil" ? THREE.MathUtils.clamp(weight, 0, 1) : 0;

    // Idle/blink: drive the head bone when possible (looks much more natural than rotating whole model).
    tickIdle(dt, bones.head ?? g, infl, blinkIdx);

    // Procedural body language.
    // - Always: gentle breathing + torso sway.
    // - While speaking: arm gestures get stronger.
    const t = performance.now() / 1000;
    const gesture = THREE.MathUtils.smoothstep(speaking, 0.05, 0.65);
    const breathe = Math.sin(t * Math.PI * 2 * 0.22) * THREE.MathUtils.degToRad(2.2);
    const sway = Math.sin(t * Math.PI * 2 * 0.12) * THREE.MathUtils.degToRad(2.6);
    const talkBob = Math.sin(t * Math.PI * 2 * (1.6 + gesture * 0.4)) * THREE.MathUtils.degToRad(2.0) * gesture;

    const applyBone = (bone: THREE.Bone | null, base: THREE.Euler | undefined, dx: number, dy: number, dz: number) => {
      if (!bone || !base) return;
      bone.rotation.x = THREE.MathUtils.lerp(bone.rotation.x, base.x + dx, 0.18);
      bone.rotation.y = THREE.MathUtils.lerp(bone.rotation.y, base.y + dy, 0.18);
      bone.rotation.z = THREE.MathUtils.lerp(bone.rotation.z, base.z + dz, 0.18);
    };

    applyBone(bones.spine, restRot.current.spine, breathe + talkBob * 0.5, sway * 0.4, sway * 0.25);

    // Arms: small idle motion, bigger gestures when speaking.
    const armSwing = Math.sin(t * Math.PI * 2 * 0.35) * THREE.MathUtils.degToRad(3.6);
    const gestureLift = THREE.MathUtils.degToRad(16) * gesture;
    const gestureOut = THREE.MathUtils.degToRad(10) * gesture * Math.sin(t * Math.PI * 2 * 0.55);
    applyBone(bones.lArm, restRot.current.lArm, armSwing - gestureLift * 0.7, -gestureOut * 0.25, gestureOut * 0.35);
    applyBone(bones.rArm, restRot.current.rArm, -armSwing - gestureLift * 0.7, gestureOut * 0.25, -gestureOut * 0.35);

    // Forearms: follow-through.
    applyBone(bones.lFore, restRot.current.lFore, -gestureLift * 0.25, -gestureOut * 0.15, gestureOut * 0.15);
    applyBone(bones.rFore, restRot.current.rFore, -gestureLift * 0.25, gestureOut * 0.15, -gestureOut * 0.15);
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={clone} />
    </group>
  );
}

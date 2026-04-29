import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Emotion, VisemeKeyframe, VisemeKey } from "../types";
import { useAvatarStore, visemeToMorphName } from "../store/avatarStore";

const LERP = 0.35;

const ALL_VISEMES: VisemeKey[] = [
  "sil",
  "PP",
  "FF",
  "TH",
  "DD",
  "kk",
  "CH",
  "SS",
  "nn",
  "RR",
  "aa",
  "E",
  "ih",
  "oh",
  "ou",
];

function pickVisemeAtTime(frames: VisemeKeyframe[], t: number): { key: VisemeKey; weight: number } {
  if (!frames.length) return { key: "sil", weight: 0 };
  let cur = frames[0];
  for (const f of frames) {
    if (f.time <= t) cur = f;
    else break;
  }
  return { key: cur.viseme, weight: cur.weight };
}

export function useAvatarMorphs(morphDict: Record<string, number> | undefined) {
  const indices = useMemo(() => {
    if (!morphDict) return {} as Partial<Record<VisemeKey, number>>;
    const out: Partial<Record<VisemeKey, number>> = {};
    for (const v of ALL_VISEMES) {
      const name = visemeToMorphName(v);
      const idx = morphDict[name];
      if (typeof idx === "number") out[v] = idx;
    }
    return out;
  }, [morphDict]);

  const emotionIndices = useMemo(() => {
    if (!morphDict) return {} as Record<string, number>;
    const keys = ["emotion_neutral", "emotion_engaged", "emotion_skeptical", "emotion_positive"];
    const map: Record<string, number> = {};
    for (const k of keys) {
      if (typeof morphDict[k] === "number") map[k] = morphDict[k];
    }
    return map;
  }, [morphDict]);

  const applyFrame = (
    influences: number[],
    elapsed: number,
    frames: VisemeKeyframe[],
    emotion: Emotion
  ) => {
    const { key, weight } = pickVisemeAtTime(frames, elapsed);
    for (const v of ALL_VISEMES) {
      const idx = indices[v];
      if (typeof idx !== "number") continue;
      const target = v === key ? weight : 0;
      influences[idx] = THREE.MathUtils.lerp(influences[idx] ?? 0, target, LERP);
    }

    const emNameByEmotion: Record<Emotion, string> = {
      neutral: "emotion_neutral",
      engaged: "emotion_engaged",
      skeptical: "emotion_skeptical",
      positive: "emotion_positive",
    };
    const activeName = emNameByEmotion[emotion];
    for (const [n, i] of Object.entries(emotionIndices)) {
      const target = n === activeName ? 0.75 : 0;
      influences[i] = THREE.MathUtils.lerp(influences[i] ?? 0, target, LERP);
    }
  };

  return { applyFrame, indices, emotionIndices };
}

export function useAvatarIdleClock() {
  const blinkRef = useRef({ nextAt: 0, phase: "open" as "open" | "close", until: 0 });
  const tRef = useRef(0);

  const tickIdle = (dt: number, head: THREE.Object3D, influences: number[] | undefined, blinkIdx: number | undefined) => {
    tRef.current += dt;
    const t = tRef.current;
    head.rotation.y = Math.sin(t * Math.PI * 2 * 0.25) * THREE.MathUtils.degToRad(3);
    head.rotation.x = Math.sin(t * Math.PI * 2 * 0.125) * THREE.MathUtils.degToRad(1.5);
    const s = 1 + Math.sin(t * Math.PI * 2 * 0.2) * 0.008;
    head.scale.setScalar(s);

    if (typeof blinkIdx !== "number" || !influences) return;
    const now = performance.now() / 1000;
    if (blinkRef.current.phase === "open" && now >= blinkRef.current.nextAt) {
      blinkRef.current.phase = "close";
      blinkRef.current.until = now + 0.15;
    } else if (blinkRef.current.phase === "close" && now >= blinkRef.current.until) {
      blinkRef.current.phase = "open";
      blinkRef.current.nextAt = now + 3 + Math.random() * 2;
    }
    const blink = blinkRef.current.phase === "close" ? 1 : 0;
    influences[blinkIdx] = THREE.MathUtils.lerp(influences[blinkIdx] ?? 0, blink, 0.45);
  };

  return { tickIdle };
}

export function useAvatarTrackSubscription() {
  const chunkStartedAt = useAvatarStore((s) => s.chunkStartedAt);
  const visemes = useAvatarStore((s) => s.visemes);
  return { chunkStartedAt, visemes };
}

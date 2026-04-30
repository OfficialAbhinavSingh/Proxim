import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Emotion, VisemeKeyframe, VisemeKey } from "../types";
import { useAvatarStore, visemeToMorphName } from "../store/avatarStore";

const LERP = 0.35;
const TRANSITION_WINDOW_SEC = 0.07;

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

type MorphIndexMap = Record<string, number>;

function normalizeKey(k: string): string {
  return k.trim().toLowerCase();
}

function firstIndex(dict: MorphIndexMap, candidates: string[]): number | undefined {
  for (const c of candidates) {
    const idx = dict[normalizeKey(c)];
    if (typeof idx === "number") return idx;
  }
  return undefined;
}

// Fallback mapping when a model doesn't ship Oculus viseme_* targets (common on ARKit rigs).
// We drive a handful of mouth/jaw shapes so the avatar still "speaks" in demos.
const FALLBACK_MORPHS_BY_VISEME: Partial<Record<VisemeKey, string[]>> = {
  sil: ["mouthClose", "jawOpen", "mouthOpen"],
  PP: ["mouthClose", "mouthPressLeft", "mouthPressRight", "mouthShrugUpper", "mouthShrugLower"],
  FF: ["mouthFunnel", "mouthPucker", "mouthRollUpper", "mouthRollLower", "mouthClose"],
  TH: ["tongueOut", "mouthOpen", "jawOpen"],
  DD: ["jawOpen", "mouthOpen", "mouthClose"],
  kk: ["jawOpen", "mouthOpen"],
  CH: ["mouthFunnel", "mouthPucker", "jawOpen", "mouthOpen"],
  SS: ["mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthOpen"],
  nn: ["jawOpen", "mouthClose", "mouthShrugLower"],
  RR: ["mouthFunnel", "mouthPucker", "jawOpen"],
  aa: ["jawOpen", "mouthOpen"],
  E: ["mouthSmileLeft", "mouthSmileRight", "mouthOpen"],
  ih: ["mouthSmileLeft", "mouthSmileRight", "jawOpen", "mouthOpen"],
  oh: ["mouthFunnel", "mouthPucker", "jawOpen"],
  ou: ["mouthPucker", "mouthFunnel", "jawOpen"],
};

function pickVisemeBlendAtTime(
  frames: VisemeKeyframe[],
  t: number
): { curKey: VisemeKey; curWeight: number; nextKey: VisemeKey; nextWeight: number; alpha: number } {
  if (!frames.length) {
    return { curKey: "sil", curWeight: 0, nextKey: "sil", nextWeight: 0, alpha: 0 };
  }

  let cur = frames[0];
  let next: VisemeKeyframe | undefined;

  for (const f of frames) {
    if (f.time <= t) cur = f;
    else {
      next = f;
      break;
    }
  }

  if (!next) {
    return { curKey: cur.viseme, curWeight: cur.weight, nextKey: cur.viseme, nextWeight: cur.weight, alpha: 0 };
  }

  const timeToNext = next.time - t;
  const alpha = THREE.MathUtils.smoothstep(TRANSITION_WINDOW_SEC - timeToNext, 0, TRANSITION_WINDOW_SEC);
  return { curKey: cur.viseme, curWeight: cur.weight, nextKey: next.viseme, nextWeight: next.weight, alpha };
}

export function useAvatarMorphs(morphDict: Record<string, number> | undefined) {
  const indices = useMemo(() => {
    if (!morphDict) return {} as Partial<Record<VisemeKey, number>>;

    // Case-insensitive lookup: some GLBs use `Viseme_PP` instead of `viseme_PP`, etc.
    const lowerToIdx: Record<string, number> = {};
    for (const [k, v] of Object.entries(morphDict)) lowerToIdx[normalizeKey(k)] = v;

    const out: Partial<Record<VisemeKey, number>> = {};
    for (const v of ALL_VISEMES) {
      const name = visemeToMorphName(v);
      const idx = morphDict[name] ?? lowerToIdx[name.toLowerCase()];
      if (typeof idx === "number") out[v] = idx;
    }
    return out;
  }, [morphDict]);

  const fallback = useMemo(() => {
    if (!morphDict) {
      return { hasOculusVisemes: false, lowerToIdx: {} as MorphIndexMap, idxByViseme: {} as Partial<Record<VisemeKey, number>>, usedIndices: [] as number[] };
    }
    const lowerToIdx: MorphIndexMap = {};
    for (const [k, v] of Object.entries(morphDict)) lowerToIdx[normalizeKey(k)] = v;

    const hasOculusVisemes = Object.keys(lowerToIdx).some((k) => k.startsWith("viseme_") || k.includes("viseme"));
    const idxByViseme: Partial<Record<VisemeKey, number>> = {};
    const used: number[] = [];
    for (const v of ALL_VISEMES) {
      const list = FALLBACK_MORPHS_BY_VISEME[v] ?? [];
      const idx = firstIndex(lowerToIdx, list);
      if (typeof idx === "number") {
        idxByViseme[v] = idx;
        used.push(idx);
      }
    }
    return { hasOculusVisemes, lowerToIdx, idxByViseme, usedIndices: Array.from(new Set(used)) };
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
    const { curKey, curWeight, nextKey, nextWeight, alpha } = pickVisemeBlendAtTime(frames, elapsed);

    const hasResolvedOculusVisemes = Object.values(indices).some((x) => typeof x === "number");

    if (hasResolvedOculusVisemes) {
      for (const v of ALL_VISEMES) {
        const idx = indices[v];
        if (typeof idx !== "number") continue;
        let target = 0;
        if (v === curKey) target += curWeight * (1 - alpha);
        if (v === nextKey) target += nextWeight * alpha;
        influences[idx] = THREE.MathUtils.lerp(influences[idx] ?? 0, target, LERP);
      }
    } else {
      // ARKit-ish fallback: drive one best mouth/jaw target per viseme.
      // Zero all used fallback indices first to avoid carryover.
      for (const idx of fallback.usedIndices) {
        influences[idx] = THREE.MathUtils.lerp(influences[idx] ?? 0, 0, LERP);
      }
      const setTarget = (v: VisemeKey, w: number) => {
        const idx = fallback.idxByViseme[v];
        if (typeof idx !== "number") return;
        influences[idx] = THREE.MathUtils.lerp(influences[idx] ?? 0, w, LERP);
      };
      setTarget(curKey, curWeight * (1 - alpha));
      setTarget(nextKey, nextWeight * alpha);
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
    // Make motion slightly more obvious (helps verify the render loop is alive).
    head.rotation.y = Math.sin(t * Math.PI * 2 * 0.25) * THREE.MathUtils.degToRad(6);
    head.rotation.x = Math.sin(t * Math.PI * 2 * 0.125) * THREE.MathUtils.degToRad(3);
    const s = 1 + Math.sin(t * Math.PI * 2 * 0.2) * 0.014;
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
  const lastChunk = useAvatarStore((s) => s.lastChunk);
  return { chunkStartedAt, visemes, lastChunk };
}

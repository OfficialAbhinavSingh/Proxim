import { create } from "zustand";
import type { VisemeKeyframe, VisemeKey } from "../types";

export interface AvatarPlaybackState {
  /** performance.now() when current viseme timeline started */
  chunkStartedAt: number | null;
  visemes: VisemeKeyframe[];
}

interface AvatarStore extends AvatarPlaybackState {
  setVisemeTrack: (visemes: VisemeKeyframe[], chunkStartedAt: number) => void;
  clearVisemeTrack: () => void;
}

export const useAvatarStore = create<AvatarStore>((set) => ({
  chunkStartedAt: null,
  visemes: [],

  setVisemeTrack: (visemes, chunkStartedAt) => set({ visemes, chunkStartedAt }),
  clearVisemeTrack: () => set({ visemes: [], chunkStartedAt: null }),
}));

/** RPM / Oculus viseme morph target naming convention */
export function visemeToMorphName(v: VisemeKey): string {
  // Some avatars (including several open demo rigs) use the standard Oculus
  // single-letter vowel visemes: I/O/U instead of ih/oh/ou.
  const alias: Partial<Record<VisemeKey, string>> = {
    ih: "I",
    oh: "O",
    ou: "U",
  };
  return `viseme_${alias[v] ?? v}`;
}

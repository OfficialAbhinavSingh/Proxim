import { spawn } from "node:child_process";
import { writeFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { VisemeKeyframe, VisemeKey } from "../types/index.js";

/** Map Rhubarb mouth cue letters to Proxim 15-viseme set (approximate). */
const RHUBARB_TO_VISEME: Record<string, VisemeKey> = {
  A: "aa",
  B: "PP",
  C: "SS",
  D: "DD",
  E: "E",
  F: "FF",
  G: "sil",
  H: "TH",
  X: "sil",
};

interface RhubarbMouthCue {
  start: number;
  end: number;
  value: string;
}

interface RhubarbJson {
  mouthCues?: RhubarbMouthCue[];
}

export function mapRhubarbMouthCues(mouthCues: RhubarbMouthCue[]): VisemeKeyframe[] {
  const out: VisemeKeyframe[] = [];
  for (const cue of mouthCues) {
    const v = RHUBARB_TO_VISEME[cue.value] ?? ("sil" as VisemeKey);
    const weight = 0.85;
    out.push({ time: Math.max(0, cue.start), viseme: v, weight });
    out.push({ time: Math.max(0, cue.end), viseme: "sil", weight: 0.2 });
  }
  out.sort((a, b) => a.time - b.time);
  return out.length ? out : [{ time: 0, viseme: "sil", weight: 0 }];
}

// ---------------------------------------------------------------------------
// Phoneme-based fallback synthesizer (used when Rhubarb is not installed)
// Produces realistic mouth movement from text at ~11 phonemes/sec.
// ---------------------------------------------------------------------------

const PHONEME_MAP: Array<{ pattern: RegExp; viseme: VisemeKey; durationMs: number }> = [
  { pattern: /^(sh|ch)/i, viseme: "CH", durationMs: 100 },
  { pattern: /^(th)/i, viseme: "TH", durationMs: 95 },
  { pattern: /^(ph|ff|f|v)/i, viseme: "FF", durationMs: 85 },
  { pattern: /^(oo|ou|ow|oe|ue)/i, viseme: "ou", durationMs: 110 },
  { pattern: /^(oh|oa)/i, viseme: "oh", durationMs: 110 },
  { pattern: /^(ee|ea|ie|ei)/i, viseme: "E", durationMs: 100 },
  { pattern: /^(ih|in|im|it)/i, viseme: "ih", durationMs: 90 },
  { pattern: /^(aa|ar|ah|al)/i, viseme: "aa", durationMs: 110 },
  { pattern: /^[aeiou]/i, viseme: "aa", durationMs: 95 },
  { pattern: /^[pb]/i, viseme: "PP", durationMs: 70 },
  { pattern: /^[mn]/i, viseme: "nn", durationMs: 75 },
  { pattern: /^[dt]/i, viseme: "DD", durationMs: 70 },
  { pattern: /^[kg]/i, viseme: "kk", durationMs: 70 },
  { pattern: /^[szxc]/i, viseme: "SS", durationMs: 80 },
  { pattern: /^[rl]/i, viseme: "RR", durationMs: 80 },
  { pattern: /^[yw]/i, viseme: "ih", durationMs: 65 },
  { pattern: /^[hj]/i, viseme: "DD", durationMs: 65 },
  { pattern: /^\s+/, viseme: "sil", durationMs: 120 },
  { pattern: /^[^a-z]/i, viseme: "sil", durationMs: 60 },
];

/**
 * Generate realistic viseme keyframes from plain text.
 * Used as the fallback when Rhubarb is not available.
 */
export function synthesizeVisemesFromText(text: string): VisemeKeyframe[] {
  const frames: VisemeKeyframe[] = [];
  let cursorMs = 0;
  let remaining = text.trim();

  if (!remaining) return [{ time: 0, viseme: "sil", weight: 0 }];

  // Leading silence
  frames.push({ time: 0, viseme: "sil", weight: 0 });

  while (remaining.length > 0) {
    let matched = false;
    for (const { pattern, viseme, durationMs } of PHONEME_MAP) {
      const m = remaining.match(pattern);
      if (m) {
        const seg = m[0];
        const startSec = cursorMs / 1000;
        const endSec = (cursorMs + durationMs) / 1000;
        const weight = viseme === "sil" ? 0.1 : 0.75 + Math.random() * 0.15;
        frames.push({ time: startSec, viseme, weight });
        frames.push({ time: endSec, viseme: "sil", weight: 0.1 });
        cursorMs += durationMs;
        remaining = remaining.slice(seg.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      remaining = remaining.slice(1);
      cursorMs += 60;
    }
  }

  // Trailing silence
  frames.push({ time: cursorMs / 1000, viseme: "sil", weight: 0 });
  frames.sort((a, b) => a.time - b.time);
  return frames;
}

/**
 * Runs Rhubarb Lip Sync CLI on a WAV file and returns normalised viseme keyframes.
 *
 * @param rhubarbPath - Path to the rhubarb binary (or 'rhubarb' if on PATH).
 * @param wavBuffer   - WAV audio to analyse.
 * @param fallbackText - Plain text of the sentence; used by the phoneme synthesizer
 *                       when Rhubarb is unavailable so lips still move realistically.
 */
export async function generateVisemes(
  rhubarbPath: string | undefined,
  wavBuffer: Buffer,
  fallbackText?: string
): Promise<VisemeKeyframe[]> {
  const bin = rhubarbPath || "rhubarb";
  const id = randomUUID();
  const wavPath = join(tmpdir(), `proxim-${id}.wav`);
  const jsonPath = join(tmpdir(), `proxim-${id}.json`);
  await writeFile(wavPath, wavBuffer);

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(bin, ["-f", "json", "-o", jsonPath, wavPath], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      proc.stderr?.on("data", (d) => {
        stderr += String(d);
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Rhubarb exited ${code}: ${stderr}`));
      });
    });
    const raw = await readFile(jsonPath, "utf8");
    const parsed = JSON.parse(raw) as RhubarbJson;
    const cues = parsed.mouthCues ?? [];
    return mapRhubarbMouthCues(cues);
  } catch {
    // Rhubarb not available — use phoneme synthesizer for realistic lip movement
    if (fallbackText) {
      return synthesizeVisemesFromText(fallbackText);
    }
    return [
      { time: 0, viseme: "sil", weight: 0 },
      { time: 0.05, viseme: "aa", weight: 0.45 },
      { time: 0.15, viseme: "E", weight: 0.35 },
      { time: 0.25, viseme: "sil", weight: 0 },
    ];
  } finally {
    await unlink(wavPath).catch(() => {});
    await unlink(jsonPath).catch(() => {});
  }
}

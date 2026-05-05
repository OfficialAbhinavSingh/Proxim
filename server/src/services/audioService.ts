import { Buffer } from "node:buffer";

/** Wrap raw PCM s16le mono in a WAV container for browser decode. */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/** ~120ms of silence as WAV for graceful fallback when TTS fails. */
export function minimalSilenceWav(): Buffer {
  return makeSilenceWavForDuration(0.12);
}

/**
 * Generate a WAV buffer of pure silence with the given duration.
 * Used so the lip-sync viseme track stays alive for the full spoken duration
 * even when TTS audio is unavailable (silence fallback path).
 */
export function makeSilenceWavForDuration(durationSec: number): Buffer {
  const sampleRate = 22050;
  const n = Math.max(1, Math.floor(sampleRate * Math.max(0.12, durationSec)));
  const pcm = Buffer.alloc(n * 2); // zero = silence
  return pcmToWav(pcm, sampleRate, 1);
}

export function bufferToBase64(buf: Buffer): string {
  return buf.toString("base64");
}

/**
 * Parse the duration (in seconds) of a PCM WAV file from its header.
 * Returns null if the buffer is too short or not a valid WAV.
 */
export function parseWavDurationSec(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  const riff = buf.toString("ascii", 0, 4);
  const wave = buf.toString("ascii", 8, 12);
  if (riff !== "RIFF" || wave !== "WAVE") return null;
  try {
    const sampleRate = buf.readUInt32LE(24);
    const channels = buf.readUInt16LE(22);
    const bitsPerSample = buf.readUInt16LE(34);
    const dataSize = buf.readUInt32LE(40);
    const bytesPerSample = bitsPerSample / 8;
    if (!sampleRate || !channels || !bytesPerSample) return null;
    const durationSec = dataSize / (sampleRate * channels * bytesPerSample);
    return Number.isFinite(durationSec) && durationSec > 0 ? durationSec : null;
  } catch {
    return null;
  }
}

/**
 * Scale text-derived viseme timestamps to match actual audio duration.
 * When Groq TTS produces a WAV with a known duration, this aligns the
 * mouth animation to the real speech rate instead of a fixed 11 phonemes/sec estimate.
 */
export function scaleVisemesToDuration(
  visemes: import("../types/index.js").VisemeKeyframe[],
  targetDurationSec: number
): import("../types/index.js").VisemeKeyframe[] {
  if (!visemes.length || targetDurationSec <= 0) return visemes;
  const lastTime = visemes[visemes.length - 1]?.time ?? 0;
  if (lastTime <= 0) return visemes;
  const scale = targetDurationSec / lastTime;
  if (Math.abs(scale - 1) < 0.05) return visemes; // within 5% — no adjustment needed
  return visemes.map((f) => ({ ...f, time: f.time * scale }));
}

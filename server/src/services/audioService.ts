import { Buffer } from "node:buffer";

/** Wrap raw PCM s16le mono in a WAV container for Rhubarb and browser decode. */
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

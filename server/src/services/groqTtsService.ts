import Groq from "groq-sdk";
import { Buffer } from "node:buffer";

/**
 * Fallback TTS using Groq Audio Speech API.
 * Returns a WAV buffer that the browser can decode directly.
 *
 * Note: Persona `voiceId` values in this project are ElevenLabs voice IDs.
 * Groq uses its own voice names, so this function takes a `voice` string.
 */
export async function synthesizeSentenceToWavWithGroq(
  apiKey: string | undefined,
  voice: string,
  text: string
): Promise<Buffer> {
  if (!apiKey) return Buffer.alloc(0);
  if (!text.trim()) return Buffer.alloc(0);

  const client = new Groq({ apiKey });
  const res = await client.audio.speech.create({
    model: "canopylabs/orpheus-v1-english",
    // Orpheus voice IDs are different from PlayAI. Use a sensible default.
    voice: voice || "austin",
    input: text,
    response_format: "wav",
  } as Parameters<typeof client.audio.speech.create>[0]);

  // groq-sdk returns a fetch Response when __binaryResponse is set.
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}


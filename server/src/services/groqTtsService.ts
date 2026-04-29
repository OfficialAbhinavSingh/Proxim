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
    model: "canopylabs/orpheus-3b-0.1-ft",
    voice: voice || "tara",   // Orpheus voices: tara, leo, leah, dan, mia, zac, jess
    input: text,
    response_format: "wav",
  } as Parameters<typeof client.audio.speech.create>[0]);

  // groq-sdk returns a fetch Response when __binaryResponse is set.
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}


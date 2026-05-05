import Groq from "groq-sdk";
import { Buffer } from "node:buffer";

/**
 * Valid Orpheus v1 English voices from Canopy Labs on Groq.
 * IMPORTANT: The org admin must accept terms at:
 *   https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english
 */
function resolveOrpheusVoice(voice: string): string {
  const VALID = new Set(["tara", "leah", "leo", "dan", "mia", "zac", "jess", "austin"]);
  const v = (voice || "tara").toLowerCase();
  return VALID.has(v) ? v : "tara";
}

/**
 * Map an Orpheus voice name to the closest PlayAI voice.
 * playai-tts does NOT require terms acceptance.
 */
function resolvePlayAIVoice(orpheusVoice: string): string {
  const MAP: Record<string, string> = {
    tara: "Arista-PlayAI",   // warm female
    leah: "Nia-PlayAI",      // professional female
    mia: "Celeste-PlayAI",   // calm female
    jess: "Ruby-PlayAI",     // expressive female
    leo: "Angelo-PlayAI",    // assertive male
    dan: "Mason-PlayAI",     // measured male
    zac: "Chase-PlayAI",     // confident male
    austin: "Cillian-PlayAI",// neutral male
  };
  return MAP[orpheusVoice.toLowerCase()] ?? "Arista-PlayAI";
}

function isTermsError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("model_terms_required") || msg.includes("terms");
}

async function tryOrpheusTts(
  client: Groq,
  voice: string,
  text: string
): Promise<Buffer> {
  const res = await client.audio.speech.create({
    model: "canopylabs/orpheus-v1-english",
    voice: resolveOrpheusVoice(voice),
    input: text,
    response_format: "wav",
  } as Parameters<typeof client.audio.speech.create>[0]);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function tryPlayAITts(
  client: Groq,
  voice: string,
  text: string
): Promise<Buffer> {
  const playAIVoice = resolvePlayAIVoice(resolveOrpheusVoice(voice));
  const res = await client.audio.speech.create({
    model: "playai-tts",
    voice: playAIVoice,
    input: text,
    response_format: "wav",
  } as Parameters<typeof client.audio.speech.create>[0]);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Synthesise speech using Groq TTS.
 *
 * Priority:
 *   1. Orpheus v1 English (best voice quality, requires terms acceptance)
 *   2. PlayAI TTS        (no terms required, nearly as good)
 *
 * Returns a WAV buffer the browser can decode directly.
 */
export async function synthesizeSentenceToWavWithGroq(
  apiKey: string | undefined,
  voice: string,
  text: string
): Promise<Buffer> {
  if (!apiKey) return Buffer.alloc(0);
  if (!text.trim()) return Buffer.alloc(0);

  const client = new Groq({ apiKey });

  // Try Orpheus first.
  try {
    const buf = await tryOrpheusTts(client, voice, text);
    if (buf.length > 0) {
      console.log(`[TTS] Groq Orpheus (voice=${resolveOrpheusVoice(voice)}): ${buf.length}B WAV`);
      return buf;
    }
  } catch (err) {
    if (isTermsError(err)) {
      console.warn(
        "[TTS] Orpheus terms not accepted — falling back to PlayAI TTS.\n" +
        "      Accept Orpheus at: https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english"
      );
    } else {
      console.warn("[TTS] Orpheus failed:", err instanceof Error ? err.message : err);
    }
  }

  // Fallback: PlayAI TTS (no terms needed).
  try {
    const playAIVoice = resolvePlayAIVoice(resolveOrpheusVoice(voice));
    const buf = await tryPlayAITts(client, voice, text);
    if (buf.length > 0) {
      console.log(`[TTS] Groq PlayAI (voice=${playAIVoice}): ${buf.length}B WAV`);
      return buf;
    }
  } catch (err2) {
    console.warn("[TTS] PlayAI TTS failed:", err2 instanceof Error ? err2.message : err2);
  }

  return Buffer.alloc(0);
}

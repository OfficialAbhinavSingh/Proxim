import { Buffer } from "node:buffer";

/**
 * Streams ElevenLabs TTS into a single buffer (per sentence) using fetch ReadableStream.
 * Uses PCM 22050 mono for predictable WAV assembly + Rhubarb compatibility.
 */
export async function synthesizeSentenceToPcm(
  apiKey: string | undefined,
  voiceId: string,
  text: string
): Promise<{ pcm: Buffer; sampleRate: number }> {
  const defaultVoice = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  const vid =
    voiceId && !voiceId.includes("ELEVENLABS_VOICE_ID_HERE") ? voiceId : defaultVoice;
  if (!apiKey || !vid) {
    return { pcm: Buffer.alloc(0), sampleRate: 22050 };
  }

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}/stream?output_format=pcm_22050`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: "audio/pcm",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.45, similarity_boost: 0.75 },
    }),
  });

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed: ${res.status} ${err}`);
  }

  const chunks: Buffer[] = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) chunks.push(Buffer.from(value));
  }
  return { pcm: Buffer.concat(chunks), sampleRate: 22050 };
}

import type { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Emotion, Message, Persona, WsClientMessage, WsServerMessage } from "../types/index.js";
import { streamClaudeResponse, stripEmotionTag, generateScoreCard } from "../services/claudeService.js";
import { synthesizeSentenceWithTimestamps } from "../services/elevenLabsService.js";
import { synthesizeSentenceToWavWithGroq } from "../services/groqTtsService.js";
import { bufferToBase64, makeSilenceWavForDuration, minimalSilenceWav } from "../services/audioService.js";
import { synthesizeVisemesFromText } from "../services/visemeFallbackService.js";
import { streamMuseTalkFrames } from "../services/museTalkService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadPersonas(): Persona[] {
  const envPath = process.env.PERSONAS_PATH;
  const path = envPath ?? join(__dirname, "../config/personas.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as Persona[];
}

interface SessionCtx {
  personaId: string;
  messages: Message[];
}

function safeSend(ws: WebSocket, msg: WsServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function splitLeadingSentence(buffer: string): { sentence: string | null; rest: string } {
  const trimmed = buffer.trimStart();
  const punct = /([.!?])(\s|$)/;
  const m = punct.exec(trimmed);
  if (m && m.index !== undefined) {
    const end = m.index + 1;
    const sentence = trimmed.slice(0, end).trim();
    const rest = trimmed.slice(end).trimStart();
    if (sentence.length >= 2) return { sentence, rest };
  }
  // Lower threshold to reduce perceived latency: emit shorter TTS chunks sooner.
  if (trimmed.length >= 120) {
    const slice = trimmed.slice(0, 120);
    const li = slice.lastIndexOf(" ");
    if (li > 40) {
      const sentence = trimmed.slice(0, li).trim();
      const rest = trimmed.slice(li).trimStart();
      return { sentence, rest };
    }
  }
  return { sentence: null, rest: buffer };
}

export function createWsHandler() {
  const personas = loadPersonas();
  const sessions = new Map<string, SessionCtx>();

  const getPersona = (id: string): Persona | undefined => personas.find((p) => p.id === id);

  async function processSentencePipeline(
    ws: WebSocket,
    persona: Persona,
    sentence: string,
    sentenceIndex: number,
    isLast: boolean
  ) {
    const elevenKey = process.env.ELEVENLABS_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const groqVoice = process.env.GROQ_TTS_VOICE || "austin";
    let wav: Buffer | null = null; // WAV fallback path (Groq/silence)
    let audioBase64: string | null = null; // ElevenLabs path (mp3 base64)
    let audioMimeType: string = "audio/wav";
    let isSilence = false;
    let visemes = synthesizeVisemesFromText(sentence);
    let visemeSource: "elevenlabs_alignment" | "fallback_text" | "fallback_static" = "fallback_text";

    // ── TTS priority: ElevenLabs (audio-aligned visemes) → Groq (fallback) ──
    //
    // ElevenLabs with-timestamps returns character-level timing anchored to
    // the actual audio. This gives accurate, audio-driven lip sync.
    // Groq is fast and free but only text-based visemes (no timing data).
    //
    // If ELEVENLABS_API_KEY is set, always prefer it for lip-sync quality.
    if (elevenKey) {
      try {
        const res = await synthesizeSentenceWithTimestamps(elevenKey, persona.voiceId, sentence);
        if (res.audioBase64) {
          audioBase64 = res.audioBase64;
          audioMimeType = res.audioMimeType;
          visemes = res.visemes;
          visemeSource = res.source;
          console.log(`[TTS] ElevenLabs alignment: ${visemes.length} viseme frames`);
        }
      } catch (err) {
        console.warn("[TTS] ElevenLabs failed, trying Groq:", err instanceof Error ? err.message : err);
      }
    }

    // Groq fallback: fast WAV + text-derived visemes
    if (!audioBase64 && groqKey) {
      try {
        const groqWav = await synthesizeSentenceToWavWithGroq(groqKey, groqVoice, sentence);
        if (groqWav.length > 0) {
          wav = groqWav;
          visemes = synthesizeVisemesFromText(sentence);
          visemeSource = "fallback_text";
          console.log("[TTS] Groq fallback TTS used");
        }
      } catch (err2) {
        console.warn("[TTS] Groq TTS failed:", err2 instanceof Error ? err2.message : err2);
      }
    }

    if (!audioBase64 && !wav) {
      // Both TTS providers failed — send silence whose duration matches the viseme
      // track so the avatar has time to animate its mouth before the chunk ends.
      isSilence = true;
      const lastFrame = visemes.reduce((max, f) => Math.max(max, f.time), 0);
      const durationSec = Math.max(0.5, lastFrame + 0.25);
      wav = makeSilenceWavForDuration(durationSec);
      console.warn(`[TTS] Both providers unavailable — sending ${durationSec.toFixed(2)}s silence for lip-sync.`);
    }

    // ── Stream video frames from MuseTalk (parallel, non-blocking) ──────────
    // Only fires if MUSETALK_URL is set and we have a WAV buffer.
    // Falls back silently to 3D GLB avatar if MuseTalk is unavailable.
    if (wav && process.env.MUSETALK_URL) {
      const wavSnapshot = Buffer.from(wav); // copy before async use
      void (async () => {
        let frameIndex = 0;
        try {
          for await (const frameBase64 of streamMuseTalkFrames(wavSnapshot, persona.id)) {
            safeSend(ws, {
              type: "video_frame",
              frameBase64,
              sentenceIndex,
              frameIndex,
            });
            frameIndex++;
          }
        } catch (err) {
          console.warn("[MuseTalk] Frame stream error:", err instanceof Error ? err.message : err);
        }
      })();
    }

    safeSend(ws, {
      type: "audio_chunk",
      audioBase64: audioBase64 ?? bufferToBase64(wav ?? minimalSilenceWav()),
      audioMimeType: audioBase64 ? audioMimeType : "audio/wav",
      visemes,
      visemeSource,
      isLast,
      sentenceIndex,
      text: sentence,
      isSilence,
    });
  }

  /** Emit complete sentences from buffer; never marks isLast (mid-turn). */
  async function emitCompleteSentences(
    ws: WebSocket,
    persona: Persona,
    buffer: { value: string },
    sentenceCounter: { value: number }
  ) {
    for (;;) {
      const { sentence, rest } = splitLeadingSentence(buffer.value);
      if (!sentence) break;
      buffer.value = rest;
      await processSentencePipeline(ws, persona, sentence, sentenceCounter.value, false);
      sentenceCounter.value += 1;
    }
  }

  /** Finalize remaining buffer; exactly one emitted chunk will have isLast=true. */
  async function emitFinalTail(
    ws: WebSocket,
    persona: Persona,
    buffer: { value: string },
    sentenceCounter: { value: number }
  ) {
    await emitCompleteSentences(ws, persona, buffer, sentenceCounter);
    const tail = buffer.value.trim();
    if (tail.length) {
      await processSentencePipeline(ws, persona, tail, sentenceCounter.value, true);
      sentenceCounter.value += 1;
      buffer.value = "";
      return;
    }
    if (sentenceCounter.value === 0) {
      await processSentencePipeline(ws, persona, "Thanks for your time.", 0, true);
    } else {
      safeSend(ws, {
        type: "audio_chunk",
        audioBase64: bufferToBase64(minimalSilenceWav()),
        audioMimeType: "audio/wav",
        visemes: [{ time: 0, viseme: "sil", weight: 0 }],
        isLast: true,
        sentenceIndex: sentenceCounter.value,
      });
    }
  }

  async function streamAssistantTurn(
    ws: WebSocket,
    persona: Persona,
    history: Message[]
  ): Promise<{ displayText: string; emotion: Emotion } | null> {
    let raw = "";
    let lastDisplayLen = 0;
    let lastEmit = 0;
    const ttsBuf = { value: "" };
    const sentenceCounter = { value: 0 };

    try {
      for await (const { textDelta } of streamClaudeResponse(
        process.env.ANTHROPIC_API_KEY,
        persona,
        history
      )) {
        raw += textDelta;
        const { emotion, displayText } = stripEmotionTag(raw);
        const chunk = displayText.slice(lastDisplayLen);
        lastDisplayLen = displayText.length;
        ttsBuf.value += chunk;

        const now = Date.now();
        if (now - lastEmit > 85) {
          lastEmit = now;
          safeSend(ws, {
            type: "transcript_update",
            role: "assistant",
            text: displayText,
            emotion,
          });
        }

        await emitCompleteSentences(ws, persona, ttsBuf, sentenceCounter);
      }

      const { emotion, displayText } = stripEmotionTag(raw);
      safeSend(ws, {
        type: "transcript_update",
        role: "assistant",
        text: displayText,
        emotion,
      });

      await emitFinalTail(ws, persona, ttsBuf, sentenceCounter);
      return { displayText, emotion };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[streamAssistantTurn] error:", msg);
      // Surface a clear error to the client
      let clientMsg = "An error occurred while generating the response.";
      if (msg.includes("credit balance is too low") || msg.includes("billing")) {
        clientMsg = "Anthropic API: insufficient credits. Please top up at console.anthropic.com/settings/billing";
      } else if (msg.includes("401") || msg.includes("authentication")) {
        clientMsg = "Anthropic API: invalid API key. Check ANTHROPIC_API_KEY in server/.env";
      } else if (msg.includes("rate")) {
        clientMsg = "Anthropic API: rate limited. Please wait a moment and try again.";
      }
      safeSend(ws, { type: "error", message: clientMsg });
      return null;
    }
  }

  async function sendIntro(ws: WebSocket, persona: Persona) {
    const greeting = `[ENGAGED]\nHello — I'm ${persona.name}. I only have a few minutes, but I'm listening. What should we focus on today?`;
    const { emotion, displayText } = stripEmotionTag(greeting);
    safeSend(ws, {
      type: "transcript_update",
      role: "assistant",
      text: displayText,
      emotion,
    });
    const ttsBuf = { value: displayText };
    const sentenceCounter = { value: 0 };
    await emitFinalTail(ws, persona, ttsBuf, sentenceCounter);
  }

  return async function handleMessage(ws: WebSocket, raw: string) {
    let msg: WsClientMessage;
    try {
      msg = JSON.parse(raw) as WsClientMessage;
    } catch {
      safeSend(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    if (msg.type === "session_start") {
      const persona = getPersona(msg.personaId);
      if (!persona) {
        safeSend(ws, { type: "error", message: "Unknown persona" });
        return;
      }
      const existing = sessions.get(msg.sessionId);
      const cap = {
        type: "capabilities" as const,
        sessionId: msg.sessionId,
        alignment: { available: !!process.env.ELEVENLABS_API_KEY },
        tts: {
          elevenLabsConfigured: !!process.env.ELEVENLABS_API_KEY,
          groqConfigured: !!process.env.GROQ_API_KEY,
        },
        musetalk: { available: !!process.env.MUSETALK_URL },
      };
      if (existing?.messages.some((m) => m.role === "user")) {
        safeSend(ws, {
          type: "session_start",
          sessionId: msg.sessionId,
          personaId: msg.personaId,
        });
        safeSend(ws, cap);
        return;
      }
      if (existing && !existing.messages.some((m) => m.role === "user")) {
        safeSend(ws, {
          type: "session_start",
          sessionId: msg.sessionId,
          personaId: msg.personaId,
        });
        safeSend(ws, cap);
        return;
      }

      sessions.set(msg.sessionId, { personaId: persona.id, messages: [] });
      safeSend(ws, {
        type: "session_start",
        sessionId: msg.sessionId,
        personaId: msg.personaId,
      });
      safeSend(ws, cap);
      await sendIntro(ws, persona);
      const intro = stripEmotionTag(
        `[ENGAGED]\nHello — I'm ${persona.name}. I only have a few minutes, but I'm listening. What should we focus on today?`
      );
      const ctx0 = sessions.get(msg.sessionId);
      if (ctx0) {
        ctx0.messages.push({
          role: "assistant",
          content: intro.displayText,
          emotion: intro.emotion,
          timestamp: Date.now(),
        });
      }
      return;
    }

    if (msg.type === "session_end") {
      const ctx = sessions.get(msg.sessionId);
      const history = ctx ? [...ctx.messages] : [];
      sessions.delete(msg.sessionId);
      safeSend(ws, { type: "session_end", sessionId: msg.sessionId });

      // Generate scorecard asynchronously — never blocks session cleanup.
      // Fires even if no API key is set; generateScoreCard returns null gracefully.
      if (history.length > 0) {
        generateScoreCard(history)
          .then((scoreCard) => {
            if (scoreCard) {
              safeSend(ws, { type: "session_scorecard", sessionId: msg.sessionId, scoreCard });
            }
          })
          .catch((err) => {
            console.warn("[ScoreCard] Async error (non-fatal):", err instanceof Error ? err.message : err);
          });
      }

      return;
    }

    if (msg.type === "user_input") {
      const ctx = sessions.get(msg.sessionId);
      const persona = getPersona(msg.personaId);
      if (!ctx || !persona) {
        safeSend(ws, { type: "error", message: "Unknown session or persona" });
        return;
      }
      ctx.messages.push({ role: "user", content: msg.text, timestamp: Date.now() });
      const history = [...ctx.messages];
      const result = await streamAssistantTurn(ws, persona, history);
      if (result) {
        ctx.messages.push({
          role: "assistant",
          content: result.displayText,
          emotion: result.emotion,
          timestamp: Date.now(),
        });
      } else {
        // Remove the user message so history stays consistent after a failed turn
        ctx.messages.pop();
      }
    }
  };
}

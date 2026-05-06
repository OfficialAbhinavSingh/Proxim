import type { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Emotion, Message, Persona, WsClientMessage, WsServerMessage } from "../types/index.js";
import { streamClaudeResponse, stripEmotionTag, generateScoreCard } from "../services/claudeService.js";
import { synthesizeSentenceWithTimestamps } from "../services/elevenLabsService.js";
import { synthesizeSentenceToWavWithGroq } from "../services/groqTtsService.js";
import { alignVisemesToWavEnergy, bufferToBase64, makeSilenceWavForDuration, minimalSilenceWav, parseWavDurationSec, scaleVisemesToDuration } from "../services/audioService.js";
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

/** Per-turn latency tracking. */
interface LatencyCtx {
  t0: number;
  llmFirstTokenMs: number | null;
  ttsStartMs: number | null;
}

function safeSend(ws: WebSocket, msg: WsServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * Split the leading complete sentence from the buffer.
 * Fires on: `.!?` (sentence end) or `,` after ≥6 words (clause boundary).
 * Keeps latency low by not waiting for the full paragraph.
 */
function splitLeadingSentence(buffer: string): { sentence: string | null; rest: string } {
  const trimmed = buffer.trimStart();

  // Hard sentence boundary: . ! ?
  const sentencePunct = /([.!?])(\s|$)/;
  const sm = sentencePunct.exec(trimmed);
  if (sm && sm.index !== undefined) {
    const end = sm.index + 1;
    const sentence = trimmed.slice(0, end).trim();
    const rest = trimmed.slice(end).trimStart();
    if (sentence.length >= 4) return { sentence, rest };
  }

  // Clause boundary: comma after ≥6 words — fire TTS while LLM continues.
  const commaIdx = trimmed.indexOf(",");
  if (commaIdx > 0) {
    const before = trimmed.slice(0, commaIdx).trim();
    const wordCount = before.split(/\s+/).filter(Boolean).length;
    if (wordCount >= 6) {
      const sentence = before + ",";
      const rest = trimmed.slice(commaIdx + 1).trimStart();
      return { sentence, rest };
    }
  }

  // Absolute length cap: avoid waiting forever when LLM omits punctuation.
  if (trimmed.length >= 100) {
    const slice = trimmed.slice(0, 100);
    const li = slice.lastIndexOf(" ");
    if (li > 30) {
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
    isLast: boolean,
    latency: LatencyCtx
  ) {
    const elevenKey = process.env.ELEVENLABS_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    // Use per-persona Groq voice, falling back to env var or "tara".
    const groqVoice = persona.groqVoice ?? process.env.GROQ_TTS_VOICE ?? "tara";

    let wav: Buffer | null = null;
    let audioBase64: string | null = null;
    let audioMimeType: string = "audio/wav";
    let isSilence = false;
    let visemes = synthesizeVisemesFromText(sentence);
    let visemeSource: "elevenlabs_alignment" | "fallback_audio" | "fallback_text" | "fallback_static" = "fallback_text";

    // Record tts_start on first sentence synthesis.
    if (latency.ttsStartMs === null) {
      latency.ttsStartMs = Date.now() - latency.t0;
      console.log(`[Latency] TTS start: ${latency.ttsStartMs}ms`);
    }

    // ── TTS priority: ElevenLabs (audio-aligned visemes) → Groq Orpheus (fallback) ──
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

    // Groq Orpheus fallback — per-persona voice assignment.
    if (!audioBase64 && groqKey) {
      try {
        const groqWav = await synthesizeSentenceToWavWithGroq(groqKey, groqVoice, sentence);
        if (groqWav.length > 0) {
          wav = groqWav;
          const rawVisemes = synthesizeVisemesFromText(sentence);
          // Retime to the real WAV duration first, then use the WAV energy envelope
          // so mouth movement follows actual speech rhythm instead of text only.
          const audioDurationSec = parseWavDurationSec(groqWav);
          const durationScaled = audioDurationSec
            ? scaleVisemesToDuration(rawVisemes, audioDurationSec)
            : rawVisemes;
          visemes = alignVisemesToWavEnergy(groqWav, durationScaled);
          visemeSource = "fallback_audio";
          console.log(
            `[TTS] Groq audio-synced visemes (voice=${groqVoice}): ${groqWav.length}B WAV, duration=${audioDurationSec?.toFixed(2) ?? "?"}s, visemes=${visemes.length}`
          );
        }
      } catch (err2) {
        console.warn("[TTS] Groq TTS failed:", err2 instanceof Error ? err2.message : String(err2));
      }
    }

    // Hard fallback: timed silence so avatar can animate its mouth.
    if (!audioBase64 && !wav) {
      isSilence = true;
      const lastFrame = visemes.reduce((max, f) => Math.max(max, f.time), 0);
      const durationSec = Math.max(0.5, lastFrame + 0.25);
      wav = makeSilenceWavForDuration(durationSec);
      console.warn(`[TTS] Both providers unavailable — sending ${durationSec.toFixed(2)}s silence for lip-sync.`);
    }

    // Optional MuseTalk video frames (non-blocking, fires if MUSETALK_URL is set).
    if (wav && process.env.MUSETALK_URL) {
      const wavSnapshot = Buffer.from(wav);
      void (async () => {
        let frameIndex = 0;
        try {
          for await (const frameBase64 of streamMuseTalkFrames(wavSnapshot, persona.id)) {
            safeSend(ws, { type: "video_frame", frameBase64, sentenceIndex, frameIndex });
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
    sentenceCounter: { value: number },
    latency: LatencyCtx
  ) {
    for (;;) {
      const { sentence, rest } = splitLeadingSentence(buffer.value);
      if (!sentence) break;
      buffer.value = rest;
      await processSentencePipeline(ws, persona, sentence, sentenceCounter.value, false, latency);
      sentenceCounter.value += 1;
    }
  }

  /** Finalize remaining buffer; exactly one emitted chunk will have isLast=true. */
  async function emitFinalTail(
    ws: WebSocket,
    persona: Persona,
    buffer: { value: string },
    sentenceCounter: { value: number },
    latency: LatencyCtx
  ) {
    await emitCompleteSentences(ws, persona, buffer, sentenceCounter, latency);
    const tail = buffer.value.trim();
    if (tail.length) {
      await processSentencePipeline(ws, persona, tail, sentenceCounter.value, true, latency);
      sentenceCounter.value += 1;
      buffer.value = "";
      return;
    }
    if (sentenceCounter.value === 0) {
      await processSentencePipeline(ws, persona, "Thanks for your time.", 0, true, latency);
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
    history: Message[],
    latency: LatencyCtx
  ): Promise<{ displayText: string; emotion: Emotion } | null> {
    let raw = "";
    let lastDisplayLen = 0;
    let lastEmit = 0;
    const ttsBuf = { value: "" };
    const sentenceCounter = { value: 0 };
    let emotionEmitted = false;

    try {
      for await (const { textDelta } of streamClaudeResponse(
        process.env.ANTHROPIC_API_KEY,
        persona,
        history
      )) {
        raw += textDelta;
        const { emotion, displayText } = stripEmotionTag(raw);

        // Record LLM first token when we have actual display text.
        if (latency.llmFirstTokenMs === null && displayText.trim().length > 0) {
          latency.llmFirstTokenMs = Date.now() - latency.t0;
          console.log(`[Latency] LLM first token: ${latency.llmFirstTokenMs}ms`);
        }

        // Emit dedicated emotion event BEFORE the first TTS audio chunk.
        // This lets the client pre-load the blendshape 200ms before audio starts.
        if (!emotionEmitted && displayText.trim().length > 0) {
          safeSend(ws, { type: "emotion", tag: emotion });
          emotionEmitted = true;
          console.log(`[Emotion] Emitted early: ${emotion}`);
        }

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

        await emitCompleteSentences(ws, persona, ttsBuf, sentenceCounter, latency);
      }

      const { emotion, displayText } = stripEmotionTag(raw);

      // Ensure emotion is emitted even if response was very short.
      if (!emotionEmitted) {
        safeSend(ws, { type: "emotion", tag: emotion });
      }

      safeSend(ws, {
        type: "transcript_update",
        role: "assistant",
        text: displayText,
        emotion,
      });

      await emitFinalTail(ws, persona, ttsBuf, sentenceCounter, latency);

      // Emit server-side latency telemetry for this turn.
      const totalMs = Date.now() - latency.t0;
      safeSend(ws, {
        type: "latency",
        stt_ms: 0,
        llm_first_token_ms: latency.llmFirstTokenMs ?? 0,
        tts_start_ms: latency.ttsStartMs ?? 0,
        total_ms: totalMs,
      });
      console.log(
        `[Latency] Turn complete — LLM: ${latency.llmFirstTokenMs ?? "?"}ms, TTS start: ${latency.ttsStartMs ?? "?"}ms, Total: ${totalMs}ms`
      );

      return { displayText, emotion };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[streamAssistantTurn] error:", msg);
      let clientMsg = "An error occurred while generating the response.";
      if (msg.includes("credit balance is too low") || msg.includes("billing")) {
        clientMsg = "API: insufficient credits. Please check your API keys and billing.";
      } else if (msg.includes("401") || msg.includes("authentication")) {
        clientMsg = "API: invalid API key. Check GROQ_API_KEY / ANTHROPIC_API_KEY in server/.env";
      } else if (msg.includes("rate")) {
        clientMsg = "API: rate limited. Please wait a moment and try again.";
      }
      safeSend(ws, { type: "error", message: clientMsg });
      return null;
    }
  }

  async function sendIntro(ws: WebSocket, persona: Persona, latency: LatencyCtx) {
    const greeting = `[ENGAGED]\nHello — I'm ${persona.name}. I only have a few minutes, but I'm listening. What should we focus on today?`;
    const { emotion, displayText } = stripEmotionTag(greeting);
    safeSend(ws, { type: "emotion", tag: emotion });
    safeSend(ws, {
      type: "transcript_update",
      role: "assistant",
      text: displayText,
      emotion,
    });
    const ttsBuf = { value: displayText };
    const sentenceCounter = { value: 0 };
    await emitFinalTail(ws, persona, ttsBuf, sentenceCounter, latency);
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
        alignment: { available: !!process.env.ELEVENLABS_API_KEY || !!process.env.GROQ_API_KEY },
        tts: {
          elevenLabsConfigured: !!process.env.ELEVENLABS_API_KEY,
          groqConfigured: !!process.env.GROQ_API_KEY,
        },
        musetalk: { available: !!process.env.MUSETALK_URL },
      };

      if (existing?.messages.some((m) => m.role === "user")) {
        safeSend(ws, { type: "session_start", sessionId: msg.sessionId, personaId: msg.personaId });
        safeSend(ws, cap);
        return;
      }
      if (existing && !existing.messages.some((m) => m.role === "user")) {
        safeSend(ws, { type: "session_start", sessionId: msg.sessionId, personaId: msg.personaId });
        safeSend(ws, cap);
        return;
      }

      sessions.set(msg.sessionId, { personaId: persona.id, messages: [] });
      safeSend(ws, { type: "session_start", sessionId: msg.sessionId, personaId: msg.personaId });
      safeSend(ws, cap);

      const introLatency: LatencyCtx = { t0: Date.now(), llmFirstTokenMs: null, ttsStartMs: null };
      await sendIntro(ws, persona, introLatency);

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

      const latency: LatencyCtx = { t0: Date.now(), llmFirstTokenMs: null, ttsStartMs: null };
      console.log(`[Latency] Turn started for session ${msg.sessionId.slice(0, 8)}`);

      ctx.messages.push({ role: "user", content: msg.text, timestamp: Date.now() });
      const history = [...ctx.messages];
      const result = await streamAssistantTurn(ws, persona, history, latency);
      if (result) {
        ctx.messages.push({
          role: "assistant",
          content: result.displayText,
          emotion: result.emotion,
          timestamp: Date.now(),
        });
      } else {
        ctx.messages.pop();
      }
    }
  };
}

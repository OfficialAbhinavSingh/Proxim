import type { WebSocket } from "ws";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Emotion, Message, Persona, WsClientMessage, WsServerMessage } from "../types/index.js";
import { streamClaudeResponse, stripEmotionTag } from "../services/claudeService.js";
import { synthesizeSentenceToPcm } from "../services/elevenLabsService.js";
import { synthesizeSentenceToWavWithGroq } from "../services/groqTtsService.js";
import { generateVisemes, synthesizeVisemesFromText } from "../services/rhubarbService.js";
import { bufferToBase64, makeSilenceWavForDuration, minimalSilenceWav, pcmToWav } from "../services/audioService.js";

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
  if (trimmed.length >= 220) {
    const slice = trimmed.slice(0, 220);
    const li = slice.lastIndexOf(" ");
    if (li > 80) {
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
    const rhubarbPath = process.env.RHUBARB_PATH;
    const groqKey = process.env.GROQ_API_KEY;
    const groqVoice = process.env.GROQ_TTS_VOICE || "Fritz-PlayAI";
    let wav: Buffer | null = null;         // null = no real audio yet
    let isSilence = false;
    // Default to text-based visemes so lips always move even if audio is silent.
    // If we later obtain real speech audio, we replace this with Rhubarb-derived visemes.
    let visemes = synthesizeVisemesFromText(sentence);

    try {
      const { pcm, sampleRate } = await synthesizeSentenceToPcm(elevenKey, persona.voiceId, sentence);
      if (pcm.length > 0) {
        wav = pcmToWav(pcm, sampleRate, 1);
        // Pass sentence text so phoneme synthesizer can be used if Rhubarb fails.
        visemes = await generateVisemes(rhubarbPath, wav, sentence);
      }
      // If pcm is empty, ElevenLabs not configured — fall through to Groq below.
    } catch (err) {
      console.warn("[TTS] ElevenLabs failed, trying Groq:", err instanceof Error ? err.message : err);
    }

    if (!wav) {
      // Try Groq TTS fallback.
      try {
        const groqWav = await synthesizeSentenceToWavWithGroq(groqKey, groqVoice, sentence);
        if (groqWav.length > 0) {
          wav = groqWav;
          visemes = await generateVisemes(rhubarbPath, wav, sentence);
        }
      } catch (err2) {
        console.warn("[TTS] Groq TTS failed:", err2 instanceof Error ? err2.message : err2);
      }
    }

    if (!wav) {
      // Both TTS providers failed — send silence whose duration matches the viseme
      // track so the avatar has time to animate its mouth before the chunk ends.
      isSilence = true;
      const lastFrame = visemes.reduce((max, f) => Math.max(max, f.time), 0);
      const durationSec = Math.max(0.5, lastFrame + 0.25);
      wav = makeSilenceWavForDuration(durationSec);
      console.warn(`[TTS] Both providers unavailable — sending ${durationSec.toFixed(2)}s silence for lip-sync.`);
    }

    safeSend(ws, {
      type: "audio_chunk",
      audioBase64: bufferToBase64(wav),
      audioMimeType: "audio/wav",
      visemes,
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
    const greeting = `[EMOTION:engaged]\nHello — I'm ${persona.name}. I only have a few minutes, but I'm listening. What should we focus on today?`;
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
      sessions.set(msg.sessionId, { personaId: persona.id, messages: [] });
      safeSend(ws, {
        type: "session_start",
        sessionId: msg.sessionId,
        personaId: msg.personaId,
      });
      await sendIntro(ws, persona);
      const intro = stripEmotionTag(
        `[EMOTION:engaged]\nHello — I'm ${persona.name}. I only have a few minutes, but I'm listening. What should we focus on today?`
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
      sessions.delete(msg.sessionId);
      safeSend(ws, { type: "session_end", sessionId: msg.sessionId });
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

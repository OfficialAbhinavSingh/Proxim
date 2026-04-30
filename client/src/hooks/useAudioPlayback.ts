import { useCallback, useRef } from "react";
import { useAvatarStore } from "../store/avatarStore";
import type { VisemeKeyframe, VisemeSource } from "../types";

type QueueItem = {
  audioBase64: string;
  audioMimeType: string;
  visemes: VisemeKeyframe[];
  visemeSource?: VisemeSource;
  isLast: boolean;
  sentenceIndex: number;
  /** Sentence text for Web Speech Synthesis fallback when TTS audio is silent */
  text?: string;
  /** True when the server sent silence because ElevenLabs/Groq TTS is unavailable */
  isSilence?: boolean;
  /** performance.now() when this chunk was received by client */
  receivedAt?: number;
};

/**
 * Decodes base64 audio and plays through Web Audio API.
 * When the server sends silence (both TTS providers unavailable), uses the
 * browser's Web Speech Synthesis API instead so the user always hears a voice.
 * Schedules viseme track start aligned with playback start.
 */
export function useAudioPlayback(onLastChunkEnded?: () => void) {
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<QueueItem[]>([]);
  const playingRef = useRef(false);
  // Cancel any pending Web Speech utterance when a new chunk starts.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const ensureCtx = useCallback(async () => {
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      ctxRef.current = ctx;
    }
    if (ctx.state === "suspended") await ctx.resume();
    return ctx;
  }, []);

  /**
   * Speak text via Web Speech Synthesis (browser-native, free, works offline).
   * Returns a Promise that resolves when speaking ends.
   */
  function speakWithWebSpeech(text: string, onStart?: () => void): Promise<void> {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window) || !text.trim()) {
        resolve();
        return;
      }
      // Cancel any ongoing utterance first.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text.trim());
      utteranceRef.current = utterance;

      // Try to pick a natural-sounding female voice.
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) =>
          v.lang.startsWith("en") &&
          /female|woman|girl|samantha|zira|susan|karen|moira|tessa/i.test(v.name)
      );
      if (preferred) utterance.voice = preferred;

      utterance.rate = 0.92;
      utterance.pitch = 1.05;
      utterance.volume = 1.0;

      utterance.onstart = () => onStart?.();
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();

      window.speechSynthesis.speak(utterance);
    });
  }

  const pump = useCallback(async () => {
    if (playingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    playingRef.current = true;

    try {
      if (next.isSilence && next.text?.trim()) {
        // ── Silence fallback path ──
        // Use Web Speech Synthesis for voice + let viseme track run for the
        // natural speech duration (Web Speech handles its own timing).
        await speakWithWebSpeech(next.text, () => {
          useAvatarStore.getState().setVisemeTrack(next.visemes, performance.now(), {
            sentenceIndex: next.sentenceIndex,
            isSilence: !!next.isSilence,
            visemeSource: next.visemeSource ?? null,
            receivedAt: next.receivedAt ?? null,
          });
        });
      } else {
        // ── Real audio path (ElevenLabs or Groq WAV) ──
        const ctx = await ensureCtx();
        const bytes = Uint8Array.from(atob(next.audioBase64), (c) =>
          c.charCodeAt(0)
        );
        const copy = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        );
        const buffer = await ctx.decodeAudioData(copy);
        await new Promise<void>((resolve) => {
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.connect(ctx.destination);
          src.onended = () => resolve();
          // Schedule slightly ahead to reduce jitter and align visemes to playback start.
          const leadSec = 0.005;
          const when = ctx.currentTime + leadSec;
          const perfStart = performance.now() + leadSec * 1000;
          const st = useAvatarStore.getState();
          const meta = {
            sentenceIndex: next.sentenceIndex,
            isSilence: !!next.isSilence,
            visemeSource: next.visemeSource ?? null,
            receivedAt: next.receivedAt ?? null,
          };
          // If the track was already started on receive, only update start time to sync with audio.
          if (st.visemes?.length) st.setChunkStartedAt(perfStart, meta);
          else st.setVisemeTrack(next.visemes, perfStart, meta);
          src.start(when);
        });
      }
    } catch {
      // If Web Audio decoding fails, also try Web Speech as last resort.
      if (next.text?.trim()) {
        try {
          await speakWithWebSpeech(next.text, () => {
            useAvatarStore.getState().setVisemeTrack(next.visemes, performance.now(), {
              sentenceIndex: next.sentenceIndex,
              isSilence: !!next.isSilence,
              visemeSource: next.visemeSource ?? null,
              receivedAt: next.receivedAt ?? null,
            });
          });
        } catch {
          // ignore
        }
      }
    }

    playingRef.current = false;

    if (next.isLast) {
      useAvatarStore.getState().clearVisemeTrack();
      onLastChunkEnded?.();
    }

    // Process next item in queue.
    void pump();
  }, [ensureCtx, onLastChunkEnded]);

  const enqueue = useCallback(
    (item: QueueItem) => {
      queueRef.current.push(item);
      void pump();
    },
    [pump]
  );

  return { enqueue, ensureCtx };
}

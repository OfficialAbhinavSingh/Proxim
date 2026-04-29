import { useCallback, useEffect, useRef, useState } from "react";

const SILENCE_MS = 1500;

export interface UseVoiceInputOptions {
  enabled: boolean;
  onUtterance: (text: string) => void;
  onPartial?: (text: string) => void;
  onError?: (message: string) => void;
}

/**
 * Primary path: Web Speech API (SpeechRecognition) with 1.5s silence end-of-utterance.
 * Fallback: MediaRecorder + server Whisper when recognition is unavailable.
 *
 * BUG FIX (mic never starts): startListening used to guard on `enabled`, but React
 * state updates (setAudioUnlocked, setSessionActive) are batched — by the time
 * startListening ran from handleStart the closure still held enabled=false.
 * Now a useEffect owns the start/stop lifecycle, reacting after state commits.
 */
export function useVoiceInput({
  enabled,
  onUtterance,
  onPartial,
  onError,
}: UseVoiceInputOptions) {
  const [listening, setListening] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [mode, setMode] = useState<"webspeech" | "mediarecorder" | "unsupported">("webspeech");

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTextRef = useRef("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // ── helpers ──────────────────────────────────────────────────────────────

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const scheduleUtteranceEnd = useCallback(
    (text: string) => {
      clearSilenceTimer();
      lastTextRef.current = text;
      silenceTimerRef.current = setTimeout(() => {
        const t = lastTextRef.current.trim();
        if (t.length > 0) onUtterance(t);
        lastTextRef.current = "";
        setPartialTranscript("");
        silenceTimerRef.current = null;
      }, SILENCE_MS);
    },
    [clearSilenceTimer, onUtterance]
  );

  // ── Web Speech ────────────────────────────────────────────────────────────

  const stopWebSpeech = useCallback(() => {
    clearSilenceTimer();
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    recognitionRef.current = null;
    setListening(false);
    setPartialTranscript("");
  }, [clearSilenceTimer]);

  // Store a stable ref to enabled so onend can read the latest value without
  // the function needing to be recreated each time enabled changes.
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  const startWebSpeech = useCallback(() => {
    const SR =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
        .webkitSpeechRecognition;
    if (!SR) {
      setMode("mediarecorder");
      return false;
    }
    // Don't double-start
    if (recognitionRef.current) return true;

    setMode("webspeech");
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = "";
      let finalChunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) finalChunk += res[0].transcript;
        else interim += res[0].transcript;
      }
      const combined = (finalChunk + interim).trim();
      if (combined) {
        setPartialTranscript(combined);
        onPartial?.(combined);
        scheduleUtteranceEnd(combined);
      }
    };

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        onError?.("Microphone or speech recognition permission denied.");
      } else if (ev.error !== "no-speech" && ev.error !== "aborted") {
        onError?.(`Speech recognition: ${ev.error}`);
      }
    };

    rec.onend = () => {
      // Auto-restart if still in an active session
      if (recognitionRef.current === rec && enabledRef.current) {
        try { rec.start(); } catch { /* may throw if already starting */ }
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
      return true;
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "Could not start speech recognition");
      return false;
    }
  }, [onError, onPartial, scheduleUtteranceEnd]);

  // ── MediaRecorder (fallback) ──────────────────────────────────────────────

  const stopMediaRecorder = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    setListening(false);
  }, []);

  const transcribeBlob = useCallback(
    async (blob: Blob) => {
      const api = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
      try {
        const fd = new FormData();
        fd.append("audio", blob, "clip.webm");
        const res = await fetch(`${api}/session/transcribe`, { method: "POST", body: fd });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { text?: string };
        const text = (data.text ?? "").trim();
        if (text) onUtterance(text);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Transcription failed");
      }
    },
    [onError, onUtterance]
  );

  const startMediaRecorder = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        void transcribeBlob(blob);
        chunksRef.current = [];
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setMode("mediarecorder");
      setListening(true);
      return true;
    } catch {
      onError?.("Could not access microphone.");
      return false;
    }
  }, [onError, transcribeBlob]);

  // ── Public API ────────────────────────────────────────────────────────────

  /** Tap-to-speak: record a short clip then transcribe (fallback path). */
  const tapToSpeak = useCallback(async () => {
    if (listening && mode === "mediarecorder") {
      stopMediaRecorder();
      return;
    }
    await startMediaRecorder();
    setTimeout(() => {
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
        setListening(false);
      }
    }, 4000);
  }, [listening, mode, startMediaRecorder, stopMediaRecorder]);

  /**
   * Explicitly start — exposed for callers but the reactive effect below is the
   * primary start path so this is now safe to call before state commits.
   */
  const startListening = useCallback(async () => {
    const ok = startWebSpeech();
    if (ok) return;
    const mr = await startMediaRecorder();
    if (!mr) setMode("unsupported");
  }, [startMediaRecorder, startWebSpeech]);

  const stopListening = useCallback(() => {
    stopWebSpeech();
    stopMediaRecorder();
  }, [stopMediaRecorder, stopWebSpeech]);

  /**
   * Reactive auto-start / stop.
   *
   * This is the primary trigger for starting the microphone.
   * When `enabled` flips to true (after React commits the session + audioUnlocked
   * state updates), speech recognition begins automatically — no timing hacks needed.
   */
  useEffect(() => {
    if (enabled) {
      const SR =
        (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
        (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
          .webkitSpeechRecognition;
      if (SR) {
        startWebSpeech();
      } else {
        void startMediaRecorder().then((ok) => {
          if (!ok) setMode("unsupported");
        });
      }
    } else {
      stopListening();
    }
    return () => {
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    listening,
    partialTranscript,
    mode,
    startListening,
    stopListening,
    tapToSpeak,
  };
}

// ── Browser API type declarations ─────────────────────────────────────────────

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, ev: Event) => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

declare const SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};

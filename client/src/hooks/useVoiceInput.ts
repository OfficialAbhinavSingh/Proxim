import { useCallback, useEffect, useRef, useState } from "react";

const SILENCE_MS_WEBSPEECH = 520;
const PCM_SAMPLE_RATE = 16_000;        // Whisper's native rate
const PCM_SPEECH_THRESHOLD = 0.0025;   // RMS — raised from 0.0008 to cut ambient/echo false-positives
const PCM_PEAK_THRESHOLD = 0.035;      // Peak — raised from 0.015 for same reason
const PCM_SILENCE_FRAMES = 15;         // ~610ms silence triggers auto-flush (was 12)
const PCM_MIN_SPEECH_FRAMES = 5;       // require more sustained speech before flushing (was 2)
const PCM_ROLLING_MAX_FRAMES = 250;    // rolling buffer cap ~32s
const PCM_MAX_FRAMES = 230;            // ~30s hard limit per segment
const PCM_BUFFER_SIZE = 2048;
const PCM_MANUAL_TAIL_FRAMES = 48;     // ~6s tail fallback for manual flush
/** ms to keep mic muted after avatar finishes speaking — lets speaker echo die down. */
const POST_SPEAK_COOLDOWN_MS = 450;

const DEBUG = true;
const log = (...args: unknown[]) => { if (DEBUG) console.log("[voice]", ...args); };
const logErr = (...args: unknown[]) => { if (DEBUG) console.error("[voice]", ...args); };

/** Inline WAV encoder — avoids any dependency on vad-web / ONNX. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const s4 = (o: number, t: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s4(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  s4(8, "WAVE");
  s4(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);              // PCM
  v.setUint16(22, 1, true);             // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  s4(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]!));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7FFF, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

export interface UseVoiceInputOptions {
  enabled: boolean;
  /**
   * Set to true while the avatar is playing TTS audio.
   * The PCM pipeline will discard captured frames and clear the buffer to prevent
   * the avatar's voice from being fed back into Whisper (echo loop fix).
   * A POST_SPEAK_COOLDOWN_MS delay is applied after avatarSpeaking goes false
   * so any residual speaker echo dies down before recording resumes.
   */
  avatarSpeaking?: boolean;
  onUtterance: (text: string) => void;
  onPartial?: (text: string) => void;
  onError?: (message: string) => void;
}

type InputMode = "webspeech" | "server_stt" | "unsupported";

export function useVoiceInput({ enabled, avatarSpeaking = false, onUtterance, onPartial, onError }: UseVoiceInputOptions) {
  const [listening, setListening] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [mode, setMode] = useState<InputMode>("webspeech");

  // Web Speech refs
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTextRef = useRef("");

  // PCM-WAV Whisper pipeline refs
  const pipelineActiveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // PCM segment state (lives inside the onaudioprocess closure; these refs allow flush from tapToSpeak)
  const pcmSamplesRef = useRef<Float32Array[]>([]);
  const pcmSpeakingRef = useRef(false);
  const pcmSilenceFramesRef = useRef(0);
  const pcmSpeechFramesRef = useRef(0);
  const pcmTotalFramesRef = useRef(0);
  const pcmFlushingRef = useRef(false);

  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  /**
   * Mic mute gate: true while the avatar is speaking OR during the post-speech
   * cooldown. When muted, the onaudioprocess handler discards incoming frames
   * and clears the rolling buffer so no avatar audio leaks into Whisper.
   */
  const mutedRef = useRef(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (avatarSpeaking) {
      // Avatar started speaking — mute immediately and cancel any pending cooldown.
      if (cooldownTimerRef.current) { clearTimeout(cooldownTimerRef.current); cooldownTimerRef.current = null; }
      mutedRef.current = true;
      // Wipe any audio accumulated before / during avatar speech to avoid contamination.
      pcmSamplesRef.current = [];
      pcmSpeakingRef.current = false;
      pcmSilenceFramesRef.current = 0;
      pcmSpeechFramesRef.current = 0;
      setPartialTranscript("");
    } else {
      // Avatar stopped speaking — stay muted for POST_SPEAK_COOLDOWN_MS so echo dies down.
      cooldownTimerRef.current = setTimeout(() => {
        mutedRef.current = false;
        cooldownTimerRef.current = null;
        log("mic unmuted after post-speak cooldown");
      }, POST_SPEAK_COOLDOWN_MS);
    }
    return () => {
      if (cooldownTimerRef.current) { clearTimeout(cooldownTimerRef.current); cooldownTimerRef.current = null; }
    };
  }, [avatarSpeaking]); // eslint-disable-line react-hooks/exhaustive-deps

  const onUtteranceRef = useRef(onUtterance);
  const onErrorRef = useRef(onError);
  const onPartialRef = useRef(onPartial);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
    onErrorRef.current = onError;
    onPartialRef.current = onPartial;
  }, [onUtterance, onError, onPartial]);

  const reportError = useCallback((msg: string) => {
    logErr(msg);
    onErrorRef.current?.(msg);
  }, []);

  // ── WAV Whisper pipeline ──────────────────────────────────────────────────

  const transcribeBlob = useCallback(async (blob: Blob, label = "") => {
    const api = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    log(`POST /session/transcribe (${blob.size}B${label ? " " + label : ""})`);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "clip.wav");
      const res = await fetch(`${api}/session/transcribe`, { method: "POST", body: fd });
      if (!res.ok) {
        const raw = await res.text();
        throw new Error(raw || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { text?: string; error?: string };
      if (data.error && !data.text) throw new Error(data.error);
      const text = (data.text ?? "").trim();
      if (text) {
        log("whisper →", text);
        onUtteranceRef.current(text);
      } else {
        log("whisper returned empty (noise/hallucination filtered)");
      }
    } catch (e) {
      reportError(`Transcription error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [reportError]);

  /** manualFlush=true skips the min-speech-frames guard (user explicitly pressed Send). */
  const flushPcmBuffer = useCallback(async (manualFlush = false) => {
    if (pcmFlushingRef.current) return;
    if (pcmSamplesRef.current.length === 0) {
      log("PCM flush: buffer empty, nothing to send");
      return;
    }
    const speechFrames = pcmSpeechFramesRef.current;
    if (!manualFlush && speechFrames < PCM_MIN_SPEECH_FRAMES) {
      log(`PCM auto-flush skipped — ${speechFrames} speech frames < ${PCM_MIN_SPEECH_FRAMES} min`);
      pcmSamplesRef.current = [];
      pcmSpeakingRef.current = false;
      pcmSilenceFramesRef.current = 0;
      pcmSpeechFramesRef.current = 0;
      pcmTotalFramesRef.current = 0;
      setPartialTranscript("");
      return;
    }
    pcmFlushingRef.current = true;

    let chunks = pcmSamplesRef.current;
    if (manualFlush && speechFrames < PCM_MIN_SPEECH_FRAMES && chunks.length > PCM_MANUAL_TAIL_FRAMES) {
      // Manual "Send now" often includes a long rolling window. If VAD missed speech,
      // only send the recent tail so Whisper doesn't get dominated by silence.
      chunks = chunks.slice(-PCM_MANUAL_TAIL_FRAMES);
      log(`PCM manual tail fallback: using last ${chunks.length} frames`);
    }
    pcmSamplesRef.current = [];
    pcmSpeakingRef.current = false;
    pcmSilenceFramesRef.current = 0;
    pcmSpeechFramesRef.current = 0;
    pcmTotalFramesRef.current = 0;

    const total = chunks.reduce((a, b) => a + b.length, 0);
    log(`PCM flush (manual=${manualFlush}): ${chunks.length} frames, ${(total / PCM_SAMPLE_RATE).toFixed(2)}s audio`);
    const merged = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { merged.set(c, off); off += c.length; }

    setPartialTranscript("…");
    const blob = encodeWav(merged, PCM_SAMPLE_RATE);
    await transcribeBlob(blob);
    setPartialTranscript("");
    pcmFlushingRef.current = false;
  }, [transcribeBlob]);

  const stopPcmPipeline = useCallback(() => {
    log("stopPcmPipeline");
    pipelineActiveRef.current = false;
    try { processorRef.current?.disconnect(); } catch { /* ignore */ }
    processorRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    pcmSamplesRef.current = [];
    pcmSpeakingRef.current = false;
    pcmSilenceFramesRef.current = 0;
    pcmSpeechFramesRef.current = 0;
    pcmTotalFramesRef.current = 0;
    pcmFlushingRef.current = false;
    setListening(false);
    setPartialTranscript("");
  }, []);

  const startPcmWhisperPipeline = useCallback(async () => {
    if (pipelineActiveRef.current) { log("PCM pipeline already active"); return; }
    log("starting PCM WAV → Whisper pipeline");
    pipelineActiveRef.current = true;
    setMode("server_stt");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      log("mic stream acquired");

      const audioCtx = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => {});
      }
      log(`AudioContext state=${audioCtx.state} sampleRate=${audioCtx.sampleRate}`);

      const source = audioCtx.createMediaStreamSource(stream);
      // ScriptProcessor is deprecated but still fully supported in all browsers
      // and doesn't need a separate worklet URL file.
      const processor = audioCtx.createScriptProcessor(PCM_BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (ev) => {
        if (!pipelineActiveRef.current || !enabledRef.current || pcmFlushingRef.current) return;

        // Drop all frames while avatar is speaking (or during echo-tail cooldown).
        if (mutedRef.current) {
          pcmSamplesRef.current = [];
          pcmSpeakingRef.current = false;
          pcmSilenceFramesRef.current = 0;
          pcmSpeechFramesRef.current = 0;
          return;
        }

        const input = ev.inputBuffer.getChannelData(0);
        pcmTotalFramesRef.current += 1;

        // RMS + peak energy (peak catches quiet but sharp consonants)
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < input.length; i++) {
          const v = input[i]!;
          sum += v * v;
          const a = Math.abs(v);
          if (a > peak) peak = a;
        }
        const rms = Math.sqrt(sum / input.length);

        // Always accumulate into rolling buffer (so Send now always has audio)
        pcmSamplesRef.current.push(new Float32Array(input));
        // Cap rolling buffer to avoid unbounded memory
        if (pcmSamplesRef.current.length > PCM_ROLLING_MAX_FRAMES) {
          pcmSamplesRef.current.shift();
        }

        if (rms > PCM_SPEECH_THRESHOLD || peak > PCM_PEAK_THRESHOLD) {
          if (!pcmSpeakingRef.current) {
            log(`speech start (rms=${rms.toFixed(4)} peak=${peak.toFixed(4)})`);
          }
          pcmSpeakingRef.current = true;
          pcmSilenceFramesRef.current = 0;
          pcmSpeechFramesRef.current += 1;
          setPartialTranscript("(speaking…)");
          onPartialRef.current?.("(speaking…)");
        } else if (pcmSpeakingRef.current) {
          pcmSilenceFramesRef.current += 1;
          if (pcmSilenceFramesRef.current >= PCM_SILENCE_FRAMES) {
            log(`auto-flush: silence after ${pcmSpeechFramesRef.current} speech frames`);
            void flushPcmBuffer(false);
          }
        }

        // Hard max limit
        if (pcmTotalFramesRef.current >= PCM_MAX_FRAMES) {
          log("PCM max frames reached, flushing");
          void flushPcmBuffer(false);
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      setListening(true);
    } catch (e) {
      pipelineActiveRef.current = false;
      reportError(`Microphone error: ${e instanceof Error ? e.message : String(e)}`);
      setListening(false);
      setMode("unsupported");
    }
  }, [flushPcmBuffer, reportError]);

  // ── Web Speech API ────────────────────────────────────────────────────────

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const scheduleUtteranceEnd = useCallback((text: string) => {
    clearSilenceTimer();
    lastTextRef.current = text;
    silenceTimerRef.current = setTimeout(() => {
      const t = lastTextRef.current.trim();
      if (t) { log("webspeech utterance →", t); onUtteranceRef.current(t); }
      lastTextRef.current = "";
      setPartialTranscript("");
      silenceTimerRef.current = null;
    }, SILENCE_MS_WEBSPEECH);
  }, [clearSilenceTimer]);

  const stopWebSpeech = useCallback(() => {
    clearSilenceTimer();
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
    recognitionRef.current = null;
    setPartialTranscript("");
  }, [clearSilenceTimer]);

  const startWebSpeech = useCallback((): boolean => {
    const SR =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!SR) { log("Web Speech API not available"); return false; }
    if (recognitionRef.current) return true;

    log("starting Web Speech API");
    setMode("webspeech");
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = "";
      let finalChunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interim += r[0].transcript;
      }
      const combined = (finalChunk + interim).trim();
      if (combined) {
        setPartialTranscript(combined);
        onPartialRef.current?.(combined);
        scheduleUtteranceEnd(combined);
      }
    };

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      logErr(`Web Speech error: ${ev.error}`);
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        reportError("Microphone permission denied.");
      } else if (ev.error === "network") {
        // Google speech servers unreachable — fall back to PCM-WAV Whisper
        recognitionRef.current = null;
        try { rec.stop(); } catch { /* ignore */ }
        reportError("Web Speech unavailable (network). Switching to Whisper…");
        void startPcmWhisperPipeline();
      }
      // "no-speech" and "aborted" are non-fatal; onend will restart
    };

    rec.onend = () => {
      if (recognitionRef.current === rec && enabledRef.current) {
        try { rec.start(); } catch { /* ignore */ }
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
      return true;
    } catch (e) {
      reportError(e instanceof Error ? e.message : "Could not start speech recognition");
      return false;
    }
  }, [reportError, scheduleUtteranceEnd, startPcmWhisperPipeline]);

  // ── Public API ────────────────────────────────────────────────────────────

  const stopListening = useCallback(() => {
    log("stopListening");
    stopWebSpeech();
    stopPcmPipeline();
  }, [stopPcmPipeline, stopWebSpeech]);

  const startListening = useCallback(async () => {
    const forceServer = import.meta.env.VITE_FORCE_SERVER_STT === "true";
    log(`startListening (forceServer=${forceServer})`);
    if (forceServer) {
      await startPcmWhisperPipeline();
      return;
    }
    const ok = startWebSpeech();
    if (!ok) await startPcmWhisperPipeline();
  }, [startPcmWhisperPipeline, startWebSpeech]);

  const tapToSpeak = useCallback(() => {
    if (mode === "server_stt") {
      log("tapToSpeak: manual flush (bypasses speech-frame guard)");
      void flushPcmBuffer(true);
    }
    // webspeech is hands-free; tap does nothing
  }, [flushPcmBuffer, mode]);

  useEffect(() => {
    if (enabled) {
      const forceServer = import.meta.env.VITE_FORCE_SERVER_STT === "true";
      if (forceServer) {
        void startPcmWhisperPipeline();
      } else {
        const ok = startWebSpeech();
        if (!ok) void startPcmWhisperPipeline();
      }
    } else {
      stopListening();
    }
    return () => { stopListening(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { listening, partialTranscript, mode, startListening, stopListening, tapToSpeak };
}

// ── Minimal browser type stubs ────────────────────────────────────────────

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
declare const SpeechRecognition: { prototype: SpeechRecognition; new(): SpeechRecognition };

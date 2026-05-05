import { useCallback, useEffect, useRef, useState } from "react";

const SILENCE_MS_WEBSPEECH = 520;
/** Legacy MediaRecorder path: shorter than old 1.5s, still slower than VAD. */
const SILENCE_MS_LEGACY_SERVER = 880;
const MIN_UTTERANCE_MS = 600;
const MAX_SEGMENT_MS = 45_000;
const MONITOR_INTERVAL_MS = 80;
const SPEECH_PEAK_THRESHOLD = 0.02;
const MIN_BLOB_BYTES = 900;
const VAD_MIN_SAMPLES = 3200;

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

async function parseTranscribeError(res: Response): Promise<string> {
  const raw = await res.text();
  try {
    const j = JSON.parse(raw) as { error?: string };
    if (j.error && typeof j.error === "string") return j.error;
  } catch {
    /* ignore */
  }
  return raw || `HTTP ${res.status}`;
}

export interface UseVoiceInputOptions {
  enabled: boolean;
  onUtterance: (text: string) => void;
  onPartial?: (text: string) => void;
  onError?: (message: string) => void;
}

type InputMode = "webspeech" | "vad_whisper" | "server_stt" | "unsupported";

interface MicVadLike {
  start: () => void;
  pause: () => void;
  destroy: () => void;
}

/**
 * Primary path: Web Speech API with short silence end-of-utterance.
 * Fallback: @ricky0123/vad-web MicVAD → WAV → POST /session/transcribe (Whisper).
 * Last resort: MediaRecorder + RMS silence splits (legacy).
 *
 * Set `VITE_FORCE_SERVER_STT=true` to skip Web Speech and use VAD/Whisper first.
 */
export function useVoiceInput({
  enabled,
  onUtterance,
  onPartial,
  onError,
}: UseVoiceInputOptions) {
  const [listening, setListening] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [mode, setMode] = useState<InputMode>("webspeech");

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTextRef = useRef("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const pipelineActiveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const timeDomainRef = useRef<Uint8Array | null>(null);
  const monitorIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentStartRef = useRef(0);
  const lastVoiceRef = useRef(0);
  const hadSpeechInSegmentRef = useRef(false);
  const vadRef = useRef<MicVadLike | null>(null);

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const onUtteranceRef = useRef(onUtterance);
  const onErrorRef = useRef(onError);
  const onPartialRef = useRef(onPartial);
  useEffect(() => {
    onUtteranceRef.current = onUtterance;
    onErrorRef.current = onError;
    onPartialRef.current = onPartial;
  }, [onUtterance, onError, onPartial]);

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
        if (t.length > 0) onUtteranceRef.current(t);
        lastTextRef.current = "";
        setPartialTranscript("");
        silenceTimerRef.current = null;
      }, SILENCE_MS_WEBSPEECH);
    },
    [clearSilenceTimer]
  );

  const stopWebSpeech = useCallback(() => {
    clearSilenceTimer();
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    setPartialTranscript("");
  }, [clearSilenceTimer]);

  const clearSegmentMonitor = useCallback(() => {
    if (monitorIntervalRef.current) {
      clearInterval(monitorIntervalRef.current);
      monitorIntervalRef.current = null;
    }
  }, []);

  const stopMediaRecorderOnly = useCallback(() => {
    clearSegmentMonitor();
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    } catch {
      /* ignore */
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, [clearSegmentMonitor]);

  const teardownAudioGraph = useCallback(() => {
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    analyserRef.current = null;
    timeDomainRef.current = null;
    if (ctx && ctx.state !== "closed") {
      void ctx.close().catch(() => {});
    }
  }, []);

  const stopServerSttPipeline = useCallback(() => {
    pipelineActiveRef.current = false;
    clearSegmentMonitor();
    stopMediaRecorderOnly();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    teardownAudioGraph();
    setListening(false);
  }, [clearSegmentMonitor, stopMediaRecorderOnly, teardownAudioGraph]);

  const stopVad = useCallback(() => {
    try {
      vadRef.current?.destroy();
    } catch {
      /* ignore */
    }
    vadRef.current = null;
    pipelineActiveRef.current = false;
    setListening(false);
  }, []);

  const transcribeBlob = useCallback(async (blob: Blob, filename = "clip.webm") => {
    const api = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    try {
      const fd = new FormData();
      fd.append("audio", blob, filename);
      const res = await fetch(`${api}/session/transcribe`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await parseTranscribeError(res));
      const data = (await res.json()) as { text?: string; error?: string };
      if (data.error && !data.text) throw new Error(data.error);
      const text = (data.text ?? "").trim();
      if (text) onUtteranceRef.current(text);
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : "Transcription failed");
    }
  }, []);

  const beginServerSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !pipelineActiveRef.current || !enabledRef.current) return;

    clearSegmentMonitor();
    const mime = pickRecorderMime();
    let mr: MediaRecorder;
    try {
      mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      onErrorRef.current?.("MediaRecorder is not supported for this browser / codec.");
      pipelineActiveRef.current = false;
      setListening(false);
      setMode("unsupported");
      return;
    }

    chunksRef.current = [];
    mr.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };

    segmentStartRef.current = performance.now();
    lastVoiceRef.current = segmentStartRef.current;
    hadSpeechInSegmentRef.current = false;

    mr.onstop = () => {
      clearSegmentMonitor();
      mediaRecorderRef.current = null;
      const t = mr.mimeType || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: t });
      chunksRef.current = [];

      const run = async () => {
        if (blob.size >= MIN_BLOB_BYTES && pipelineActiveRef.current && enabledRef.current) {
          setPartialTranscript("…");
          await transcribeBlob(blob);
          setPartialTranscript("");
        }
        if (pipelineActiveRef.current && enabledRef.current) {
          beginServerSegment();
        } else {
          setListening(false);
        }
      };
      void run();
    };

    mediaRecorderRef.current = mr;
    try {
      mr.start();
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : "Could not start recording");
      pipelineActiveRef.current = false;
      setListening(false);
      return;
    }

    const analyser = analyserRef.current;
    const buf = timeDomainRef.current;
    if (!analyser || !buf) return;

    monitorIntervalRef.current = setInterval(() => {
      if (!pipelineActiveRef.current || !enabledRef.current) return;
      const rec = mediaRecorderRef.current;
      if (!rec || rec.state !== "recording") return;

      analyser.getByteTimeDomainData(buf as Uint8Array<ArrayBuffer>);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs((buf[i]! - 128) / 128);
        if (v > peak) peak = v;
      }
      const now = performance.now();
      if (peak >= SPEECH_PEAK_THRESHOLD) {
        hadSpeechInSegmentRef.current = true;
        lastVoiceRef.current = now;
        const interim = "(listening…)";
        setPartialTranscript(interim);
        onPartialRef.current?.(interim);
      }

      const silentFor = now - lastVoiceRef.current;
      const segmentAge = now - segmentStartRef.current;
      const shouldSplit =
        hadSpeechInSegmentRef.current &&
        silentFor >= SILENCE_MS_LEGACY_SERVER &&
        segmentAge >= MIN_UTTERANCE_MS;
      const maxOut = segmentAge >= MAX_SEGMENT_MS;

      if (shouldSplit || maxOut) {
        clearSegmentMonitor();
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
    }, MONITOR_INTERVAL_MS);
  }, [clearSegmentMonitor, transcribeBlob]);

  const startLegacyServerSttPipeline = useCallback(async () => {
    if (pipelineActiveRef.current) return;
    pipelineActiveRef.current = true;
    setMode("server_stt");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      await audioCtx.resume().catch(() => {});

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyserRef.current = analyser;
      timeDomainRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));

      const silent = audioCtx.createGain();
      silent.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silent);
      silent.connect(audioCtx.destination);

      setListening(true);
      beginServerSegment();
    } catch {
      pipelineActiveRef.current = false;
      onErrorRef.current?.("Could not access microphone.");
      setListening(false);
      setMode("unsupported");
    }
  }, [beginServerSegment]);

  const startVadWhisperPipeline = useCallback(async () => {
    if (vadRef.current || pipelineActiveRef.current) return;
    setMode("vad_whisper");

    try {
      const ort = await import("onnxruntime-web");
      const wasmVer = import.meta.env.VITE_ORT_WASM_VERSION;
      if (wasmVer) {
        ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${wasmVer}/dist/`;
      }

      const { MicVAD, utils } = await import("@ricky0123/vad-web");
      const { VAD_WORKLET_URL, VAD_MODEL_URL } = await import("../vad/vadAssets");

      const resolveModelFetchUrl = (path: string) => {
        if (path.startsWith("http://") || path.startsWith("https://")) return path;
        return new URL(path, window.location.href).href;
      };

      const vad = (await MicVAD.new({
        workletURL: VAD_WORKLET_URL,
        modelURL: VAD_MODEL_URL,
        modelFetcher: (path: string) =>
          fetch(resolveModelFetchUrl(path)).then((r) => r.arrayBuffer()),
        redemptionFrames: 2,
        minSpeechFrames: 2,
        positiveSpeechThreshold: 0.45,
        negativeSpeechThreshold: 0.28,
        submitUserSpeechOnPause: true,
        onSpeechStart: () => {
          const interim = "(listening…)";
          setPartialTranscript(interim);
          onPartialRef.current?.(interim);
        },
        onSpeechEnd: async (audio: Float32Array) => {
          if (!pipelineActiveRef.current || !enabledRef.current) return;
          if (audio.length < VAD_MIN_SAMPLES) return;
          setPartialTranscript("…");
          try {
            const wav = utils.encodeWAV(audio);
            const blob = new Blob([wav], { type: "audio/wav" });
            await transcribeBlob(blob, "clip.wav");
          } finally {
            if (enabledRef.current) setPartialTranscript("");
          }
        },
        onVADMisfire: () => {},
        onFrameProcessed: () => {},
      })) as MicVadLike;

      vadRef.current = vad;
      pipelineActiveRef.current = true;
      vad.start();
      setListening(true);
    } catch (e) {
      vadRef.current = null;
      const msg = e instanceof Error ? e.message : "VAD failed";
      onErrorRef.current?.(`${msg} — falling back to legacy recorder.`);
      await startLegacyServerSttPipeline();
    }
  }, [startLegacyServerSttPipeline, transcribeBlob]);

  const startWebSpeech = useCallback(() => {
    const SR =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
    if (!SR) {
      return false;
    }
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
        onPartialRef.current?.(combined);
        scheduleUtteranceEnd(combined);
      }
    };

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        onErrorRef.current?.("Microphone or speech recognition permission denied.");
      } else if (ev.error === "network") {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
        recognitionRef.current = null;
        onErrorRef.current?.("Web Speech unavailable (network/VPN). Switching to VAD transcription…");
        void startVadWhisperPipeline();
      } else if (ev.error !== "no-speech" && ev.error !== "aborted") {
        onErrorRef.current?.(`Speech recognition: ${ev.error}`);
      }
    };

    rec.onend = () => {
      if (recognitionRef.current === rec && enabledRef.current) {
        try {
          rec.start();
        } catch {
          /* may throw if already starting */
        }
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
      return true;
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : "Could not start speech recognition");
      return false;
    }
  }, [scheduleUtteranceEnd, startVadWhisperPipeline]);

  const stopListening = useCallback(() => {
    stopWebSpeech();
    stopServerSttPipeline();
    stopVad();
  }, [stopServerSttPipeline, stopVad, stopWebSpeech]);

  const startListening = useCallback(async () => {
    const forceServer = import.meta.env.VITE_FORCE_SERVER_STT === "true";
    if (forceServer) {
      await startVadWhisperPipeline();
      return;
    }
    const ok = startWebSpeech();
    if (ok) return;
    await startVadWhisperPipeline();
  }, [startVadWhisperPipeline, startWebSpeech]);

  const tapToSpeak = useCallback(() => {
    if (mode === "vad_whisper" && vadRef.current) {
      vadRef.current.pause();
      vadRef.current.start();
      return;
    }
    if (mode === "server_stt" && mediaRecorderRef.current?.state === "recording") {
      clearSegmentMonitor();
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
      return;
    }
    if (mode === "webspeech") {
      return;
    }
    void startVadWhisperPipeline();
  }, [clearSegmentMonitor, mode, startVadWhisperPipeline]);

  useEffect(() => {
    if (enabled) {
      const forceServer = import.meta.env.VITE_FORCE_SERVER_STT === "true";
      if (forceServer) {
        void startVadWhisperPipeline();
      } else {
        const SR =
          (window as unknown as { SpeechRecognition?: typeof SpeechRecognition }).SpeechRecognition ||
          (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition }).webkitSpeechRecognition;
        if (SR) {
          const ok = startWebSpeech();
          if (!ok) void startVadWhisperPipeline();
        } else {
          void startVadWhisperPipeline();
        }
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

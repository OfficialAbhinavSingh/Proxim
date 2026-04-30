import { useCallback, useEffect, useRef, useState } from "react";
import type { Emotion, VisemeKeyframe, VisemeSource, WsClientMessage, WsServerMessage } from "../types";
import { useSessionStore } from "../store/sessionStore";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3001";

export interface AudioChunkPayload {
  audioBase64: string;
  audioMimeType: string;
  visemes: VisemeKeyframe[];
  visemeSource?: VisemeSource;
  isLast: boolean;
  sentenceIndex: number;
  /** Sentence text for Web Speech Synthesis fallback */
  text?: string;
  /** True when server sent silence (TTS providers unavailable) */
  isSilence?: boolean;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const connectAttemptRef = useRef(0);
  const onAudioChunkRef = useRef<(p: AudioChunkPayload) => void>(() => {});
  const onTranscriptRef = useRef<(text: string, emotion: Emotion) => void>(() => {});
  const onErrorRef = useRef<(msg: string) => void>(() => {});

  const setCurrentEmotion = useSessionStore((s) => s.setCurrentEmotion);
  const clearAssistantStream = useSessionStore((s) => s.clearAssistantStream);
  const setAssistantStreamingText = useSessionStore((s) => s.setAssistantStreamingText);
  const setCapabilities = useSessionStore((s) => s.setCapabilities);
  const setWsProtocolVersion = useSessionStore((s) => s.setWsProtocolVersion);

  const candidateUrls = useCallback((): string[] => {
    const base = WS_URL;
    const out = [base];
    // Windows networks often resolve `localhost` to IPv6 (::1). If the server is only reachable
    // on IPv4, the WS handshake fails. Auto-fallback to 127.0.0.1.
    if (/^ws:\/\/localhost(:\d+)?/i.test(base)) {
      out.push(base.replace(/^ws:\/\/localhost/i, "ws://127.0.0.1"));
    }
    return Array.from(new Set(out));
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const urls = candidateUrls();
    const attempt = connectAttemptRef.current % urls.length;
    const url = urls[attempt];
    connectAttemptRef.current += 1;

    let opened = false;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => {
      opened = true;
      setConnected(true);
    };
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      setWsProtocolVersion(null);
      // If we never opened and we have a fallback URL, try it once automatically.
      if (!opened && urls.length > 1 && attempt === 0) {
        onErrorRef.current(`WebSocket failed at ${url}, retrying ${urls[1]}...`);
        // Re-attempt with next candidate.
        queueMicrotask(() => connect());
      }
    };
    ws.onerror = () => {
      onErrorRef.current(`WebSocket connection error (${url})`);
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as WsServerMessage;
        if (data.type === "error") {
          onErrorRef.current(data.message);
          return;
        }
        if (data.type === "hello") {
          setWsProtocolVersion(data.protocolVersion);
          return;
        }
        if (data.type === "audio_chunk") {
          onAudioChunkRef.current({
            audioBase64: data.audioBase64,
            audioMimeType: data.audioMimeType,
            visemes: data.visemes,
            visemeSource: data.visemeSource,
            isLast: data.isLast,
            sentenceIndex: data.sentenceIndex,
            text: data.text,
            isSilence: data.isSilence,
          });
          return;
        }
        if (data.type === "capabilities") {
          setCapabilities({
            alignmentAvailable: data.alignment.available,
            elevenLabsConfigured: data.tts.elevenLabsConfigured,
            groqConfigured: data.tts.groqConfigured,
          });
          return;
        }
        if (data.type === "transcript_update") {
          setCurrentEmotion(data.emotion);
          setAssistantStreamingText(data.text);
          onTranscriptRef.current(data.text, data.emotion);
          return;
        }
        if (data.type === "session_end") {
          clearAssistantStream();
        }
      } catch {
        onErrorRef.current("Invalid message from server");
      }
    };
  }, [
    candidateUrls,
    clearAssistantStream,
    setAssistantStreamingText,
    setCapabilities,
    setCurrentEmotion,
    setWsProtocolVersion,
  ]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setConnected(false);
  }, []);

  const send = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      onErrorRef.current("Not connected");
      return false;
    }
    ws.send(JSON.stringify(msg));
    return true;
  }, []);

  const setOnAudioChunk = useCallback((fn: (p: AudioChunkPayload) => void) => {
    onAudioChunkRef.current = fn;
  }, []);

  const setOnTranscriptUpdate = useCallback(
    (fn: (text: string, emotion: Emotion) => void) => {
      onTranscriptRef.current = fn;
    },
    []
  );

  const setOnError = useCallback((fn: (msg: string) => void) => {
    onErrorRef.current = fn;
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    connected,
    connect,
    disconnect,
    send,
    setOnAudioChunk,
    setOnTranscriptUpdate,
    setOnError,
  };
}

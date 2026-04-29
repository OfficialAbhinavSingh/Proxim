import { useCallback, useEffect, useRef, useState } from "react";
import type { Emotion, VisemeKeyframe, WsClientMessage, WsServerMessage } from "../types";
import { useSessionStore } from "../store/sessionStore";

const WS_URL = import.meta.env.VITE_WS_URL ?? "ws://localhost:3001";

export interface AudioChunkPayload {
  audioBase64: string;
  audioMimeType: string;
  visemes: VisemeKeyframe[];
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
  const onAudioChunkRef = useRef<(p: AudioChunkPayload) => void>(() => {});
  const onTranscriptRef = useRef<(text: string, emotion: Emotion) => void>(() => {});
  const onErrorRef = useRef<(msg: string) => void>(() => {});

  const setCurrentEmotion = useSessionStore((s) => s.setCurrentEmotion);
  const clearAssistantStream = useSessionStore((s) => s.clearAssistantStream);
  const setAssistantStreamingText = useSessionStore((s) => s.setAssistantStreamingText);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
    };
    ws.onerror = () => {
      onErrorRef.current("WebSocket connection error");
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as WsServerMessage;
        if (data.type === "error") {
          onErrorRef.current(data.message);
          return;
        }
        if (data.type === "audio_chunk") {
          onAudioChunkRef.current({
            audioBase64: data.audioBase64,
            audioMimeType: data.audioMimeType,
            visemes: data.visemes,
            isLast: data.isLast,
            sentenceIndex: data.sentenceIndex,
            text: data.text,
            isSilence: data.isSilence,
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
  }, [clearAssistantStream, setAssistantStreamingText, setCurrentEmotion]);

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

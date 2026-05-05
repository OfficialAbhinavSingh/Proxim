import { create } from "zustand";
import type { Emotion, Message, Persona } from "../types";

export interface SessionState {
  sessionId: string | null;
  personaId: string | null;
  isSessionActive: boolean;
  startedAt: number | null;
  messages: Message[];
  liveUserTranscript: string;
  assistantStreamingText: string;
  currentEmotion: Emotion;
  micError: string | null;
  /** User has performed a gesture that unlocks audio (mobile autoplay). */
  audioUnlocked: boolean;
  sidebarOpen: boolean;
  /** Latest WS hello protocolVersion from server (null until connected). */
  wsProtocolVersion: number | null;
  capabilities: {
    alignmentAvailable: boolean | null;
    elevenLabsConfigured: boolean | null;
    groqConfigured: boolean | null;
  };

  /** Client-side timing for demo / tuning (ms from user send to first LLM text / first audio chunk). */
  latency: {
    active: boolean;
    t0: number;
    llmMs: number | null;
    audioMs: number | null;
  };

  setPersonaId: (id: string | null) => void;
  setSessionId: (id: string | null) => void;
  setSessionActive: (active: boolean) => void;
  setStartedAt: (t: number | null) => void;
  addMessage: (m: Message) => void;
  appendAssistantStream: (chunk: string) => void;
  setAssistantStreamingText: (t: string) => void;
  clearAssistantStream: () => void;
  finalizeAssistantMessage: (content: string, emotion?: Emotion) => void;
  setLiveUserTranscript: (t: string) => void;
  setCurrentEmotion: (e: Emotion) => void;
  setMicError: (e: string | null) => void;
  setAudioUnlocked: (v: boolean) => void;
  toggleSidebar: () => void;
  setCapabilities: (c: SessionState["capabilities"]) => void;
  setWsProtocolVersion: (v: number | null) => void;
  resetSession: () => void;

  beginLatencyTurn: () => void;
  markLlmLatencyIfNeeded: (assistantText: string) => void;
  markAudioLatencyIfNeeded: () => void;
  clearLatencyTurn: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  personaId: null,
  isSessionActive: false,
  startedAt: null,
  messages: [],
  liveUserTranscript: "",
  assistantStreamingText: "",
  currentEmotion: "neutral",
  micError: null,
  audioUnlocked: false,
  sidebarOpen: true,
  wsProtocolVersion: null,
  capabilities: {
    alignmentAvailable: null,
    elevenLabsConfigured: null,
    groqConfigured: null,
  },
  latency: { active: false, t0: 0, llmMs: null, audioMs: null },

  setPersonaId: (personaId) => set({ personaId }),
  setSessionId: (sessionId) => set({ sessionId }),
  setSessionActive: (isSessionActive) => set({ isSessionActive }),
  setStartedAt: (startedAt) => set({ startedAt }),
  addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),
  appendAssistantStream: (chunk) =>
    set((s) => ({ assistantStreamingText: s.assistantStreamingText + chunk })),
  setAssistantStreamingText: (assistantStreamingText) => set({ assistantStreamingText }),
  clearAssistantStream: () => set({ assistantStreamingText: "" }),
  finalizeAssistantMessage: (content, emotion) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          role: "assistant",
          content,
          emotion: emotion ?? s.currentEmotion,
          timestamp: Date.now(),
        },
      ],
      assistantStreamingText: "",
    })),
  setLiveUserTranscript: (liveUserTranscript) => set({ liveUserTranscript }),
  setCurrentEmotion: (currentEmotion) => set({ currentEmotion }),
  setMicError: (micError) => set({ micError }),
  setAudioUnlocked: (audioUnlocked) => set({ audioUnlocked }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setCapabilities: (capabilities) => set({ capabilities }),
  setWsProtocolVersion: (wsProtocolVersion) => set({ wsProtocolVersion }),

  beginLatencyTurn: () =>
    set({
      latency: { active: true, t0: performance.now(), llmMs: null, audioMs: null },
    }),
  markLlmLatencyIfNeeded: (assistantText) =>
    set((s) => {
      if (!s.latency.active || s.latency.llmMs != null) return s;
      if (!assistantText.trim()) return s;
      return {
        latency: { ...s.latency, llmMs: Math.round(performance.now() - s.latency.t0) },
      };
    }),
  markAudioLatencyIfNeeded: () =>
    set((s) => {
      if (!s.latency.active || s.latency.audioMs != null) return s;
      return {
        latency: { ...s.latency, audioMs: Math.round(performance.now() - s.latency.t0) },
      };
    }),
  clearLatencyTurn: () =>
    set({
      latency: { active: false, t0: 0, llmMs: null, audioMs: null },
    }),

  resetSession: () =>
    set({
      sessionId: null,
      isSessionActive: false,
      startedAt: null,
      messages: [],
      liveUserTranscript: "",
      assistantStreamingText: "",
      currentEmotion: "neutral",
      micError: null,
      wsProtocolVersion: null,
      capabilities: {
        alignmentAvailable: null,
        elevenLabsConfigured: null,
        groqConfigured: null,
      },
      latency: { active: false, t0: 0, llmMs: null, audioMs: null },
    }),
}));

export function getPersonaById(personas: Persona[], id: string | null): Persona | undefined {
  if (!id) return undefined;
  return personas.find((p) => p.id === id);
}

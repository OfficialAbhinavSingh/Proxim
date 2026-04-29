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
  resetSession: () => void;
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
    }),
}));

export function getPersonaById(personas: Persona[], id: string | null): Persona | undefined {
  if (!id) return undefined;
  return personas.find((p) => p.id === id);
}

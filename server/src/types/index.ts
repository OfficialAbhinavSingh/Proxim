export type VisemeKey =
  | "sil"
  | "PP"
  | "FF"
  | "TH"
  | "DD"
  | "kk"
  | "CH"
  | "SS"
  | "nn"
  | "RR"
  | "aa"
  | "E"
  | "ih"
  | "oh"
  | "ou";

export interface VisemeKeyframe {
  time: number;
  viseme: VisemeKey;
  weight: number;
}

export type Emotion = "neutral" | "engaged" | "skeptical" | "positive";

export interface Message {
  role: "user" | "assistant";
  content: string;
  emotion?: Emotion;
  timestamp: number;
}

export interface Persona {
  id: string;
  name: string;
  specialty: string;
  hospital: string;
  personality: string;
  mood: string;
  avatarUrl: string;
  voiceId: string;
  systemPrompt: string;
}

export type WsClientMessage =
  | { type: "session_start"; sessionId: string; personaId: string }
  | { type: "session_end"; sessionId: string }
  | {
      type: "user_input";
      text: string;
      sessionId: string;
      personaId: string;
    };

export type WsServerMessage =
  | {
      type: "audio_chunk";
      audioBase64: string;
      audioMimeType: string;
      visemes: VisemeKeyframe[];
      isLast: boolean;
      sentenceIndex: number;
      /** Sentence text — used by client for Web Speech Synthesis TTS fallback */
      text?: string;
      /** True when this chunk carries only silence (ElevenLabs/Groq TTS unavailable) */
      isSilence?: boolean;
    }
  | {
      type: "transcript_update";
      role: "assistant";
      text: string;
      emotion: Emotion;
    }
  | { type: "session_start"; sessionId: string; personaId: string }
  | { type: "session_end"; sessionId: string }
  | { type: "error"; message: string };

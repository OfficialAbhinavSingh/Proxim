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

export type Emotion = "neutral" | "engaged" | "skeptical" | "concerned" | "positive";

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
  moodBaseline?: string;
  /** Display / prompting hint only — swap `avatarUrl` to a matching Ready Player Me GLB. */
  gender?: "female" | "male";
  avatarUrl: string;
  voiceId: string;
  /** Groq Orpheus voice name for this persona. */
  groqVoice?: string;
  systemPrompt: string;
  /** When true, the system prompt includes MLR/off-label compliance guardrails. */
  complianceMode?: boolean;
}

export type ScoreItemStatus = "pass" | "warn" | "fail";

export interface ScoreItem {
  label: string;
  status: ScoreItemStatus;
}

export interface ScoreCard {
  score: number;          // 0–100
  readiness: string;      // e.g. "Field Ready", "Almost Ready", "Needs Practice"
  items: ScoreItem[];
  summary: string;        // 1-sentence overall coaching note
}

export type VisemeSource =
  | "elevenlabs_alignment"
  | "fallback_audio"
  | "fallback_text"
  | "fallback_static";

/** Must match server `WS_PROTOCOL_VERSION`. */
export const WS_PROTOCOL_VERSION = 2;

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
      type: "hello";
      protocolVersion: number;
      service: "proxim-server";
    }
  | {
      type: "audio_chunk";
      audioBase64: string;
      audioMimeType: string;
      visemes: VisemeKeyframe[];
      visemeSource?: VisemeSource;
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
  | {
      type: "capabilities";
      sessionId: string;
      alignment: { available: boolean };
      tts: { elevenLabsConfigured: boolean; groqConfigured: boolean };
      musetalk: { available: boolean };
    }
  | { type: "session_start"; sessionId: string; personaId: string }
  | { type: "session_end"; sessionId: string }
  | { type: "session_scorecard"; sessionId: string; scoreCard: ScoreCard }
  | {
      type: "video_frame";
      frameBase64: string;
      sentenceIndex: number;
      frameIndex: number;
    }
  | {
      /** Dedicated emotion event — emitted before the first TTS audio chunk of each turn. */
      type: "emotion";
      tag: Emotion;
    }
  | {
      /** Server-side pipeline latency breakdown. */
      type: "latency";
      stt_ms: number;
      llm_first_token_ms: number;
      tts_start_ms: number;
      total_ms: number;
    }
  | { type: "error"; message: string };

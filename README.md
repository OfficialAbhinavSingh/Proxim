<div align="center">

# 🩺 Proxim

### *Where pharma reps sharpen their edge — face to face with AI.*

**Browser-native · Voice-first · Real-time lip sync · Scorecard coaching**

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Groq](https://img.shields.io/badge/Groq-LLM%20%2B%20TTS%20%2B%20STT-F55036?style=flat-square)](https://groq.com)
[![ElevenLabs](https://img.shields.io/badge/ElevenLabs-Voice%20AI-000000?style=flat-square)](https://elevenlabs.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

</div>

---

## What is Proxim?

Proxim is a **browser-based AI roleplay training lab** for pharmaceutical sales reps. You sit across from a photorealistic 3D avatar of a simulated physician — their mouth moves, their emotions shift, and they push back on your pitch — all in real time, with zero installs.

After each session, Proxim hands you a graded **post-call debrief scorecard** covering clinical accuracy, objection handling, compliance adherence, and conversational tactics.

> Think of it as a flight simulator for HCP conversations.

---

## ✅ What's Been Shipped

### 🎙️ Voice Pipeline
- **Web Speech API** transcription with **Voice Activity Detection (VAD)** — silence auto-triggers AI response
- **Groq Whisper (`whisper-large-v3-turbo`)** server-side fallback for restricted network environments
- **OpenAI Whisper** as a final STT safety net
- **Force-server STT mode** (`VITE_FORCE_SERVER_STT=true`) for always-on accuracy
- Manual PCM audio capture → base64 → `/session/transcribe` pipeline for environments that block the Web Speech API

### 🗣️ TTS + Lip-Sync Stack
- **ElevenLabs aligned TTS** — provides per-phoneme timestamps for frame-accurate viseme animation
- **Groq TTS** (`playai-tts` voices) + text-derived synthetic viseme fallback
- **Sentence-buffered streaming** — LLM output is chunked sentence-by-sentence to minimize first-audio latency
- **Rhubarb-style viseme mapping** — 15 phoneme groups → ARKit morph targets (jawOpen, mouthSmile, etc.)
- **Idle + gesture animation** — avatars breathe, blink, and shift weight between physician turns

### 🧑‍⚕️ 3D Avatar System
- **React Three Fiber** + **Three.js** rendering with full morph target animation
- **Ready Player Me** GLB avatar support — with a **server-side proxy** (`/assets/rpm/:id.glb`) to bypass browser network blocks
- **Local GLB upload** via the Lip-Sync Diagnostics panel
- **5 pre-configured physician personas** with distinct specialties, moods, and compliance postures
- Avatar URL correctly flows from `personas.json` → `avatarStore` → `AvatarModel` (fixed rendering regression)

### 🏥 AI Physician Personas

| Persona | Specialty | Mood | Compliance Mode |
|---|---|---|---|
| Dr. Sarah Chen | Oncology | Skeptical | ✅ MLR Enabled |
| Dr. Raj Patel | Cardiology | Neutral | ✅ MLR Enabled |
| Dr. Linda Williams | General Practice | Engaged | — |
| Dr. Ji-Yeon Kim | Rheumatology | Concerned | ✅ MLR Enabled |
| Dr. Miguel Rodriguez | Hospital Medicine | Positive | — |

### 📊 Post-Call Scorecard
- Automatically triggers at session end
- Grades: **clinical data accuracy**, **objection handling**, **safety messaging**, **dosing accuracy**, **compliance language**
- Animated score ring + per-criterion checklist
- Claude Sonnet used as scorecard evaluator for nuanced judgment

### 🛠️ Developer Tools
- **Latency HUD** — live pipeline timing: LLM first-token, TTS start, total round-trip
- **Lip-Sync Diagnostics panel** — viseme source, morph coverage %, playback latency, GLB upload
- **Speaking Waveform** visualizer during AI audio playback
- **Text input fallback** for non-voice environments
- **Theme toggle** (dark / light)
- **MLR Guardrail mode** — restricts AI to approved label language only

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Browser (React 18 + Vite)                 │
│                                                              │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ VoiceInput   │  │  AvatarCanvas  │  │   ScoreCard     │  │
│  │ (VAD + STT)  │  │  (R3F + GLB)   │  │  (post-call)    │  │
│  └──────┬───────┘  └───────┬────────┘  └────────┬────────┘  │
│         │   sessionStore   │  avatarStore        │           │
│         └──────────────────┴─────────────────────┘           │
└───────────────────────┬─────────────────────────────────────┘
                        │ WebSocket (ws://) + HTTP
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              Node.js + Express + ws (TypeScript)             │
│                                                              │
│  LLM Stream      Groq Llama 3.3 70B → Claude Sonnet fallback │
│  TTS Pipeline    ElevenLabs → Groq TTS → viseme synthesis    │
│  STT Pipeline    Groq Whisper → OpenAI Whisper fallback      │
│  Session WS      streaming audio chunks + viseme events      │
│  Asset Proxy     RPM GLB proxy, local GLB upload             │
└─────────────────────────────────────────────────────────────┘
```

---

## Quickstart

### Prerequisites

- **Node.js 20+**
- At minimum: `GROQ_API_KEY` *(enables LLM + TTS + STT)*
- Optional: `ELEVENLABS_API_KEY` *(best lip-sync quality)*, `ANTHROPIC_API_KEY` *(Claude fallback + scorecard)*, `OPENAI_API_KEY` *(Whisper fallback)*

### 1. Backend

```bash
cd server
cp .env.example .env        # fill in GROQ_API_KEY at minimum
npm install
npm run dev                  # starts on http://localhost:3001
```

### 2. Frontend

```bash
cd client
cp .env.example .env
npm install
npm run dev                  # starts on http://localhost:5173
```

Open **`http://localhost:5173`**, pick a persona, and start talking.

---

## Configuration Reference

### `server/.env`

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Primary LLM + TTS + Whisper STT |
| `ANTHROPIC_API_KEY` | Claude Sonnet fallback (LLM + scorecard) |
| `ELEVENLABS_API_KEY` | Highest-quality TTS + phoneme timestamps |
| `ELEVENLABS_DEFAULT_VOICE_ID` | Fallback voice ID when persona has none |
| `OPENAI_API_KEY` | Whisper fallback if Groq STT unavailable |
| `GROQ_STT_MODEL` | Default: `whisper-large-v3-turbo` |
| `PERSONAS_PATH` | Override default persona JSON path |
| `PORT` | Default: `3001` |

### `client/.env`

| Variable | Description |
|---|---|
| `VITE_WS_URL` | WebSocket endpoint (`ws://localhost:3001`) |
| `VITE_API_URL` | REST base for `/session/transcribe` |
| `VITE_HTTP_SERVER_URL` | Server base for avatar proxy |
| `VITE_RPM_USE_PROXY` | `false` to bypass server proxy |
| `VITE_FORCE_SERVER_STT` | `true` to always use Groq Whisper |
| `VITE_DEFAULT_AVATAR_GLB` | Fallback avatar GLB URL |

---

## Personas & Avatars

Persona configs live in **both** `client/src/config/personas.json` and `server/src/config/personas.json` (keep in sync, or point `PERSONAS_PATH` at a shared file).

Each persona defines: `name`, `specialty`, `systemPrompt`, `voiceId`, `avatarUrl`, `complianceMode`, and `mood`.

**Avatar options:**
- `avatarUrl: "/avatars/<name>.glb"` — serve a local GLB from `client/public/avatars/`
- `avatarUrl: "<Ready Player Me URL>"` — fetched through the server proxy to avoid CORS blocks
- Upload a custom GLB via **Diagnostics → Upload .glb** at runtime

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Service health check |
| `/session/transcribe` | POST | Audio blob → text (Groq Whisper → OpenAI) |
| `/assets/upload-avatar` | POST | Upload `.glb` to `/avatars/uploaded-avatar.glb` |
| `/assets/rpm/:id.glb` | GET | Ready Player Me reverse proxy |
| `ws://localhost:3001` | WS | Session lifecycle + streaming audio + visemes |

---

## Docker (backend)

```bash
cp server/.env.example server/.env
# add GROQ_API_KEY

docker compose up --build
```

The client runs separately via `npm run dev` (or build static assets and serve them yourself).

---

## Known Limitations

- Audio is base64-encoded in JSON WebSocket frames — portable but not bandwidth-optimal
- No session persistence — transcripts and scores are in-memory only
- MuseTalk video-frame streaming bridge is implemented but **disabled by default** (`museTalkService.ts`)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| 3D Rendering | React Three Fiber, Three.js, @react-three/drei |
| State | Zustand (`sessionStore`, `avatarStore`) |
| Backend | Node.js, Express, `ws` (WebSocket) |
| LLM | Groq Llama 3.3 70B, Anthropic Claude Sonnet |
| TTS | ElevenLabs, Groq TTS (playai-tts) |
| STT | Groq Whisper, OpenAI Whisper, Web Speech API |
| Avatars | Ready Player Me, local GLB |
| Infra | Docker, docker-compose |

---

## License

MIT © 2026 Proxim

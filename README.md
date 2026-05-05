# Proxim

Proxim is a browser-based training lab where pharmaceutical sales representatives rehearse live conversations with AI-simulated healthcare professionals. Each persona speaks with streamed dialogue via ElevenLabs (optional, best lip-sync) or Groq TTS, with viseme keyframes that drive a 3D avatar in Three.js, keeping voice and lip motion coupled for a face-to-face feel without native binary installs.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser (React + Vite)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  ┌─────────────┐ │
│  │ VoiceInput   │  │ WebSocket    │  │ Web Audio  │  │ R3F Avatar  │ │
│  │ Web Speech + │─▶│ useWebSocket │─▶│ playback + │─▶│ morph + idle│ │
│  │ silence 1.5s │  │              │  │ viseme sync│  │ blink + sway│ │
│  └──────────────┘  └──────┬───────┘  └────────────┘  └─────────────┘ │
└───────────────────────────┼──────────────────────────────────────────┘
                            │ ws:// + http://
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Node.js + Express + ws (TypeScript)                  │
│  user_input ─▶ Claude Sonnet stream ─▶ sentence buffer              │
│              ─▶ ElevenLabs with-timestamps or Groq TTS (WAV)         │
│                  (text-viseme fallback when alignment unavailable)    │
│              ─▶ { audio_chunk + visemes } frames over WebSocket      │
└─────────────────────────────────────────────────────────────────────┘
```

## Repository layout

- `client/` — React 18, TypeScript, Vite, Tailwind, Zustand, React Three Fiber avatar renderer.
- `server/` — Express HTTP + WebSocket server, Groq/Anthropic LLM, ElevenLabs or Groq TTS, and alignment or text-based lip-sync.
- `Dockerfile.server` + `docker-compose.yml` — containerized backend (no native binaries required).

## Prerequisites

- Node.js 20+
- **Recommended minimum:** `GROQ_API_KEY` — free tier covers the LLM, persona TTS (WAV), and Whisper transcription on `/session/transcribe` when the browser cannot use Web Speech (VPN/proxy, some browsers, tap-to-speak).
- **Optional:** `ANTHROPIC_API_KEY` — used for Claude when `GROQ_API_KEY` is not set.
- **Optional:** `ELEVENLABS_API_KEY` — higher-quality TTS and audio-aligned visemes; omit it to use Groq TTS only (persona `voiceId` values remain ElevenLabs IDs for reference but Groq uses its own voice preset).
- **Optional:** `OPENAI_API_KEY` — Whisper on `/session/transcribe` if you prefer OpenAI over Groq for audio transcription.

## Setup

```bash
git clone <your-repo-url> proxim
cd proxim

# Server
cd server
cp .env.example .env
# Minimum: set GROQ_API_KEY (or ANTHROPIC_API_KEY + either GROQ_API_KEY or OPENAI_API_KEY for VPN-safe transcription)
npm install
npm run dev

# Client (new terminal)
cd ../client
cp .env.example .env
npm install
npm run dev
```

Defaults:

- Client Vite dev server: `http://localhost:5173`
- Backend HTTP + WS: `http://localhost:3001` / `ws://localhost:3001`

## Docker (backend only)

```bash
cp server/.env.example server/.env
# Populate at least GROQ_API_KEY (or your chosen LLM + transcription keys — see server/.env.example)
docker compose up --build
```

The UI still runs via `npm run dev` inside `client/` unless you also build static assets and serve them separately.

## Personas

Three HCP personas are pre-configured in `personas.json`:

| ID | Name | Specialty | ElevenLabs voice |
|----|------|-----------|-----------------|
| `dr_chen` | Dr. Sarah Chen | Cardiologist | Rachel (`21m00Tcm4TlvDq8ikWAM`) |
| `dr_martinez` | Dr. Elena Martinez | Medical Oncologist | Bella (`EXAVITQu4vr4xnSDxMaL`) |
| `dr_okonkwo` | Dr. James Okonkwo | General Practitioner | Antoni (`ErXwobaYiN019PkySvjV`) |

All three use distinct Ready Player Me GLBs loaded via HTTPS — no local asset files needed.

## Adding a new persona

1. Add an entry to both `client/src/config/personas.json` and `server/src/config/personas.json`
   (or use `PERSONAS_PATH` on the server to point at a single file).
2. Fill in `id`, clinical metadata, `voiceId` (from your ElevenLabs dashboard),
   `avatarUrl` (an HTTPS Ready Player Me GLB URL with `?morphTargets=ARKit,Oculus%20Visemes`),
   and a rich `systemPrompt`.
3. Restart the server so persona definitions reload.

## Known limitations

- **Binary WebSocket frames**: audio is base64-encoded inside JSON for portability; high-throughput deployments should switch to length-prefixed binary frames.
- **Sentence-first TTS**: the server buffers model output into speakable sentences (punctuation or ~220 chars) before ElevenLabs runs; this trades a little latency for stable sync windows.
- **Whisper fallback**: `POST /session/transcribe` uses **Groq** (`GROQ_API_KEY`) or **OpenAI** (`OPENAI_API_KEY`) when Web Speech is unavailable (VPN, Firefox, MediaRecorder path). The client splits mic audio on **silence** (~1.5s) and sends each clip automatically. Set `VITE_FORCE_SERVER_STT=true` in `client/.env` to skip Web Speech entirely (recommended on VPN).
- **Emotion blend shapes**: RPM models expose standard visemes; custom `emotion_*` morphs may be absent on some assets — weights then simply no-op.
- **Mobile Safari**: Web Speech support varies; tap-to-speak + Whisper is the safest fallback.

## Third-party APIs

- [Anthropic](https://www.anthropic.com/) — Claude API (see Anthropic Terms of Service).
- [ElevenLabs](https://elevenlabs.io/) — Text-to-speech streaming (see ElevenLabs Terms).
- [Groq](https://groq.com/) — Optional LLM, TTS, and Whisper-style transcription APIs.
- [OpenAI](https://openai.com/) — Optional Whisper transcription.
- [Ready Player Me](https://readyplayer.me/) — Avatar GLB models served via CDN.

## License

MIT

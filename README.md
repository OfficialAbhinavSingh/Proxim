# Proxim

Proxim is a browser-based training lab where pharmaceutical sales representatives rehearse live conversations with AI-simulated healthcare professionals. Each persona speaks with streamed dialogue, ElevenLabs speech, and timestamp/alignment-derived viseme keyframes that drive a 3D avatar in Three.js, keeping voice and lip motion tightly coupled for a face-to-face feel without native binary installs.

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
│              ─▶ ElevenLabs with-timestamps (audio + alignment)       │
│                  (text-viseme fallback if alignment unavailable)      │
│              ─▶ { audio_chunk + visemes } frames over WebSocket      │
└─────────────────────────────────────────────────────────────────────┘
```

## Repository layout

- `client/` — React 18, TypeScript, Vite, Tailwind, Zustand, React Three Fiber avatar renderer.
- `server/` — Express HTTP + WebSocket server, Groq/Anthropic + ElevenLabs + alignment-based lip-sync.
- `Dockerfile.server` + `docker-compose.yml` — containerized backend (no native binaries required).

## Prerequisites

- Node.js 20+
- Anthropic API key (`ANTHROPIC_API_KEY`)
- ElevenLabs API key (`ELEVENLABS_API_KEY`) — voice IDs are pre-configured in `personas.json`
- Optional: `OPENAI_API_KEY` for Whisper transcription when Web Speech API is unavailable

## Setup

```bash
git clone <your-repo-url> proxim
cd proxim

# Server
cd server
cp .env.example .env
# Minimum: fill in ANTHROPIC_API_KEY and ELEVENLABS_API_KEY
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
# Populate ANTHROPIC_API_KEY and ELEVENLABS_API_KEY
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
- **Whisper fallback**: requires `OPENAI_API_KEY` and is only used when Web Speech API / MediaRecorder path hits `/session/transcribe`.
- **Emotion blend shapes**: RPM models expose standard visemes; custom `emotion_*` morphs may be absent on some assets — weights then simply no-op.
- **Mobile Safari**: Web Speech support varies; tap-to-speak + Whisper is the safest fallback.

## Third-party APIs

- [Anthropic](https://www.anthropic.com/) — Claude API (see Anthropic Terms of Service).
- [ElevenLabs](https://elevenlabs.io/) — Text-to-speech streaming (see ElevenLabs Terms).
- [OpenAI](https://openai.com/) — Optional Whisper transcription.
- [Ready Player Me](https://readyplayer.me/) — Avatar GLB models served via CDN.

## License

MIT

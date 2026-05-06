# Proxim

Proxim is a browser-based training lab where pharmaceutical sales reps rehearse live conversations with AI-simulated healthcare professionals. It streams LLM responses, drives a 3D avatar with lip-sync visemes, and keeps audio + facial motion tightly aligned — no native installs required.

## Highlights

- **Real-time roleplay** with streaming AI physician responses and emotion tags.
- **Voice-first practice** via Web Speech API with automatic silence detection and a server-side Whisper fallback.
- **Lip-sync pipeline**: ElevenLabs alignment when available → Groq TTS + text-derived visemes → silence + Web Speech fallback.
- **3D avatars in Three.js** with Ready Player Me proxy support and local GLB upload.
- **Call debrief** scorecard with coaching metrics after each session.
- **Latency HUD + diagnostics** for tuning LLM/TTS response time and viseme coverage.

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│                          Browser (React + Vite)                        │
│  Voice input (Web Speech / PCM → Whisper)                              │
│  WebSocket session + transcript stream                                 │
│  Web Audio playback + viseme timeline                                  │
│  React Three Fiber avatar (morphs, idle, gestures)                      │
└───────────────────────────────────────────────────────────────────────┘
                             │ ws:// + http://
                             ▼
┌───────────────────────────────────────────────────────────────────────┐
│                 Node.js + Express + ws (TypeScript)                    │
│  LLM stream (Groq Llama 3.3 → Claude fallback)                          │
│  Sentence buffer → TTS → visemes → audio chunks over WS                │
│  /session/transcribe (Groq Whisper → OpenAI fallback)                   │
└───────────────────────────────────────────────────────────────────────┘
```

## Repository layout

- `client/` — React 18 + Vite + Tailwind UI, WebSocket client, Web Audio playback, Three.js avatar.
- `server/` — Express HTTP + WebSocket server, LLM/TTS/STT orchestration, persona config.
- `Dockerfile.server` + `docker-compose.yml` — containerized backend (server only).

## Quickstart (local)

### Prerequisites

- Node.js 20+
- **Recommended minimum:** `GROQ_API_KEY` (enables LLM, Groq TTS, and Groq Whisper STT)
- **Optional:** `ANTHROPIC_API_KEY` (Claude fallback), `ELEVENLABS_API_KEY` (best lip-sync), `OPENAI_API_KEY` (Whisper fallback)

### Run the backend

```bash
cd server
cp .env.example .env
# Set GROQ_API_KEY (or ANTHROPIC_API_KEY + OPENAI_API_KEY)
npm install
npm run dev
```

### Run the client

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Defaults:

- Client: `http://localhost:5173`
- Server HTTP + WS: `http://localhost:3001` / `ws://localhost:3001`

## Configuration

### Server (`server/.env`)

- `GROQ_API_KEY` — preferred LLM + TTS + Whisper STT provider
- `ANTHROPIC_API_KEY` — Claude Sonnet fallback if Groq is not set
- `ELEVENLABS_API_KEY` — highest-quality TTS + alignment timestamps
- `ELEVENLABS_DEFAULT_VOICE_ID` — default voice if a persona is missing `voiceId`
- `OPENAI_API_KEY` — Whisper fallback if Groq is unavailable
- `GROQ_STT_MODEL` — default `whisper-large-v3-turbo`
- `PERSONAS_PATH` — optional override for persona JSON
- `PORT` — default `3001`

### Client (`client/.env`)

- `VITE_WS_URL` — WebSocket endpoint (default `ws://localhost:3001`)
- `VITE_API_URL` — REST base for `/session/transcribe`
- `VITE_HTTP_SERVER_URL` — server base for `/assets/rpm` avatar proxy
- `VITE_RPM_USE_PROXY` — set `false` to bypass the proxy and hit Ready Player Me directly
- `VITE_RPM_USE_VITE_DEV_PROXY` — dev-only RPM proxy via Vite `/__rpm`
- `VITE_FORCE_SERVER_STT` — set `true` to always use server Whisper
- `VITE_DEFAULT_AVATAR_GLB` — override the fallback Ready Player Me avatar URL

## Personas & avatars

Personas are defined in **both** `client/src/config/personas.json` and `server/src/config/personas.json`.
Keep them in sync or use `PERSONAS_PATH` on the server.

| ID | Name | Specialty | Mood | Compliance Mode |
|---|---|---|---|---|
| `dr_chen_oncologist` | Dr. Sarah Chen | Oncology | Skeptical | ✅ |
| `dr_patel_cardiologist` | Dr. Raj Patel | Cardiology | Neutral | ✅ |
| `dr_williams_gp` | Dr. Linda Williams | General Practice | Engaged | ❌ |
| `dr_kim_rheumatologist` | Dr. Ji-Yeon Kim | Rheumatology | Concerned | ✅ |
| `dr_rodriguez_hospitalist` | Dr. Miguel Rodriguez | Hospital Medicine | Positive | ❌ |

### Avatar sources

- Current persona configs point at `/avatars/*.glb` (served from `client/public/avatars`).
- If you don’t have local GLBs, either:
  - Replace `avatarUrl` with a Ready Player Me URL, or
  - Upload a GLB from **Lip-sync diagnostics → Upload .glb**, which stores it in `/avatars/`.
- The server also provides a Ready Player Me proxy at `GET /assets/rpm/:id.glb` to avoid browser network blocks.

## Runtime features

- **Live transcript + call log** while the LLM streams.
- **Latency HUD** showing server pipeline timing (LLM first token, TTS start, total).
- **Lip-sync diagnostics** (viseme source, morph coverage, playback latency, GLB upload).
- **Scorecard debrief** after each session (clinical data, objections, safety, dosing, compliance).

## API surface

- `GET /health` — service health check
- `POST /session/transcribe` — audio → text (Groq Whisper → OpenAI fallback)
- `POST /assets/upload-avatar` — upload a local `.glb` for `/avatars/uploaded-avatar.glb`
- `GET /assets/rpm/:id.glb` — Ready Player Me proxy (preserves query params)
- WebSocket: `ws://localhost:3001` — session start/end + streaming audio chunks

## Docker (backend only)

```bash
cp server/.env.example server/.env
# Populate at least GROQ_API_KEY

docker compose up --build
```

The client still runs via `npm run dev` unless you build and serve the static assets yourself.

## Known limitations

- Audio chunks are base64-encoded inside JSON frames (portable, not bandwidth-optimal).
- TTS is buffered sentence-by-sentence to reduce jitter and improve lip-sync.
- No persistence: sessions and transcripts are in-memory only.

## Third-party APIs

- [Groq](https://groq.com/) — LLM, TTS, Whisper STT
- [Anthropic](https://www.anthropic.com/) — Claude Sonnet fallback
- [ElevenLabs](https://elevenlabs.io/) — aligned TTS + viseme timestamps
- [OpenAI](https://openai.com/) — Whisper fallback
- [Ready Player Me](https://readyplayer.me/) — avatar GLB hosting

## License

MIT

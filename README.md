# Proxim

Proxim is a browser-based training lab where pharmaceutical sales representatives rehearse live conversations with AI-simulated healthcare professionals. Each persona speaks with streamed Claude dialogue, ElevenLabs speech, and Rhubarb-derived viseme keyframes that drive a Ready Player Me style 3D avatar in Three.js, keeping voice and lip motion tightly coupled for a face-to-face feel without installing native desktop software.

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
│              ─▶ ElevenLabs PCM stream ─▶ WAV ─▶ Rhubarb CLI         │
│                  (phoneme synthesizer fallback if Rhubarb absent)    │
│              ─▶ { audio_chunk + visemes } frames over WebSocket      │
└─────────────────────────────────────────────────────────────────────┘
```

## Repository layout

- `client/` — React 18, TypeScript, Vite, Tailwind, Zustand, React Three Fiber avatar renderer.
- `server/` — Express HTTP + WebSocket server, Anthropic + ElevenLabs + Rhubarb pipeline.
- `Dockerfile.server` + `docker-compose.yml` — containerized backend with Rhubarb binary.
- `scripts/install-rhubarb-windows.ps1` — one-shot Rhubarb installer for Windows dev machines.

## Prerequisites

- Node.js 20+
- Anthropic API key (`ANTHROPIC_API_KEY`)
- ElevenLabs API key (`ELEVENLABS_API_KEY`) — voice IDs are pre-configured in `personas.json`
- **Rhubarb is optional** — if the binary is absent the server falls back to a phoneme-based
  viseme synthesizer that keeps lips moving for every sentence. Install Rhubarb for production-quality sync.
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

### Installing Rhubarb (optional but recommended)

**Docker** — Rhubarb is installed automatically in `Dockerfile.server`.

**Linux / macOS**:
```bash
# Download the appropriate release from:
# https://github.com/DanielSWolf/rhubarb-lip-sync/releases
chmod +x rhubarb
sudo mv rhubarb /usr/local/bin/
# Then in server/.env:  RHUBARB_PATH=/usr/local/bin/rhubarb
```

**Windows**:
```powershell
# Installs to C:\rhubarb\rhubarb.exe and prints the RHUBARB_PATH line to add to .env
powershell -ExecutionPolicy Bypass -File scripts\install-rhubarb-windows.ps1
```

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
- **Sentence-first TTS**: the server buffers Claude output into speakable sentences (punctuation or ~220 chars) before ElevenLabs + Rhubarb run; this trades a little latency for reliable lip-sync windows.
- **Whisper fallback**: requires `OPENAI_API_KEY` and is only used when Web Speech API / MediaRecorder path hits `/session/transcribe`.
- **Emotion blend shapes**: RPM models expose standard visemes; custom `emotion_*` morphs may be absent on some assets — weights then simply no-op.
- **Mobile Safari**: Web Speech support varies; tap-to-speak + Whisper is the safest fallback.

## Third-party APIs

- [Anthropic](https://www.anthropic.com/) — Claude API (see Anthropic Terms of Service).
- [ElevenLabs](https://elevenlabs.io/) — Text-to-speech streaming (see ElevenLabs Terms).
- [OpenAI](https://openai.com/) — Optional Whisper transcription.
- [Rhubarb Lip Sync](https://github.com/DanielSWolf/rhubarb-lip-sync) — GPL-3.0 licensed CLI used server-side for viseme timing. Usage is server-side only; the Rhubarb binary is not distributed with this repository.
- [Ready Player Me](https://readyplayer.me/) — Avatar GLB models served via CDN.

## License

MIT

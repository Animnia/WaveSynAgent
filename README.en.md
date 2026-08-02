# WaveSynAgent

**🌐 Live Demo: <https://wavesynagent.metagaruta.com>**

**English** | [中文](README.md)

**Web Wavetable Synthesizer + AI Agent System** — play and sculpt sounds in your browser, with an AI assistant that designs patches for you.

The core innovation: a built-in **ReAct-style AI Agent** that understands natural-language descriptions like "warm pad" or "heavy bass", then autonomously drives the synthesizer — tweaking parameters, auditioning the result, and saving presets — while acting as both producer and music teacher.

## Features

### 🎹 Synthesizer
- **3 oscillators**: sine / triangle / sawtooth / square, with unison (1–8 voices), semitone/fine tuning, and pan
- **Filter**: lowpass / highpass / bandpass / notch with cutoff, resonance, envelope amount, and key tracking
- **Dual ADSR envelopes**: independent amp and filter envelopes
- **Dual LFOs + mod matrix**: bipolar depth (−1 to 1), routable to filter, volume, effects, and more
- **9 effects**: Distortion, BitCrusher, Compressor, EQ3, Chorus, Phaser, Delay, Reverb, StereoWidener — with a **freely reorderable effect chain**
- **16-voice polyphony**, virtual keyboard, live oscilloscope + FFT spectrum analyzer

### 🤖 AI Agent
- Natural-language sound design: describe a target tone and the Agent plans and executes multi-step parameter changes
- Synth toolset: `read_synth_state`, `set_oscillator`, `set_filter`, `set_envelope`, `set_lfo`, `set_effects`, `set_mod_route`, `reorder_effect_chain`, `play_notes`, `save_preset`
- Explains its reasoning and music theory as it works; can instantly audition changes via `play_notes` (chord or sequence mode)
- Multi-session management, visible thinking steps and action history, streaming responses
- Safety guardrails: parameter range validation, tool-call budgets, user edits take priority

### 🔌 Multi-LLM Support
A unified abstraction layer — switch between **OpenAI / Anthropic Claude / DeepSeek / Alibaba DashScope (Bailian)** with a single config change.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite + TailwindCSS 4 + Zustand |
| Audio engine | Tone.js + Web Audio API |
| AI Agent | Python 3.11+ + FastAPI (streaming over WebSocket) |
| Backend API | Node.js + Fastify + Prisma + PostgreSQL (JWT auth) |
| Deployment | GitHub Actions + Cloudflare + nginx + systemd |

## Project Structure

```
WaveSynAgent/
├── packages/
│   ├── frontend/          # React frontend (synth workstation + Agent panel)
│   │   └── src/
│   │       ├── engine/        # AudioEngine (Tone.js wrapper), types, presets
│   │       ├── components/    # Knob/keyboard/panels/Agent chat panel
│   │       ├── stores/        # Zustand: synth / agent / preset
│   │       └── visualizers/   # Oscilloscope, spectrum analyzer
│   ├── api-server/        # Fastify + Prisma: users/presets/projects CRUD, JWT, WebSocket
│   └── agent-server/      # FastAPI: ReAct agent core, toolset, LLM abstraction
├── deploy/                # nginx / systemd / deploy scripts (gitignored, see deploy/README.md)
└── .github/workflows/     # Auto-deploy on push to main/master
```

## Quick Start

**Requirements**: Node.js 20+, pnpm 10, Python 3.11+ (uv recommended), PostgreSQL (only for api-server)

```bash
# 1. Install dependencies
pnpm install
cd packages/agent-server && uv sync   # or: pip install -e .

# 2. Configure environment
cp .env.example .env
# Fill in at least one LLM API key (e.g. DEEPSEEK_API_KEY)

# 3. Start dev servers
pnpm dev              # start everything in parallel
# or individually:
pnpm dev:frontend     # frontend     → http://localhost:5173
pnpm dev:api          # API server   → http://localhost:3001
pnpm dev:agent        # Agent server → http://localhost:8000
```

> Minimal setup: **frontend + agent-server** is all you need — open the page, play the synth, and open the Agent panel in the corner to start designing sounds by chat. The api-server (accounts / cloud presets) is optional.

## Deployment

Production deploys are automated via GitHub Actions: pushing to `main`/`master` builds the frontend, rsyncs artifacts to the server, and nginx serves the static files behind Cloudflare while reverse-proxying `/agent-api/*` to the FastAPI service (managed by systemd).

Live at **<https://wavesynagent.metagaruta.com>**. Full runbook (server bootstrap, Secrets, ops commands): `deploy/README.md` (maintained locally, not tracked in git).

## License

ISC

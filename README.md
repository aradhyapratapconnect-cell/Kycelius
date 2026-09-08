# Kyclius

> [!WARNING]
> ## 🚧 Project Shelved / Archived — Incomplete
>
> **This app is NOT completed and is no longer being actively developed or maintained.**
>
> This project has been **shelved / archived due to increasing complexity** and is not intended to be used or changed further by the original author.
>
> Anyone out there is **free to fork it, use it for themselves, and change it according to their own needs.** Feel free to take this codebase as a starting point for your own project.
>
> Thank you to everyone who checked it out.

**A free, open-source, local-first AI desktop assistant you talk to out loud.**

Say "write an email," "open VS Code," "summarize this file" — Kyclius reasons with an LLM, speaks its answer back, and takes real actions on your OS.

![Screenshot placeholder](docs/screenshot.png)

## Features

- **Voice-first interaction** — talk to Kyclius naturally; typed input available as fallback
- **Voice responses** — Kyclius speaks answers back, not just text
- **BYOK (Bring Your Own Key)** — works with free-tier Groq and OpenRouter API keys, no subscription required
- **Tool execution** — open apps, create files, send emails, run shell commands, interact with GitHub
- **Permission system** — safe actions run automatically; risky actions ask for confirmation (voice or click)
- **Q&A Dashboard** — browsable log of every question asked and answer given
- **Local memory** — remembers your preferences in a local SQLite database
- **Wake word listening** — "Hey Kyclius" triggers the assistant even when the window is hidden
- **Voice biometrics** — recognizes your voice for gated commands
- **Autonomous Mode** — opt-in multi-step task execution with per-tool risk controls
- **Cross-platform** — runs on Windows, macOS, and Linux

## Getting API Keys (Free)

Kyclius uses a Bring Your Own Key model. You need one API key from a supported provider:

### Groq (recommended for speed)

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up / log in
3. Navigate to **API Keys** and create a new key
4. Copy the key and paste it into Kyclius Settings under **LLM Provider**

### OpenRouter (wider model selection)

1. Go to [openrouter.ai](https://openrouter.ai)
2. Sign up / log in
3. Navigate to **Keys** and create a new key
4. Copy the key and paste it into Kyclius Settings under **LLM Provider**

Both providers offer generous free tiers that are sufficient for daily use.

## Install from Release

Download the latest installer for your OS from [GitHub Releases](https://github.com/kyclius/kyclius/releases):

| OS | Format |
|---|---|
| Windows | `.exe` (NSIS installer) |
| macOS | `.dmg` |
| Linux | `.AppImage` or `.deb` |

## Build from Source

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or later
- npm (comes with Node.js)

### Setup

```bash
git clone https://github.com/kyclius/kyclius.git
cd kyclius
npm install
```

### Development

```bash
npm run electron:dev
```

This starts the Vite dev server with hot reload and launches the Electron window.

### Run Tests

```bash
npm test
```

### Lint & Typecheck

```bash
npm run lint
npx tsc --noEmit
```

### Build Installers

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Installers are output to `dist-electron/`.

## Voice Model (Auto-Downloaded)

Kyclius uses [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) for natural-sounding text-to-speech. On first launch, the app automatically downloads the ONNX model (~92 MB) from HuggingFace — no manual setup required.

The model is stored in your app data directory and licensed under [Apache-2.0](https://huggingface.co/onnx-community/Kokoro-82M-ONNX/blob/main/LICENSE). If you prefer to use a custom model or voice, you can override the paths in **Settings → Text-to-Speech Model**.

Available voices: American Female (default), Bella, Nicole, Sarah, Sky, Adam, Michael, Emma, Isabella, George, Lewis.

## Tech Stack

- [Electron](https://www.electronjs.org/) — cross-platform desktop shell
- [React](https://react.dev/) + [Vite](https://vitejs.dev/) — renderer UI
- [TypeScript](https://www.typescriptlang.org/) — type-safe codebase
- [SQLite](https://www.sqlite.org/) (via better-sqlite3) — local data storage
- [whisper.cpp](https://github.com/ggerganov/whisper.cpp) — local speech-to-text
- [Kokoro-82M](https://github.com/hexgrad/kokoro) — local text-to-speech (ONNX)
- [Zustand](https://github.com/pmndrs/zustand) — state management

## Project Structure

```
kyclius/
├── src/
│   ├── main/           # Electron main process (IPC, voice, tools, LLM, DB)
│   ├── preload/        # Context bridge between main and renderer
│   ├── renderer/       # React UI (chat, dashboard, settings, 3D blob)
│   └── shared/         # Shared types and IPC contract
├── docs/               # Spec documents (PRD, architecture, security, etc.)
├── build/              # Electron-builder resources (icons, entitlements)
├── .github/workflows/  # CI and release automation
└── electron-builder.yml
```

## Documentation

- [Product Requirements Document](docs/RRD.md)
- [Technical Architecture](docs/Technical%20Architecture.md)
- [Security & Access Model](docs/Security%20access.md)
- [Frontend Specification](docs/Frontend%20spec.md)
- [Feature Tickets](docs/Feature%20Ticket.md)
- [Agent & Tool Execution Spec](docs/Agent%20tool%20execution%20Spec.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on submitting issues and pull requests.

## License

[MIT](LICENSE)

# Contributing to Kyclius

Thanks for your interest in contributing! This document covers the basics.

## Getting Started

1. Fork the repository and clone your fork
2. Install dependencies: `npm install`
3. Start the dev build: `npm run electron:dev`
4. Create a branch for your change: `git checkout -b feature/my-change`

## Development Workflow

### Before Submitting

Run the full check suite to make sure your change doesn't break anything:

```bash
npm run lint
npx tsc --noEmit
npm test
```

All three must pass before submitting a PR.

### Code Style

- TypeScript is used throughout — no plain `.js` files in `src/`
- The project uses ESLint with `@typescript-eslint` — run `npm run lint` and fix any warnings
- Prettier handles formatting — run `npm run format` if needed
- Follow existing patterns in the surrounding code when adding new files

### Commit Messages

Use clear, descriptive commit messages. Prefer:

```
Add voice enrollment UI component

- 3-5 phrase guided enrollment flow
- Level meter for audio feedback
- Wire to speakerVerificationService
```

Avoid vague messages like "fix bug" or "update code."

## Pull Requests

### What to Include

- A clear description of what the PR does and why
- Reference any related issues (e.g., "Closes #42")
- Screenshots or GIFs for UI changes
- Make sure CI passes (lint, typecheck, tests)

### PR Expectations

- One logical change per PR — don't bundle unrelated fixes
- Keep PRs focused and reviewable (ideally under 500 lines of diff)
- Add or update tests when adding new functionality
- Update documentation if your change affects user-facing behavior

### Review Process

- A maintainer will review your PR and may request changes
- Address feedback by pushing new commits (don't force-push during review)
- Once approved, a maintainer will merge the PR

## Reporting Issues

Open a GitHub issue with:

- A clear title and description
- Steps to reproduce (for bugs)
- Expected vs actual behavior
- Your OS and Node.js version

## Project Structure

```
src/
├── main/        # Electron main process (Node.js)
├── preload/     # Context bridge (sandboxed)
├── renderer/    # React UI (browser)
└── shared/      # Shared types between processes
```

- **Main process** (`src/main/`) — IPC handlers, voice pipeline, tool execution, database, LLM integration
- **Preload** (`src/preload/`) — thin bridge exposing a typed API to the renderer
- **Renderer** (`src/renderer/`) — React components, 3D blob, settings panel, dashboard
- **Shared** (`src/shared/`) — IPC type contracts, enums, shared interfaces

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

# ForkMind

![ForkMind Banner](./banner.png)

> Break free from linear chats. Fork your thoughts.

[![Project Website](https://img.shields.io/badge/Website-ForkMind-0ea5e9)](https://malloymanga.github.io/ForkMind/)
![Architecture](https://img.shields.io/badge/Architecture-Local--First-22c55e)
![Tech Stack](https://img.shields.io/badge/Tech-Wails%20%7C%20React%20%7C%20Go-2563eb)
[![License](https://img.shields.io/badge/License-MIT-16a34a)](./LICENSE)

ForkMind is an open-source, local-first desktop application that turns linear AI conversations into a visual, branching workspace. It combines an infinite canvas with explicit parent and reference relationships, allowing users to explore side questions without losing the main line of thought.

Project website: [https://malloymanga.github.io/ForkMind/](https://malloymanga.github.io/ForkMind/)

## Why ForkMind?

Long AI conversations are difficult to navigate. A useful side question can pollute the main context, while returning to an earlier idea often requires scrolling through a large transcript.

ForkMind represents conversations as connected cards on an infinite canvas. Each follow-up can become its own branch, preserving the surrounding context while keeping unrelated branches isolated.

## Core Features

- **Infinite canvas**: Move, resize, connect, select, and organize conversation cards in a tldraw-powered workspace.
- **Branch-aware context**: A card inherits its parent chain without automatically including unrelated sibling branches.
- **Reference cards**: Attach additional cards as supporting context without changing the primary parent chain.
- **Selection follow-ups**: Select a specific passage and create a new question anchored to that text.
- **OpenAI-compatible providers**: Configure a Base URL, model, and API key for compatible chat-completions services.
- **Local-first persistence**: Store workspaces, conversations, and managed assets on the user's machine.
- **Portable JSON workflows**: Import, export, copy, and paste ForkMind canvas data using a documented JSON structure.
- **Extended card types**: Organize chat, note, image, link, and supported file content on the same canvas.
- **Streaming and cancellation**: Receive incremental AI responses and cancel active generation requests.

## Context Architecture

ForkMind keeps the conversation graph in a Zustand store and uses two explicit relationships:

- `parentId` defines the primary conversation chain.
- `referenceNodeIds` adds supporting material without changing that chain.

When a user sends a prompt, ForkMind performs the following flow:

1. Locate the active chat card.
2. Traverse `parentId` upward until the root card is reached.
3. Reverse the collected cards into chronological order.
4. Resolve and append the selected reference cards.
5. Add selection-anchor context when the question was created from highlighted text.
6. Inject ForkMind's system identity and send the final request through the Go network layer.
7. Stream the response back to the card stored in Zustand.

This design keeps the main context predictable while still allowing deliberate cross-branch references.

## Technology Stack

- **Desktop runtime**: [Wails v2](https://wails.io/) and Go
- **Frontend**: React 18, TypeScript, and Vite
- **Canvas**: [tldraw SDK](https://tldraw.dev/)
- **State management**: Zustand
- **UI**: Tailwind CSS and shadcn/ui conventions
- **AI transport**: OpenAI-compatible `/chat/completions` with SSE streaming
- **Persistence**: Local JSON workspace files and managed local assets

The React frontend acts similarly to an Electron renderer process, while the Go application layer provides the native bridge, filesystem access, persistence, and network transport.

## Privacy and Local-First Behavior

- ForkMind does not require a ForkMind account.
- Canvas and conversation data are stored in the `data/` directory beside the ForkMind executable.
- AI API keys are kept in runtime memory and are not written into workspace files.
- AI requests are sent only to the provider configured by the user.
- Images and files imported into a workspace are managed locally and deduplicated using SHA-256.
- Explicit exports may embed referenced assets into a portable JSON document.

## Requirements

- Node.js 20 or later
- npm 10 or later
- Go 1.23 or later
- Wails CLI v2
- A tldraw license key for production use
- NSIS when building a Windows installer

Install the Wails CLI if needed:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

## Development

Install dependencies:

```bash
go mod tidy
cd frontend
npm install
cd ..
```

Start the Wails development environment:

```bash
wails dev
```

Run the backend checks:

```bash
go test ./...
go vet ./...
```

Build the frontend independently:

```bash
cd frontend
npm run build
```

## Windows Production Build

The tldraw license key is a client-side production key. Provide it to Vite in the shell used for the build:

```bash
export VITE_TLDRAW_LICENSE_KEY='tldraw-your-license-key'
wails build -clean -platform windows/amd64 -nsis
```

The generated files are written to `build/bin/`:

- `ForkMind.exe` is the portable application executable.
- `ForkMind-amd64-installer.exe` is the Windows installer.

ForkMind stores `workspace.json`, conversation files, and managed assets under `<installation directory>/data/`. The installer provides a directory picker, so installing to a writable folder on another drive keeps both the application and its workspace data on that drive.

Development builds created by `wails dev` use `<project directory>/.forkmind-dev-data/` instead. This keeps development data separate from installed releases and prevents `wails build -clean` from deleting the development workspace.

## Project Status

ForkMind is preparing its first public Windows release. The main canvas, branching context, local persistence, OpenAI-compatible streaming, reference cards, supported file extraction, image context, provider configuration, clipboard import, and release packaging flows are implemented.

Future work will focus on broader file compatibility, provider-specific capabilities, deeper web-search integration, performance tuning, and release hardening.

## Licensing

ForkMind's original source code is released under the [MIT License](./LICENSE).

The tldraw SDK is a third-party dependency distributed under the [tldraw license](https://tldraw.dev/community/license). A valid trial, commercial, or hobby license key is required to use the tldraw SDK in production. Downstream users and distributors are responsible for complying with the applicable tldraw license terms.

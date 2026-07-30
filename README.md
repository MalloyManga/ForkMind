<div align="center">

# ForkMind

**A local-first AI infinite canvas for branching conversations and visual thinking.**

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![Website](https://img.shields.io/badge/Website-ForkMind-0ea5e9)](https://malloymanga.github.io/ForkMind/)
[![Release](https://img.shields.io/badge/Release-v0.1.0-2563eb)](https://github.com/MalloyManga/ForkMind/releases)
[![License](https://img.shields.io/badge/License-MIT-16a34a)](./LICENSE)
[![Wails](https://img.shields.io/badge/Wails-v2-cb3837)](https://wails.io/)

</div>

![ForkMind Banner](./banner.png)

ForkMind turns linear AI chats into a visual workspace of connected cards. Branch from any idea, attach references, and explore side questions without losing the main conversation context.

- Website: [malloymanga.github.io/ForkMind](https://malloymanga.github.io/ForkMind/)
- Releases: [github.com/MalloyManga/ForkMind/releases](https://github.com/MalloyManga/ForkMind/releases)

## Highlights

- **Infinite canvas** powered by tldraw for arranging, resizing, connecting, and selecting cards.
- **Branch-aware AI context** that follows the active card's parent chain without mixing sibling branches.
- **Reference relationships** for adding supporting cards without changing the primary conversation path.
- **Selection follow-ups** that preserve the selected text and its source card.
- **OpenAI-compatible providers** with model discovery, streaming responses, cancellation, and optional native web search.
- **Rich reference input** for supported documents, fetched URLs, and vision-capable image references.
- **Local-first storage** with portable JSON import, export, copy, and paste workflows.
- **Multiple card types** for chats, notes, images, links, and files.

## How Context Works

ForkMind keeps the conversation graph in Zustand and models context with two relationships:

- `parentId` defines the primary conversation chain.
- `referenceNodeIds` adds supporting material without changing that chain.

For each AI request, ForkMind traverses the active card's parent chain, resolves its reference cards and optional text selection, injects the internal system identity, and sends the assembled request through the Go network layer. Responses stream back into the same Zustand-managed card tree.

## Technology

| Layer | Technology |
| --- | --- |
| Desktop runtime | Wails v2 and Go |
| Frontend | React 18, TypeScript, and Vite |
| Canvas | tldraw SDK |
| State | Zustand |
| UI | Tailwind CSS and shadcn/ui conventions |
| AI transport | OpenAI-compatible APIs with SSE streaming |
| Persistence | Local JSON documents and managed assets |

The React frontend plays a role similar to an Electron renderer process. The Go layer provides the native bridge, filesystem access, persistence, document extraction, and AI network transport.

## Download

Download the latest Windows installer or portable executable from [GitHub Releases](https://github.com/MalloyManga/ForkMind/releases).

ForkMind currently targets Windows AMD64. Additional platforms may be added in future releases.

## Data and Privacy

ForkMind does not require an account or a ForkMind cloud service.

| Runtime | Data directory |
| --- | --- |
| Installed or portable release | `<application directory>/data/` |
| `wails dev` | `<project directory>/.forkmind-dev-data/` |

- Workspace and conversation data remain on the user's machine.
- API keys stay in runtime memory and are not written into workspace files.
- AI requests are sent only to the provider configured by the user.
- Managed files are stored locally and deduplicated with SHA-256.
- Explicit workspace exports can include referenced assets in a portable JSON document.

## Development

### Requirements

- Node.js 20 or later
- npm 10 or later
- Go 1.23 or later
- Wails CLI v2

Install Wails if needed:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Install project dependencies:

```bash
go mod tidy
cd frontend
npm install
cd ..
```

Start the desktop development environment:

```bash
wails dev
```

Run validation:

```bash
cd frontend
npm run build
cd ..

go test ./...
go test -tags dev ./...
go vet ./...
go vet -tags dev ./...
```

## Windows Build

Install [NSIS](https://nsis.sourceforge.io/) and provide a valid tldraw production license key in the build shell:

```bash
export VITE_TLDRAW_LICENSE_KEY='tldraw-your-license-key'
wails build -clean -platform windows/amd64 -nsis
```

Build artifacts are written to `build/bin/`:

- `ForkMind.exe`: portable executable.
- `ForkMind-amd64-installer.exe`: Windows installer.

The installer includes a directory picker. Installing ForkMind on another drive keeps both the application and its `data/` workspace on that drive.

## Contributing

Issues, feature proposals, documentation improvements, and pull requests are welcome. Before submitting a change:

1. Keep conversation state in Zustand and native side effects in the Go/Wails layer.
2. Add Go unit tests for new backend business logic.
3. Run the validation commands listed above.
4. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

## License

ForkMind's original source code is available under the [MIT License](./LICENSE).

The tldraw SDK is a third-party dependency distributed under the [tldraw license](https://tldraw.dev/community/license). Production use requires an appropriate trial, commercial, or hobby license key. Downstream users and distributors are responsible for complying with tldraw's terms.

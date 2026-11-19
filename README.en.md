# DROP-IT

English · [简体中文](README.md)

**One canvas to replace all your bookmarks. Save any content from any platform.**

DROP-IT is an infinite canvas for collecting text, images, web links and references to local files. Drop content onto the canvas, arrange and group it, connect related items, and save the workspace as a `.drop` file with its available local media.

## Features

- Collect pasted text, images and links, or drag in web content and local files. Text cards support Markdown.
- Turn web links into visual cards with titles, summaries and available covers.
- Pan, zoom, select, group, collapse and connect content through origin nodes and parent-child links.
- Navigate with full-text search, a minimap, an overview and numbered pins.
- Work in multiple board windows, save `.drop` files, and recover local drafts.
- Associate supported Windows screenshots with web pages or local source files.
- Use local OCR, image source recognition and the optional [Edge image source extension](extensions/edge-image-source/README.md).

“Any content” describes the goal of bringing collections together. Automatic parsing and source recognition depend on platform access, authentication, page restrictions and capture methods. Complete metadata is not guaranteed for every site or link; existing content and available links are retained when parsing fails.

## One-click launch (Windows 10/11 x64)

**Installer:** [Download Setup](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-Setup-0.1.1.exe) and open it. Setup prepares missing Windows components, installs for the current user, creates shortcuts, and opens the canvas automatically.

**Source:** [Download the source ZIP](https://github.com/lalala625k-ops/DROP-IT/archive/refs/heads/main.zip), extract it completely, and double-click **`Start-DropIt.bat`**. The first run prepares Python, Node.js, isolated dependencies and the frontend, then opens the app. Later runs reuse the environment and rebuild when source or dependency files change. No Git installation or manual commands are required.

**Portable application:** [Download the Portable ZIP](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-0.1.1-Portable.zip), extract it, and open `DropIt.exe`. Keep the backend executable and `bootstrap` folder beside it.

All three paths check WebView2, .NET Framework and the x64 VC++ runtime, using Microsoft's official installers when missing. Initial component downloads require internet access. Windows may require security confirmation, elevation or a restart. Failed downloads can be retried. Optional model credentials are not needed to start the app.

The source launcher uses Python 3.14.6 and Node.js 24.19.0 with verified downloads and hashed Python dependencies. An installed standard x64 CPython 3.14 with patch version 3.14.6 or later may be reused; Python packages live in a dedicated virtual environment. The global PATH is unchanged. See the [desktop guide](desktop/README.md) for details and logs.

## Common controls

| Action | Default control |
| --- | --- |
| Pan / zoom | Space + drag or middle-button drag / mouse wheel |
| New card / search | `Ctrl+N` / `Ctrl+K` |
| Group / create origin | `Ctrl+G` / `Ctrl+J` |
| Save / save as | `Ctrl+S` / `Ctrl+Shift+S` |
| Overview / enlarge minimap | `Shift+1` / hold `M` |
| Command menu | Hold the right mouse button, move to an action, then release |

## Local data and optional services

This repository contains the application, public assets and an instructional template. Personal boards, databases, cached images, drafts, logs and local configuration are created at runtime and are not distributed here.

- Runtime data defaults to `%LOCALAPPDATA%\InfiniteCanvasNote`.
- Saved boards and recovery drafts default to `Files/Save` and `Files/Temporary` beside the application, with a per-user fallback if the application directory is not writable. These locations can be changed in Settings.
- `.drop` files contain board state and available local images. Source documents referenced by file cards, such as PSD, PDF and PPTX files, are not copied into the board archive.
- Web parsing, online images and source searches access the relevant websites or search services. Automatic cross-device synchronization is not provided.

Visual model assistance is optional. Copy `.reverse-image.example.json` to `.reverse-image.local.json` and supply your own service configuration, or use the `REVERSE_IMAGE_*` environment variables. The canvas and local OCR can run without model credentials. Using model-assisted recognition sends the image to the configured provider. Local configuration is ignored by Git; do not put credentials in source files or public documentation.

## Development and Windows packages

Run `Start-DropIt.bat -Dev` for frontend hot reload. Restart after changing Python modules.

Packaging is a developer task. Use Python 3.14.6, Node.js 24.19.0, NSIS and `backend/requirements-build.txt`. Run `npm run desktop:dist` to create Setup, Portable ZIP and SHA256 checksums under `release/`. ZIP creation uses Python; 7-Zip is not required. See the [packaging guide](desktop/README.md#构建发布包).

## Architecture and license

The frontend uses React, TypeScript and Vite. FastAPI, SQLite and RapidOCR provide local services. The Windows shell uses pywebview and Edge WebView2. See [ARCHITECTURE.md](ARCHITECTURE.md) for the source layout.

Application code is licensed under [MIT](LICENSE). The bundled Lil Grotesk fonts retain their [SIL Open Font License](frontend/public/fonts/OFL-LilGrotesk.txt). Other local fonts are referenced through the system and are not distributed. See the [font notes](frontend/public/fonts/README.md).

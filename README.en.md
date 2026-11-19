# DROP-IT

English · [简体中文](README.md)

**One canvas to replace all your bookmarks. Save any content from any platform.**

DROP-IT is a cross-platform tool for collecting reference material. Capture web links and images in one click, or use screenshots to trace their sources, then save the material and identified source links as collection cards. Simple grouping and tree structures make collecting across platforms as convenient as built-in bookmarks, keeping content and its origins together.

## Features

- Collect pasted text, images and links, or drag in web content and local files. Text cards support Markdown.
- Turn web links into visual cards with titles, summaries and available covers.
- Pan, zoom, select, group, collapse and connect content through origin nodes and parent-child links.
- Navigate with full-text search, a minimap, an overview and numbered pins.
- Work in multiple board windows, save `.drop` files, and recover local drafts.
- Associate supported Windows screenshots with web pages or local source files.

## Common controls

| Action | Default control |
| --- | --- |
| Pan / zoom | Space + drag or middle-button drag / mouse wheel |
| New card / search | `Ctrl+N` / `Ctrl+K` |
| Group / create origin | `Ctrl+G` / `Ctrl+J` |
| Save / save as | `Ctrl+S` / `Ctrl+Shift+S` |
| Overview / enlarge minimap | `Shift+1` / hold `M` |
| Command menu | Hold the right mouse button, move to an action, then release |

## Download and install

All three options support **Windows 10/11 x64** and check for **WebView2, .NET Framework and the x64 VC++ runtime**, downloading Microsoft's official components over the internet when needed. Follow any Windows confirmation or restart prompts.

### 1. Installer (recommended)

- **Download:** [Drop-it-Setup-0.1.1.exe](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-Setup-0.1.1.exe), containing the packaged application and runtime resources.
- **Run:** double-click Setup to install for the current user, create shortcuts and open the app automatically.
- **Environment:** Python runtime dependencies are bundled. No Python, Node.js or Git installation is required; Setup prepares missing Windows components.

### 2. One-click source launch

- **Download:** [Drop-it-0.1.1-Source.zip](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-0.1.1-Source.zip), containing source code, public assets and setup scripts.
- **Run:** extract the whole archive and double-click `Start-DropIt.bat` in its root folder. The app opens when preparation finishes.
- **Environment:** the first run requires internet access to prepare Python 3.14.6, Node.js 24.19.0 and project dependencies, then builds the interface. Compatible installed tools are reused; Git is not required. Later launches reuse the prepared environment.

### 3. Portable application

- **Download:** [Drop-it-0.1.1-Portable.zip](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-0.1.1-Portable.zip), containing the packaged application and runtime resources.
- **Run:** extract the whole archive and double-click `DropIt.exe`. Keep it in the same folder as `pinboard-service.exe` and `bootstrap`.
- **Environment:** no Python, Node.js or Git installation is required. The first launch prepares missing Windows components.

Windows N/KN editions require the Media Feature Pack separately; ARM64 and 32-bit systems are not supported. See the [desktop guide](desktop/README.md) for more instructions and the [release page](https://github.com/lalala625k-ops/DROP-IT/releases/tag/v0.1.1) for version details and checksums.

## Architecture and license

The frontend uses React, TypeScript and Vite. FastAPI, SQLite and RapidOCR provide local services. The Windows shell uses pywebview and Edge WebView2. See [ARCHITECTURE.md](ARCHITECTURE.md) for the source layout.

Application code is licensed under [MIT](LICENSE). The bundled Lil Grotesk fonts retain their [SIL Open Font License](frontend/public/fonts/OFL-LilGrotesk.txt). Other local fonts are referenced through the system and are not distributed. See the [font notes](frontend/public/fonts/README.md).

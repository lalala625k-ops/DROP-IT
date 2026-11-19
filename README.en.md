# DROP-IT

English · [简体中文](README.md)

**One canvas to replace all your bookmarks. Save any content from any platform.**

DROP-IT is a cross-platform tool for collecting reference material. Capture web links and images in one click, or use screenshots to trace their sources, then save the material and identified source links as collection cards. Simple grouping and tree structures make collecting across platforms as convenient as built-in bookmarks, keeping content and its origins together.

## Features

- **One-click collecting**:
  - **Links**: drag in a link to create a collection card. Site-specific parsing makes the saved page's content visible at a glance.
  - **Images**: drag in a web image with its source link attached, then click to open the original link.
  - **Screenshots**: capture exactly the content you want from any webpage. Paste it to identify its original link and title and create a collection card.
- **Easy organizing**: move and resize image cards, group them, and build parent-child relationships into a tree. Both cards and groups support titles and custom branch colors.
- Navigate with full-text search, a minimap, an overview and numbered pins.
- Work in multiple board windows, save `.drop` files, and recover local drafts.
- **Local files and text**: drag in local files, or type and paste text. Text supports Markdown.

## Common controls

| Action | Default control |
| --- | --- |
| Pan / zoom | Space + drag or middle-button drag / mouse wheel |
| New card / search | `Ctrl+N` / `Ctrl+K` |
| Group / create origin | `Ctrl+G` / `Ctrl+J` |
| Create a parent-child relationship | Hold `Ctrl+Shift` and left-drag the child card or group onto a parent card, group or origin |
| Save / save as | `Ctrl+S` / `Ctrl+Shift+S` |
| Overview / enlarge minimap | `Shift+1` / hold `M` |
| Command menu | Hold the right mouse button, move to an action, then release |

## Download and install

All four options support **Windows 10/11 x64**. The launcher or installer checks for **WebView2, .NET Framework and the x64 VC++ runtime**, downloading Microsoft's official components over the internet when needed. Follow any Windows confirmation or restart prompts.

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

### 4. Ask an agent to install

Copy the prompt below to an agent that can download files and execute commands on your computer. It will use the official installer to check the environment, verify the download, install the app and confirm startup.

```text
Please install and launch DROP-IT on this computer:
https://github.com/lalala625k-ops/DROP-IT

1. Before installation, check Windows 10/11 x64, built-in Windows PowerShell 5.1, internet access and write access to the current user's directory. Prepare the Media Feature Pack first on Windows N/KN. If the system is unsupported, explain why and stop installation.
2. Use the official GitHub API or an already-installed gh CLI to find this repository's latest stable release. Read its installation notes, download Drop-it-Setup-*.exe and SHA256SUMS.txt from the same release, and verify the installer's SHA256.
3. The installer bundles Python runtime dependencies; Python, Node.js and Git do not need to be installed separately. Let Setup detect and prepare WebView2, .NET Framework 4.6.2 or later, and the x64 VC++ runtime. VC++ must be version 14.40.33816.0 or later.
4. Install for the current user and preserve existing boards, files and settings. If DROP-IT is running, ask me to save and close it first. You may use /S for silent installation. Wait for completion and check the exit code: 0 means success, 3010 requires a restart, and other nonzero codes indicate failure.
5. Explain any Windows security, administrator or restart prompt and let me handle it. Do not restart automatically. On failure, retain logs and explain the next step.
6. A /S installation does not launch the app. After successful installation, open %LOCALAPPDATA%\Drop-it\DropIt.exe, or the actual path if a different location was specified. Confirm that the canvas opens, then report the installed version, location and verification result. State clearly if startup could not be verified.
```

Windows N/KN editions require the Media Feature Pack separately; ARM64 and 32-bit systems are not supported. See the [desktop guide](desktop/README.md) for more instructions and the [release page](https://github.com/lalala625k-ops/DROP-IT/releases/tag/v0.1.1) for version details and checksums.

## Architecture and license

The frontend uses React, TypeScript and Vite. FastAPI, SQLite and RapidOCR provide local services. The Windows shell uses pywebview and Edge WebView2. See [ARCHITECTURE.md](ARCHITECTURE.md) for the source layout.

Application code is licensed under [MIT](LICENSE). The bundled Lil Grotesk fonts retain their [SIL Open Font License](frontend/public/fonts/OFL-LilGrotesk.txt). Other local fonts are referenced through the system and are not distributed. See the [font notes](frontend/public/fonts/README.md).

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

## Run from source

The current desktop launcher targets **Windows 10/11 x64** with **Microsoft Edge WebView2 Runtime**. Install **Node.js 18+** and **Python 3.10+**. Building Windows installers requires **Python 3.12+**.

Run these commands from the project directory. A dedicated Python virtual environment is recommended.

```powershell
git clone https://github.com/lalala625k-ops/DROP-IT.git
cd DROP-IT
python -m pip install -r backend/requirements-desktop.txt
npm --prefix frontend ci
npm run dev
```

Development mode starts the desktop window, local backend and Vite hot reload. Restart the desktop app after changing native Python modules.

To use the built frontend:

```powershell
npm run build
npm run desktop:start
```

After building, `open_site.bat` opens the canvas in a local browser. Browser mode does not provide native screenshot monitoring or all desktop file-source features. See the [desktop and browser guide](desktop/README.md) for details.

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

## Build Windows packages

Use Python 3.12+, install the dependencies above, and install **7-Zip** and **NSIS**. The build expects 7-Zip in its default installation location. Set `PINBOARD_MAKENSIS` if the NSIS compiler is installed elsewhere.

```powershell
npm run desktop:dist
```

The local `release/` directory receives a portable directory, a ZIP and a Windows installer. Packaging includes only designated application files and the public template, excluding personal boards and drafts. This repository is distributed primarily as source; see the [packaging guide](desktop/README.md#构建发布包).

## Architecture and license

The frontend uses React, TypeScript and Vite. FastAPI, SQLite and RapidOCR provide local services. The Windows shell uses pywebview and Edge WebView2. See [ARCHITECTURE.md](ARCHITECTURE.md) for the source layout.

Application code is licensed under [MIT](LICENSE). The bundled Lil Grotesk fonts retain their [SIL Open Font License](frontend/public/fonts/OFL-LilGrotesk.txt). Other local fonts are referenced through the system and are not distributed. See the [font notes](frontend/public/fonts/README.md).

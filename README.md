# DROP-IT

[English](README.en.md) · 简体中文

**一张画布，替代所有收藏夹，收藏任意平台的任意内容。**

DROP-IT 是一款跨平台素材收藏工具：一键收集网页链接与图片，或通过截图追溯内容来源，将素材与识别到的来源链接保存为收藏卡片。支持轻量分组和树状整理，让跨平台收藏像原生收藏夹一样便捷，内容与出处一并留存。

## 功能

- **一键收藏**：
  - **链接收藏**：链接一键拖入，自动变成收藏卡。不同网站采用不同解析规则，一眼看到收藏的网站内容。
  - **图片收藏**：网页图片拖入自动带上来源链接，点击即可跳转原链接。
  - **截图收藏**：任意网页随手截图，精准选取想收藏的内容；粘贴后自动识别原始链接和标题，生成收藏卡。
- **随手整理**：轻量调整图片卡片的位置和尺寸，随手打组、建立父子关系，整理成树状结构。卡片和组都支持设置标题与自定义分支颜色。
- **快速定位**：全文搜索、小地图、全览和编号图钉。
- **本地保存**：多窗口画板、自动暂存、恢复记录，以及手动保存的 `.drop` 工作区。
- **本地文件与文本**：支持拖入本地文件，支持直接输入或粘贴文本；文字支持 Markdown。

## 常用操作

| 操作 | 默认方式 |
| --- | --- |
| 平移 / 缩放 | 按住 Space 拖动或中键拖动 / 滚轮 |
| 新建便签 / 搜索 | `Ctrl+N` / `Ctrl+K` |
| 编组 / 创建原点 | `Ctrl+G` / `Ctrl+J` |
| 建立父子关系 | 按住 `Ctrl+Shift`，用鼠标左键将子卡片或组拖向父卡片、组或原点 |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |
| 全览 / 放大小地图 | `Shift+1` / 按住 `M` |
| 打开命令菜单 | 按住右键，划向功能后松开 |

## 下载与安装

以下四种方式均适用于 **Windows 10/11 x64**。运行入口或安装器会检查 **WebView2、.NET Framework 和 VC++ x64 运行库**，缺少时联网下载微软官方组件。系统要求确认或重启时按提示操作。

### 1. 正式安装版（推荐）

- **下载内容**：[Drop-it-Setup-0.1.1.exe](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-Setup-0.1.1.exe)，包含已打包的程序与运行资源。
- **运行方式**：双击安装包，自动安装到当前用户目录、创建快捷方式并打开软件。
- **所需环境**：Python 运行依赖已包含在程序中，无需预装 Python、Node.js 或 Git；安装器自动准备缺少的 Windows 组件。

### 2. 源码一键运行

- **下载内容**：[Drop-it-0.1.1-Source.zip](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-0.1.1-Source.zip)，包含源码、公共资源和自动准备脚本。
- **运行方式**：完整解压后双击根目录的 `Start-DropIt.bat`，准备完成后自动打开软件。
- **所需环境**：首次运行需联网，自动准备 Python 3.14.6、Node.js 24.19.0 和项目依赖，并构建界面；已有兼容工具会复用，无需预装 Git。后续启动复用已完成的准备。

### 3. 成品免安装版

- **下载内容**：[Drop-it-0.1.1-Portable.zip](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-0.1.1-Portable.zip)，包含已打包的程序与运行资源。
- **运行方式**：完整解压后双击 `DropIt.exe`。请将它与 `pinboard-service.exe`、`bootstrap` 文件夹保留在同一目录。
- **所需环境**：无需预装 Python、Node.js 或 Git；首次启动自动准备缺少的 Windows 组件。

### 4. 让 Agent 安装

将下面的提示词复制给能在你的电脑上下载文件、执行命令的 Agent。它会使用正式安装包，完成环境检查、下载校验、安装和启动验证。

```text
请帮我在这台电脑上安装并启动 DROP-IT：
https://github.com/lalala625k-ops/DROP-IT

1. 安装前检查 Windows 10/11 x64、系统自带的 PowerShell 5.1、网络连接和当前用户目录的写入权限。Windows N/KN 还需先准备 Media Feature Pack；系统不受支持时说明原因并停止安装。
2. 通过 GitHub 官方 API 或已安装的 gh CLI，找到该仓库最新的正式 Release，读取安装说明，下载同一版本的 Drop-it-Setup-*.exe 和 SHA256SUMS.txt，并核对安装包的 SHA256。
3. 正式安装包已包含 Python 运行依赖，无需预装 Python、Node.js 或 Git。所需 WebView2、.NET Framework 4.6.2 或更高版本、VC++ x64 运行库由安装器自动检测和补齐；VC++ 版本需不低于 14.40.33816.0。
4. 使用当前用户安装目录，保留已有画板、文件和设置。如软件正在运行，先让我保存并关闭。可使用 /S 静默安装，并等待安装进程结束、检查退出码：0 表示安装成功，3010 表示需要重启，其他非零值表示失败。
5. 如果遇到系统安全确认、管理员确认或重启要求，说明原因并交给我处理，不自动重启。失败时保留日志并说明下一步。
6. /S 安装不会自动启动软件。安装成功后打开默认路径 %LOCALAPPDATA%\Drop-it\DropIt.exe（若指定了其他路径则使用实际路径），确认能进入画布，再告诉我安装版本、安装位置和验证结果。若无法验证启动，请如实说明。
```

Windows N/KN 版本需另行安装 Media Feature Pack；ARM64 和 32 位系统暂不支持。更多使用说明见[桌面指南](desktop/README.md)，版本信息与校验文件见 [Release](https://github.com/lalala625k-ops/DROP-IT/releases/tag/v0.1.1)。

## 项目结构与许可

React、TypeScript、Vite 构成前端；FastAPI、SQLite 与 RapidOCR 提供本地服务；pywebview 和 Edge WebView2 承载 Windows 桌面窗口。目录职责见 [ARCHITECTURE.md](ARCHITECTURE.md)。

项目代码采用 [MIT 许可证](LICENSE)。随附 Lil Grotesk 字体使用 [SIL Open Font License](frontend/public/fonts/OFL-LilGrotesk.txt)；其他本机字体仅通过系统字体调用，不随项目分发，详见 [字体说明](frontend/public/fonts/README.md)。

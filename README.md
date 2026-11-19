# DROP-IT

[English](README.en.md) · 简体中文

**一张画布，替代所有收藏夹，收藏任意平台的任意内容。**

DROP-IT 是一款跨平台素材收藏工具：一键收集网页链接与图片，或通过截图追溯内容来源，将素材与识别到的来源链接保存为收藏卡片。支持轻量分组和树状整理，让跨平台收藏像原生收藏夹一样便捷，内容与出处一并留存。

## 功能

- **统一收集**：粘贴文字、图片和链接，拖入网页内容或本地文件；文字支持 Markdown。
- **可视化链接**：获取网页标题、摘要和可用封面，保留可打开的原链接。
- **空间整理**：自由平移缩放、框选、编组、折叠分组，并通过原点与父子连线组织内容。
- **快速定位**：全文搜索、小地图、全览和编号图钉。
- **本地保存**：多窗口画板、自动暂存、恢复记录，以及手动保存的 `.drop` 工作区。
- **桌面来源关联**：在支持的 Windows 截图场景中尝试关联网页或本地文件；本地文件卡保留原文件引用。

## 常用操作

| 操作 | 默认方式 |
| --- | --- |
| 平移 / 缩放 | 按住 Space 拖动或中键拖动 / 滚轮 |
| 新建便签 / 搜索 | `Ctrl+N` / `Ctrl+K` |
| 编组 / 创建原点 | `Ctrl+G` / `Ctrl+J` |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |
| 全览 / 放大小地图 | `Shift+1` / 按住 `M` |
| 打开命令菜单 | 按住右键，划向功能后松开 |

## 下载与安装

三种方式均适用于 **Windows 10/11 x64**，都会检查 **WebView2、.NET Framework 和 VC++ x64 运行库**，缺少时联网下载微软官方组件。系统要求确认或重启时按提示操作。

### 1. 正式安装版（推荐）

- **下载内容：**[Drop-it-Setup-0.1.1.exe](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-Setup-0.1.1.exe)，包含已打包的程序与运行资源。
- **运行方式：**双击安装包，自动安装到当前用户目录、创建快捷方式并打开软件。
- **所需环境：**Python 运行依赖已包含在程序中，无需预装 Python、Node.js 或 Git；安装器自动准备缺少的 Windows 组件。

### 2. 源码一键运行

- **下载内容：**[Drop-it-0.1.1-Source.zip](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-0.1.1-Source.zip)，包含源码、公共资源和自动准备脚本。
- **运行方式：**完整解压后双击根目录的 `Start-DropIt.bat`，准备完成后自动打开软件。
- **所需环境：**首次运行需联网，自动准备 Python 3.14.6、Node.js 24.19.0 和项目依赖，并构建界面；已有兼容工具会复用，无需预装 Git。后续启动复用已完成的准备。

### 3. 成品免安装版

- **下载内容：**[Drop-it-0.1.1-Portable.zip](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-0.1.1-Portable.zip)，包含已打包的程序与运行资源。
- **运行方式：**完整解压后双击 `DropIt.exe`。请将它与 `pinboard-service.exe`、`bootstrap` 文件夹保留在同一目录。
- **所需环境：**无需预装 Python、Node.js 或 Git；首次启动自动准备缺少的 Windows 组件。

Windows N/KN 版本需另行安装 Media Feature Pack；ARM64 和 32 位系统暂不支持。更多使用说明见[桌面指南](desktop/README.md)，版本信息与校验文件见 [Release](https://github.com/lalala625k-ops/DROP-IT/releases/tag/v0.1.1)。

## 项目结构与许可

React、TypeScript、Vite 构成前端；FastAPI、SQLite 与 RapidOCR 提供本地服务；pywebview 和 Edge WebView2 承载 Windows 桌面窗口。目录职责见 [ARCHITECTURE.md](ARCHITECTURE.md)。

项目代码采用 [MIT 许可证](LICENSE)。随附 Lil Grotesk 字体使用 [SIL Open Font License](frontend/public/fonts/OFL-LilGrotesk.txt)；其他本机字体仅通过系统字体调用，不随项目分发，详见 [字体说明](frontend/public/fonts/README.md)。

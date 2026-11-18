# DROP-IT

[English](README.en.md) · 简体中文

**一张画布，替代所有收藏夹，收藏任意平台的任意内容。**

DROP-IT 是一个用于收集和整理文本、图片、网页链接与本地文件引用的无限画布。把内容拖入画布，自由排列、编组、连接，再保存为可携带资源的 `.drop` 文件。

## 功能

- **统一收集**：粘贴文字、图片和链接，拖入网页内容或本地文件；文字支持 Markdown。
- **可视化链接**：获取网页标题、摘要和可用封面，保留可打开的原链接。
- **空间整理**：自由平移缩放、框选、编组、折叠分组，并通过原点与父子连线组织内容。
- **快速定位**：全文搜索、小地图、全览和编号图钉。
- **本地保存**：多窗口画板、自动暂存、恢复记录，以及手动保存的 `.drop` 工作区。
- **桌面来源关联**：在支持的 Windows 截图场景中尝试关联网页或本地文件；本地文件卡保留原文件引用。
- **图片工具**：本地 OCR、图片来源识别，以及可选的 [Edge 图片来源扩展](extensions/edge-image-source/README.md)。

“任意内容”表达统一收集的目标。网页解析和自动来源识别受平台接口、登录状态、访问限制与截图方式影响，不能保证每个平台或每条链接都能自动取得完整内容。解析失败时保留已有内容和可用链接。

## 源码运行

当前桌面入口面向 **Windows 10/11 x64**，需要 Microsoft Edge WebView2 Runtime。准备 **Node.js 18+** 和 **Python 3.10+**；如需制作安装包，使用 **Python 3.12+**。

在项目根目录执行，建议使用独立的 Python 虚拟环境：

```powershell
git clone https://github.com/lalala625k-ops/DROP-IT.git
cd DROP-IT
python -m pip install -r backend/requirements-desktop.txt
npm --prefix frontend ci
npm run dev
```

`npm run dev` 启动桌面窗口、本地后端与 Vite 热更新。修改 Python 原生模块后，需要完整重启桌面窗口。

运行构建后的界面：

```powershell
npm run build
npm run desktop:start
```

也可在构建后运行 `open_site.bat`，用本机浏览器访问画布。浏览器模式没有桌面原生截图监听和完整文件来源能力。详细操作见 [桌面与浏览器使用指南](desktop/README.md)。

## 常用操作

| 操作 | 默认方式 |
| --- | --- |
| 平移 / 缩放 | 按住 Space 拖动或中键拖动 / 滚轮 |
| 新建便签 / 搜索 | `Ctrl+N` / `Ctrl+K` |
| 编组 / 创建原点 | `Ctrl+G` / `Ctrl+J` |
| 保存 / 另存为 | `Ctrl+S` / `Ctrl+Shift+S` |
| 全览 / 放大小地图 | `Shift+1` / 按住 `M` |
| 打开命令菜单 | 按住右键，划向功能后松开 |

## 数据与可选服务

源码只包含程序、公共资源和操作说明模板。个人画板、数据库、图片缓存、暂存、日志与本机配置在运行时创建，不随本仓库分发。

- 运行数据默认位于 `%LOCALAPPDATA%\InfiniteCanvasNote`。
- 手动保存与恢复目录默认为程序目录下的 `Files/Save` 和 `Files/Temporary`；不可写时回退到当前用户的本地应用数据目录，也可在设置中更改。
- `.drop` 文件包含画板状态与可用的本地图片。文件卡引用的 PSD、PDF、PPTX 等原文档不会自动复制进画板。
- 网页解析、在线图片和来源搜索会访问对应网站或搜索服务。现有功能不提供自动跨设备同步。

视觉模型辅助识别是可选能力。需要时将 `.reverse-image.example.json` 复制为 `.reverse-image.local.json`，填写自己的服务配置；也可使用 `REVERSE_IMAGE_*` 环境变量。未配置时可以正常启动和使用画布、本地 OCR 等功能。启用模型识别会将待识别图片发送给配置的服务商。本机配置已被 Git 忽略，不要将密钥写入源码或公开文档。

## 构建 Windows 发布包

使用 Python 3.12+，安装上述依赖，并安装 **7-Zip** 与 **NSIS**。7-Zip 使用默认安装位置；NSIS 编译器可通过 `PINBOARD_MAKENSIS` 指定。

```powershell
npm run desktop:dist
```

产物写入本机 `release/`，包括免安装目录、ZIP 与安装程序。构建只收集指定程序和公共模板，不收集个人保存与暂存。当前仓库以源码分发为主；构建细节见 [桌面指南](desktop/README.md#构建发布包)。

## 项目结构与许可

React、TypeScript、Vite 构成前端；FastAPI、SQLite 与 RapidOCR 提供本地服务；pywebview 和 Edge WebView2 承载 Windows 桌面窗口。目录职责见 [ARCHITECTURE.md](ARCHITECTURE.md)。

项目代码采用 [MIT 许可证](LICENSE)。随附 Lil Grotesk 字体使用 [SIL Open Font License](frontend/public/fonts/OFL-LilGrotesk.txt)；其他本机字体仅通过系统字体调用，不随项目分发，详见 [字体说明](frontend/public/fonts/README.md)。

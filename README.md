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

## 一键运行（Windows 10/11 x64）

**正式安装版：** [下载 Setup](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-Setup-0.1.1.exe)，双击后自动检查运行组件、安装并打开画布。默认安装到当前用户目录，创建桌面和开始菜单快捷方式。

**源码一键运行：** [下载源码 ZIP](https://github.com/lalala625k-ops/DROP-IT/archive/refs/heads/main.zip)，完整解压后双击根目录的 **`Start-DropIt.bat`**（或“启动桌面版.bat”）。首次自动准备 Python、Node.js、隔离依赖和前端界面，随后打开软件；以后复用已准备环境，源码或依赖改变时自动重建。无需预装 Git 或手动输入命令。

**成品免安装版：** [下载 Portable ZIP](https://github.com/lalala625k-ops/DROP-IT/releases/download/v0.1.1/Drop-it-0.1.1-Portable.zip)，完整解压后打开 `DropIt.exe`。保留相邻的后端程序和 `bootstrap` 文件夹。

三种入口都会检查 WebView2、.NET Framework 和 VC++ x64 运行库，缺少时运行微软官方安装程序。首次下载组件需要联网。Windows 安全确认、管理员确认或重启要求需按系统提示操作；网络失败可重试。可选视觉模型不属于启动依赖。

源码入口使用 Python 3.14.6、Node.js 24.19.0，并校验工具下载及 Python 依赖。已有符合要求的 Python 3.14 常规 x64 版本（补丁版本不低于 3.14.6）可复用；Python 包始终放入独立虚拟环境，不修改全局 PATH。完整使用方式与日志位置见 [桌面指南](desktop/README.md)。

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

## 开发与制作发布包

开发热更新可运行 `Start-DropIt.bat -Dev`。前端修改实时更新；Python 模块修改后重新启动。

制作安装包属于开发侧工作。使用 Python 3.14.6、Node.js 24.19.0、NSIS，以及 `backend/requirements-build.txt` 中的打包依赖。运行 `npm run desktop:dist`，会在 `release/` 生成 Setup、Portable ZIP 和 SHA256 校验文件。ZIP 由 Python 生成，无需安装 7-Zip。详见 [构建说明](desktop/README.md#构建发布包)。

## 项目结构与许可

React、TypeScript、Vite 构成前端；FastAPI、SQLite 与 RapidOCR 提供本地服务；pywebview 和 Edge WebView2 承载 Windows 桌面窗口。目录职责见 [ARCHITECTURE.md](ARCHITECTURE.md)。

项目代码采用 [MIT 许可证](LICENSE)。随附 Lil Grotesk 字体使用 [SIL Open Font License](frontend/public/fonts/OFL-LilGrotesk.txt)；其他本机字体仅通过系统字体调用，不随项目分发，详见 [字体说明](frontend/public/fonts/README.md)。

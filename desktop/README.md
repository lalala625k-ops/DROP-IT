# Windows 桌面与浏览器使用指南

DROP-IT 的桌面版使用 pywebview 和 Edge WebView2。以下命令均在项目根目录执行。

## 环境与安装

- Windows 10/11 x64，安装 Microsoft Edge WebView2 Runtime。
- Node.js 18+。
- Python 3.10+；如需制作安装包，使用 Python 3.12+。

建议先创建并激活独立 Python 虚拟环境，再安装依赖：

```powershell
python -m pip install -r backend/requirements-desktop.txt
npm --prefix frontend ci
```

## 启动与更新

| 场景 | 命令或入口 |
| --- | --- |
| 开发与前端热更新 | `npm run dev` 或 `desktop/run_dev.bat` |
| 构建前端 | `npm run build` |
| 运行已构建界面 | `npm run desktop:start`、`启动桌面版.bat` 或 `desktop/run.bat` |
| 更新本地前端构建 | `desktop/update.bat`，完成后在窗口按 `F5` |
| 本机浏览器模式 | 先构建前端，再运行 `open_site.bat` |

开发模式自动启动本地后端与 Vite 服务。桌面 Python 模块更新后需要完整关闭并重新启动；前端热更新无法加载原生模块的修改。

桌面默认打开独立空白画板。异常退出后如有可恢复内容，程序提供恢复选择。公共操作说明模板位于 `desktop/Template/Template一.drop`，可通过“文件 → 打开”选用。

## 本机浏览器模式

```powershell
npm run build
.\open_site.bat
```

浏览器入口在本机 `http://localhost:5173/` 提供构建后的前端和 API，只监听回环地址。关闭浏览器窗口后，本地服务可以继续运行；电脑重启后需再次启动。若端口已经被开发服务或其他程序使用，先关闭占用它的服务。

浏览器版复用画布、保存与恢复功能，但没有桌面原生截图监听、原生来源打开等完整能力。打开独立画板时需要浏览器允许当前站点弹出窗口。

## 保存与恢复

- `Ctrl+S` 保存，`Ctrl+Shift+S` 另存为；首次保存选择 `.drop` 文件路径。
- 自动暂存用于恢复编辑状态，正式 `.drop` 文件在手动保存时更新。
- “文件 → 恢复”或设置中的恢复入口可查看可用记录，并在独立画板中恢复。
- `.drop` 包含画布对象、关系、视口、图钉与可用本地图片。远程图片尚未缓存成功时，不能保证离线可用。
- 本地文件卡只记录原文件引用；PSD、PDF、PPTX 等原文档不会自动打包进画板。移动原文件或换电脑后可能需要重新关联。

| 内容 | 默认位置 |
| --- | --- |
| 主运行数据、图片与配置 | `%LOCALAPPDATA%\InfiniteCanvasNote` |
| 手动保存 | 程序目录的 `Files/Save` |
| 自动暂存与恢复 | 程序目录的 `Files/Temporary` |
| 公共示例 | 程序目录的 `Files/Template` |

程序目录不可写时，文件目录回退到 `%LOCALAPPDATA%\InfiniteCanvasNote\Files`。独立画板使用自己的运行数据作用域。保存和暂存位置可在“设置 → 通用设置 → 文件”中调整。

## 截图与来源

桌面程序运行时，可尝试为微信 `Alt+A` 或 Windows `Win+Shift+S` 的矩形截图关联来源。网页来源支持 Edge 和 Chrome；本地文档来源适配包括 Photoshop、WPS PDF 和 WPS 演示。

来源识别取决于页面、窗口、选区和系统接口。正常匹配失败时，现有回退策略可能使用本次浏览器候选或本次运行中最近成功的网页，来源可能不准确；使用前应核对。对 Firefox、其他截图工具、编辑后的截图和任意应用版本不作保证。

卡片通常先点击选中，再点击来源入口打开。文件卡底部路径可在资源管理器中定位原文件；原文件移动或删除后需重新关联。浏览器图片来源扩展是独立可选功能，见 [扩展说明](../extensions/edge-image-source/README.md)。

## 可选视觉模型

```powershell
Copy-Item .reverse-image.example.json .reverse-image.local.json
```

在新文件中填写自己的服务配置，或设置相应 `REVERSE_IMAGE_*` 环境变量。模型辅助识别会发送待识别图片到配置的服务商，未配置时不影响正常启动。凭据只放在被忽略的本机配置中，不要提交到 Git。

## 构建发布包

需要 Python 3.12+、上述源码依赖、默认位置安装的 7-Zip，以及 NSIS。NSIS 编译器未在常用安装位置时，可用 `PINBOARD_MAKENSIS` 指定 `makensis.exe` 的完整路径。

```powershell
npm run desktop:dist
```

该命令构建前端，再使用 PyInstaller 生成后端与桌面程序，最后组装：

- `release/Drop-it 0.1/`：免安装目录。
- `release/Drop-it-0.1-Portable.zip`：免安装 ZIP。
- `release/Drop-it-Setup-0.1.exe`：安装程序。

发布载荷限定为两份程序、使用说明和指定公共模板，另创建空白 Save / Temporary 目录。构建不会扫描并带入个人画板。已含个人保存或恢复文件的旧发布目录会被拒绝覆盖，应选择新的发布子目录。

打包后用户运行 `DropIt.exe` 无需另装 Python 或 Node.js，但仍需要系统 WebView2 Runtime。安装程序默认安装到当前用户的 `%LOCALAPPDATA%\Drop-it`，卸载保留用户文件与运行数据。

## 常见问题

- **缺少前端界面**：先执行 `npm run build`。
- **修改未显示**：前端构建后按 `F5`；Python 改动后完整重启。
- **浏览器入口启动失败**：检查端口占用和 `%LOCALAPPDATA%\InfiniteCanvasNote\local_site.log`。
- **Vite 启动失败**：检查 `%LOCALAPPDATA%\InfiniteCanvasNote\logs` 下的开发服务日志。
- **安装包构建失败**：确认使用 Python 3.12+，并已安装 7-Zip、NSIS 和完整 Python 依赖。

目录职责见 [ARCHITECTURE.md](../ARCHITECTURE.md)，项目许可见 [LICENSE](../LICENSE)。

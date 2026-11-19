# Windows 桌面使用与发布

## 普通用户：下载后打开

支持 Windows 10/11 x64。首次下载组件需要联网。

Windows N/KN 精简媒体版本需要先通过 Windows 可选功能安装 Media Feature Pack；当前自动准备流程不安装此系统可选功能。ARM64 和 32 位系统不在本版支持范围。

| 下载内容 | 用户操作 | 程序自动完成 |
| --- | --- | --- |
| 正式 Setup | 双击安装程序 | 检测运行组件、安装到用户目录、创建快捷方式、打开画布 |
| 源码 ZIP | 完整解压，双击 `Start-DropIt.bat` | 准备专用 Python/Node 环境、安装依赖、构建界面、打开画布 |
| 成品 Portable ZIP | 完整解压，双击 `DropIt.exe` | 检测必需运行组件、打开画布 |

源码入口不需要预装 Git、Python、Node 或手动输入命令。下载 Python 和 Node 时校验固定 SHA256；Python 运行依赖也带 SHA256 锁定。已有兼容工具可复用，Python 包放入独立虚拟环境，不修改全局 PATH。源码与依赖未变时，后续启动复用已完成的准备。

WebView2、.NET Framework 与 VC++ x64 运行库已有时直接复用；缺少时下载微软官方组件，验证发布者签名后安装，并重新检测。系统要求权限确认或重启时，按提示完成。网络失败可重试或取消。安装器自身使用原生窗口，不依赖 WebView2 显示进度。

Setup 默认安装到 `%LOCALAPPDATA%\Drop-it`。免安装版需保留 `DropIt.exe`、`pinboard-service.exe` 和 `bootstrap/`，不能只复制一个 EXE。覆盖安装前先保存画板并关闭正在运行的 DropIt；安装失败时关闭旧程序后重试。

## 源码启动选项

| 场景 | 入口 |
| --- | --- |
| 一键运行 | `Start-DropIt.bat` 或“启动桌面版.bat” |
| 开发热更新 | `Start-DropIt.bat -Dev` 或 `desktop/run_dev.bat` |
| 仅准备环境 | `Start-DropIt.bat -PrepareOnly` |
| 重新安装依赖并构建 | `Start-DropIt.bat -Repair` |

`-PrepareOnly` 不启动窗口；`-Repair` 保留用户画板。Python 模块修改后完整重启桌面程序。前端源码或锁文件变更后，普通入口会重新构建。`F5` 刷新界面，`Ctrl+R` 是恢复卡片尺寸。

环境、下载缓存与准备日志位于 `%LOCALAPPDATA%\DropIt\bootstrap`，各源码目录使用独立作用域。控制台提示具体日志位置；运行组件日志为该目录下的 `logs/runtime-setup.log`。隔离验证可设置 `DROPIT_BOOTSTRAP_HOME`，普通用户无需配置。

## 保存与恢复

桌面默认打开空白画板，异常退出后提供可用的恢复记录。公共模板只含操作说明，位于 `desktop/Template/Template一.drop`（源码）或 `Files/Template`（发行版）。

- `Ctrl+S` 保存，`Ctrl+Shift+S` 另存为，首次选择 `.drop` 路径。
- 自动暂存用于恢复编辑，正式 `.drop` 在手动保存时更新。
- “文件 → 恢复”或设置恢复入口在独立画板打开恢复内容。
- `.drop` 保存布局、关系、视口、图钉及已缓存图片；未缓存的在线资源不保证离线可用。
- 本地文件卡只引用原文件；PSD、PDF、PPTX 不会复制进画板，移动后需要重新关联。

| 内容 | 默认位置 |
| --- | --- |
| 运行数据、图片、配置 | `%LOCALAPPDATA%\InfiniteCanvasNote` |
| 个人保存、暂存 | 程序目录 `Files/Save`、`Files/Temporary` |
| 公共模板 | 程序目录 `Files/Template` |

目录不可写时，Files 回退到 `%LOCALAPPDATA%\InfiniteCanvasNote\Files`；也可在设置中调整。卸载保留个人 Files、运行数据及共享运行组件。

## 来源与可选服务

桌面截图来源支持有限范围的 Edge、Chrome、Photoshop 和 WPS 场景。正常匹配失败时，已有回退可能附上浏览器候选或最近网页，使用前应核对。可选浏览器扩展见[扩展说明](../extensions/edge-image-source/README.md)。

模型辅助图片识别不是启动依赖。需要时复制 `.reverse-image.example.json` 为 `.reverse-image.local.json`，填写自己的服务配置，或设置 `REVERSE_IMAGE_*` 环境变量。模型请求会发送图片给配置的服务商。本机凭据必须保持 Git 忽略。

## 构建发布包

开发机使用 Python 3.14.6、Node.js 24.19.0、NSIS。普通终端用户不需要这些打包工具。NSIS 不在默认位置时用 `PINBOARD_MAKENSIS` 指定 `makensis.exe`。

```powershell
python -m pip install -r backend/requirements-build.txt
npm --prefix frontend ci
npm run desktop:dist
```

构建先生成前端，再用 PyInstaller 冻结后端和桌面壳。最终产物：

- `release/Drop-it 0.1.1/`：成品免安装目录。
- `release/Drop-it-0.1.1-Portable.zip`：免安装 ZIP。
- `release/Drop-it-Setup-0.1.1.exe`：默认自动安装并运行的 Setup。
- `release/SHA256SUMS.txt`：产物校验值。

ZIP 用 Python 标准库生成，不需要 7-Zip。载荷明确限定为程序、公共模板、说明和四个运行组件脚本；不会扫描或打包个人数据。构建器拒绝覆盖含个人画板或未知文件的发布目录。

部署验证可使用安装器 `/S /NOAUTORUN /NOSHORTCUTS /NOREGISTRY /D=目标目录`。`/S` 不自动打开程序；`/NOREGISTRY` 同时禁用快捷方式，仅用于隔离测试。退出码 `3010` 表示需要重启后重试，其他非零码表示失败。

## 本机浏览器模式（手动开发入口）

浏览器入口仍需系统可用的 Python 依赖与前端构建。执行 `npm run build` 后运行 `open_site.bat`，访问 `http://localhost:5173/`。此入口不提供桌面截图监听及完整的原生文件能力，也不属于上述自动准备流程。

架构见 [ARCHITECTURE.md](../ARCHITECTURE.md)，技术路径见 [tech.md](../tech.md)，许可见 [LICENSE](../LICENSE)。

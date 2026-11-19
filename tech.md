# 启动与发布技术路径

## 源码一键启动

`Start-DropIt.bat` 使用 Windows 自带 PowerShell 5.1 调用 `scripts/bootstrap/SourceBootstrap.ps1`。中文启动入口、`desktop/run.bat` 和 `run_dev.bat` 复用此入口。普通模式传递 `--production`，开发模式传递 `--dev`；生产模式不会意外连接旁边已有的 Vite 服务。

`RuntimeCommon.ps1` 提供 HTTPS 下载、哈希/发布者签名校验及隐藏子进程执行。工具清单由 `toolchain.json` 固定；Python 使用 PSF 在 NuGet 发布的完整工具包，Node 使用官方 Windows ZIP。工具展开到专用目录，通过明确路径调用，不更改全局 PATH 或安装另一份系统 Python。符合 CPython 3.14、64 位、常规 GIL 构建且补丁版本不低于 3.14.6 的已有解释器可复用。

`SourceEnvironment.ps1` 为源码路径建立专用环境，按实际 Python 版本和锁文件内容确定 venv。先安装带哈希的 `requirements-bootstrap.lock.txt`，再以 `--require-hashes --no-build-isolation` 安装 `requirements-runtime.lock.txt`。纯 Python 的 proxy-tools 从受校验的源码包构建，其余运行依赖使用轮子。`pip check` 与原生依赖导入成功后才提交完成标记。

`SourceBuild.ps1` 按 Node 版本和 package/lock 内容决定 `npm ci`，按前端源码、公共资源及构建产物指纹决定是否构建。失败不写成功标记；准备锁避免同一源码目录并发安装。日志、工具、venv 和缓存默认位于 `%LOCALAPPDATA%\DropIt\bootstrap`。`DROPIT_BOOTSTRAP_HOME` 可重定向这些准备文件，不改变画板保存策略。

## Windows 运行组件

`Ensure-Runtime.ps1` 在启动应用前检查 x64 Windows、.NET Framework Release 值、WebView2 Evergreen 注册信息和 VC++ x64 运行库。缺少时从微软官方获取安装器并验证 Microsoft Corporation 签名，再执行安装和复检。已有组件走只读快速路径。`-CheckOnly` 只输出检测状态；`-NonInteractive` 将失败交给上层处理。退出码 0 为成功、3010 为需要重启、其他非零为失败。

VC++ 检测核对 System32 的 `msvcp140`、`msvcp140_1`、`vcruntime140` 和 `vcruntime140_1` DLL，版本下限为 14.40.33816.0，不依赖可能缺失的 VC 注册表项。OpenCV 使用 Windows Media Foundation；N/KN 系统缺少的 Media Feature Pack 仍由系统可选功能提供。

源码入口调用上述脚本；桌面 `runtime_setup.py` 在创建会话和启动后端前检查组件，冻结版使用 EXE 相邻的 `bootstrap/`。来源工作进程不执行安装流程。界面初始化和运行统一受服务清理保护；初始化失败返回非零码，自动启动器不等待隐藏控制台输入。

## 发布与安装

`build_desktop.ps1` 构建前端并通过 PyInstaller 冻结后端和桌面壳。`requirements-build.txt` 仅供开发侧打包；普通源码运行不安装 PyInstaller、NSIS 或 7-Zip。

`scripts/build_dropit_installer.py` 只收集两份 EXE、使用说明、公共模板和四个运行组件脚本。已有目录含未知文件、个人画板或目录联接时拒绝覆盖。Portable ZIP 由 Python 标准库生成，NSIS 模板在 `scripts/installer/dropit.nsi`，输出附 SHA256 校验值。

Setup 将运行组件脚本先解包到临时目录并检查组件，通过后才写入应用文件。默认当前用户安装，仅显示进度页，成功后自动启动；`/S` 不启动。`/NOREGISTRY` 同时禁用快捷方式，供隔离验证使用。卸载只删除本次拥有的程序和入口，保留个人 Files、运行数据以及共享组件。

# 项目结构

DROP-IT 由 React 画布、本地 FastAPI 服务和 Windows 桌面壳组成。浏览器与桌面窗口复用同一套前端；桌面壳提供截图来源、文件关联及原生窗口能力。

```text
DROP-IT/
├── frontend/
│   ├── src/components/       # 卡片、分组、菜单、设置及画布界面
│   ├── src/hooks/            # 输入交互、状态更新、保存与视口
│   ├── src/utils/            # 几何、来源处理、资源与工作区传输
│   ├── src/types/            # 画布对象类型
│   ├── public/               # 公共 Logo、字体及其许可证
│   └── build.mjs             # 前端生产构建入口
├── backend/
│   ├── main.py               # FastAPI 应用与路由组装
│   ├── desktop_server.py     # 冻结后端服务的启动入口
│   ├── routes/               # 卡片、资源、工作区、解析、恢复及设置接口
│   └── services/             # 存储、文件、解析、OCR、来源识别与恢复逻辑
├── desktop/
│   ├── app.py                # pywebview 窗口与本地服务管理
│   ├── runtime_setup.py      # 创建会话前检测并准备 Windows 运行组件
│   ├── icons/                # 桌面图标
│   ├── Template/             # 公共操作说明模板
│   └── *.py                  # 原生截图、文件来源、窗口及启动会话模块
├── extensions/
│   └── edge-image-source/    # 可选的 Edge 图片来源扩展
├── scripts/
│   ├── bootstrap/           # 源码环境准备及共用 Windows 运行组件检查
│   ├── installer/           # NSIS 一键安装模板
│   ├── build_dropit_installer.py # 组装白名单发布包和 NSIS 安装程序
│   ├── create_example.py     # 生成不含个人内容的操作说明模板
│   └── pyinstaller_hooks/    # 打包依赖收集配置
├── build_desktop.ps1         # 前端、后端、桌面壳与发布包构建入口
├── Start-DropIt.bat          # 源码一键准备环境并启动桌面窗口
├── local_site.pyw            # 本机浏览器模式启动器
└── package.json              # 开发、构建和桌面命令
```

## 修改入口

| 范围 | 主要位置 |
| --- | --- |
| 画布与对象界面 | `frontend/src/App.tsx`、`components/` |
| 拖拽、粘贴与编辑 | `frontend/src/hooks/`、`frontend/src/utils/` |
| 分组、连线、布局和视口 | `frontend/src/utils/` 中的几何与关系模块，以及对应 hooks |
| 工作区保存与恢复 | 前端工作区 hooks/utils；`backend/routes/workspaces.py`、`recovery.py`；后端存储与 draft 服务 |
| 网页标题、封面与来源 | `backend/services/scraper_service.py`、`scrapers/` 和来源识别服务 |
| 桌面截图来源 | `desktop/screenshot_*.py`、`source_*.py`、`browser_snapshot.py` |
| 本地文件卡与预览 | `desktop/file_*.py`、`pdf_previews.py` 及前端对应卡片组件 |
| 浏览器拖图来源扩展 | `extensions/edge-image-source/` |
| 源码启动与运行组件 | `Start-DropIt.bat`、`scripts/bootstrap/`、`desktop/runtime_setup.py` |
| Windows 发布包与安装 | `build_desktop.ps1`、`scripts/build_dropit_installer.py`、`scripts/installer/dropit.nsi` |

`backend/services/scrapers/experimental/` 是实际注册使用的解析器目录，属于应用源码。截图、快照、资源缓存和恢复模块同样属于运行功能。

用户画板、数据库、图片缓存与恢复记录不属于上述公共资源。程序在本机创建这些内容，位置与运行方式见 [使用指南](desktop/README.md)。

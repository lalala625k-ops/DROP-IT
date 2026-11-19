"""Build a clean Windows installer and portable ZIP from an explicit payload."""
from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.1.1'
LABEL = f'Drop-it {VERSION}'
INSTALLER_ROOT = ROOT / 'release'
PORTABLE_ROOT = INSTALLER_ROOT / LABEL
INSTALLER = INSTALLER_ROOT / f'Drop-it-Setup-{VERSION}.exe'
PORTABLE_ZIP = INSTALLER_ROOT / f'Drop-it-{VERSION}-Portable.zip'
TEMPLATE = ROOT / 'desktop/Template/Template一.drop'
RUNTIME_FILES = ('Ensure-Runtime.ps1', 'RuntimeCommon.ps1', 'RuntimeStatus.ps1', 'RuntimeProgress.ps1')
PAYLOAD = {'DropIt.exe', 'pinboard-service.exe', '使用说明.txt', 'Files/Template/Template一.drop'} | {
    f'bootstrap/{name}' for name in RUNTIME_FILES
}


def require_file(path: Path, description: str) -> Path:
    if not path.is_file():
        raise FileNotFoundError(f'缺少{description}: {path}')
    return path


def validate_distribution(destination: Path, *, verify_runtime: bool = True) -> None:
    entries = list(destination.rglob('*'))
    if destination.is_symlink() or destination.is_junction() or any(path.is_symlink() or path.is_junction() for path in entries):
        raise ValueError('发布目录不能包含符号链接或目录联接')
    files = {path.relative_to(destination).as_posix() for path in entries if path.is_file()}
    if files != PAYLOAD:
        raise ValueError('发布目录必须只包含程序、运行引导、使用说明和公共模板；不能打包用户数据')
    if (destination / 'Files/Template/Template一.drop').read_bytes() != TEMPLATE.read_bytes():
        raise ValueError('发布示例与公共模板不一致')
    if verify_runtime:
        for name in RUNTIME_FILES:
            if (destination / 'bootstrap' / name).read_bytes() != (ROOT / 'scripts/bootstrap' / name).read_bytes():
                raise ValueError(f'发布运行引导与当前源码不一致: {name}')


def assemble_distribution(destination: Path, launcher: Path, service: Path, template: Path) -> None:
    destination = destination.resolve()
    if not destination.is_relative_to(INSTALLER_ROOT.resolve()) or destination == INSTALLER_ROOT.resolve():
        raise ValueError('打包目标必须位于项目 release 子目录内')
    runtime = [require_file(ROOT / 'scripts/bootstrap' / name, '运行引导') for name in RUNTIME_FILES]
    if destination.exists():
        validate_distribution(destination, verify_runtime=False)
    destination.mkdir(parents=True, exist_ok=True)
    shutil.copy2(launcher, destination / 'DropIt.exe')
    shutil.copy2(service, destination / 'pinboard-service.exe')
    for name in ('Template', 'Save', 'Temporary'):
        (destination / 'Files' / name).mkdir(parents=True, exist_ok=True)
    shutil.copy2(template, destination / 'Files/Template/Template一.drop')
    (destination / 'bootstrap').mkdir(exist_ok=True)
    for source in runtime:
        shutil.copy2(source, destination / 'bootstrap' / source.name)
    (destination / '使用说明.txt').write_text(
        f'{LABEL} 免安装版 / Portable\n\n'
        '解压整个目录后双击 DropIt.exe；首次缺少 WebView2、.NET 或 VC++ x64 运行库时会下载官方组件。\n'
        'Extract the whole folder and open DropIt.exe. Missing Windows components are prepared automatically.\n'
        '首次准备需要联网；系统要求重启时，重启后再打开软件。\n'
        '请保留两份 EXE 和 bootstrap 文件夹，不要仅复制 DropIt.exe。\n'
        '桌面启动进入空白画板，Files/Template 包含公共操作说明模板。\n'
        'Files/Save 保存个人画板，Files/Temporary 保存自动暂存；移动应用时保留整个 Files。\n'
        '运行数据保存在当前用户的 %LOCALAPPDATA%\\InfiniteCanvasNote。\n\n'
        + (ROOT / 'LICENSE').read_text(encoding='utf-8'), encoding='utf-8')


def find_compiler() -> str:
    compiler = os.environ.get('PINBOARD_MAKENSIS') or shutil.which('makensis')
    if not compiler:
        compiler = next((str(path) for path in (
            Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)')) / 'NSIS/makensis.exe',
            Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'NSIS/makensis.exe',
        ) if path.is_file()), None)
    if not compiler:
        raise FileNotFoundError('请安装 NSIS，或将 PINBOARD_MAKENSIS 指向 makensis.exe')
    return str(require_file(Path(compiler), 'NSIS 编译器'))


def nsi_quote(value: str) -> str:
    return value.replace('$', '$$').replace('"', '$\\"')


def installer_source(portable_root: Path, installer: Path) -> str:
    source = (ROOT / 'scripts/installer/dropit.nsi').read_text(encoding='utf-8-sig')
    for key, value in {
        '@VERSION@': VERSION, '@LABEL@': LABEL, '@PORTABLE_ROOT@': str(portable_root),
        '@INSTALLER@': str(installer), '@ICON@': str(ROOT / 'desktop/icons/icon.ico'),
    }.items():
        source = source.replace(key, nsi_quote(value))
    return source


def build_installer(portable_root: Path, installer: Path, compiler: str) -> None:
    validate_distribution(portable_root)
    with tempfile.TemporaryDirectory(prefix='drop-it-installer-') as temporary:
        source = Path(temporary) / 'drop-it.nsi'
        source.write_text(installer_source(portable_root, installer), encoding='utf-8-sig')
        subprocess.run([compiler, '/V2', str(source)], check=True)
    print(f'INSTALLER={installer}')
    print(f'SIZE={installer.stat().st_size}')


def write_checksums(release_dir: Path) -> None:
    lines = []
    for path in (release_dir / PORTABLE_ZIP.name, release_dir / INSTALLER.name):
        if path.is_file():
            with path.open('rb') as stream:
                lines.append(f'{hashlib.file_digest(stream, "sha256").hexdigest()}  {path.name}')
    (release_dir / 'SHA256SUMS.txt').write_text('\n'.join(lines) + '\n', encoding='ascii')


def main(release_dir: Path = INSTALLER_ROOT, *, installer_only: bool = False) -> None:
    release_dir = release_dir.resolve()
    if not release_dir.is_relative_to(INSTALLER_ROOT.resolve()):
        raise ValueError('发布目录必须位于项目 release 目录内')
    portable_root, portable_zip = release_dir / LABEL, release_dir / PORTABLE_ZIP.name
    installer, compiler = release_dir / INSTALLER.name, find_compiler()
    if not installer_only:
        launcher = require_file(ROOT / 'desktop/dist/DropIt.exe', '桌面启动程序')
        service = require_file(ROOT / 'backend/dist/pinboard-service.exe', '后端服务程序')
        assemble_distribution(portable_root, launcher, service, require_file(TEMPLATE, '公共模板'))
        validate_distribution(portable_root)
        with zipfile.ZipFile(portable_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
            for name in sorted(PAYLOAD):
                archive.write(portable_root / name, name)
            for name in ('Files/Save/', 'Files/Temporary/'):
                archive.writestr(name, b'')
    build_installer(portable_root, installer, compiler)
    write_checksums(release_dir)
    print(f'PORTABLE_DIR={portable_root}')
    print(f'PORTABLE_ZIP={portable_zip}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-dir', type=Path, default=INSTALLER_ROOT)
    parser.add_argument('--installer-only', action='store_true', help='Compile a verified existing portable directory')
    args = parser.parse_args()
    main(args.release_dir, installer_only=args.installer_only)

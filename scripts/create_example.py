"""Rebuild the public, text-only example board using only Python's stdlib."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "desktop" / "Template" / "Template一.drop"
SAVED_AT = "2026-11-18T00:00:00"


def example_bytes() -> bytes:
    lessons = [
        (
            "welcome",
            "欢迎使用 DROP-IT / Welcome to DROP-IT",
            "粘贴文字、图片或网页链接来创建卡片。\n"
            "Paste text, images or web links to create cards.\n\n"
            "按 Ctrl+N 新建便签，双击文字即可编辑。\n"
            "Press Ctrl+N for a new note. Double-click text to edit.",
        ),
        (
            "organize",
            "整理与导航 / Organize and navigate",
            "按住空格并拖动以平移，滚动鼠标滚轮以缩放。\n"
            "Hold Space and drag to pan. Use the wheel to zoom.\n\n"
            "框选卡片后按 Ctrl+G 编组，按 Ctrl+K 搜索。\n"
            "Select cards and press Ctrl+G to group. Press Ctrl+K to search.",
        ),
        (
            "save",
            "保存画板 / Save your board",
            "按 Ctrl+S 将画板保存为 .drop 文件。\n"
            "Press Ctrl+S to save your board as a .drop file.\n\n"
            "这是公开的纯文字示例，不包含个人收藏或文件。\n"
            "This public text-only example contains no personal collection or files.",
        ),
    ]
    cards = [
        {
            "id": f"example-{key}",
            "type": "text",
            "x": index * 320,
            "y": 0,
            "width": 280,
            "height": 220,
            "zIndex": index + 1,
            "headerTitle": title,
            "content": body,
            "tags": [],
            "sizeLocked": False,
        }
        for index, (key, title, body) in enumerate(lessons)
    ]
    meta = {
        "version": "1.0",
        "format": "drop",
        "savedAt": SAVED_AT,
        "viewport": {"x": 80, "y": 160, "zoom": 1},
        "cards": cards,
        "groups": [],
        "pins": [],
    }
    meta_bytes = json.dumps(meta, ensure_ascii=False, indent=2).encode("utf-8")
    manifest = {
        "format": 2,
        "app_version": "0.1",
        "saved_at": SAVED_AT,
        "revision": 0,
        "workspace_id": "0" * 32,
        "object_counts": {"cards": len(cards), "groups": 0, "pins": 0},
        "meta_sha256": hashlib.sha256(meta_bytes).hexdigest(),
        "resources": [],
        "min_reader": 1,
    }
    manifest_bytes = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, contents in (("meta.json", meta_bytes), ("manifest.json", manifest_bytes)):
            # Fixed metadata and no compression make regeneration byte-for-byte reproducible.
            entry = zipfile.ZipInfo(name, date_time=(2026, 11, 18, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, contents)
    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="Replace an edited example board")
    args = parser.parse_args()
    contents = example_bytes()
    if TARGET.exists() and TARGET.read_bytes() != contents and not args.force:
        parser.error("The example was edited. Keep a copy, then use --force to replace it.")
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_bytes(contents)
    print(f"Created {TARGET.relative_to(ROOT).as_posix()} ({len(contents)} bytes)")


if __name__ == "__main__":
    main()

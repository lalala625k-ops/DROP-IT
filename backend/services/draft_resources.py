"""Immutable recovery media, independent of live resource pruning."""
import base64
import hashlib
import os
import re
from pathlib import Path
from urllib.parse import unquote
from backend.services.atomic_files import atomic_bytes
from backend.services.data_paths import get_data_dir
from backend.services.workspace_session import board_directory
TEXT_METADATA = frozenset(("content", "title", "sourceTitleUrl", "headerTitle", "url", "description", "author", "tags", "fileSource", "recoveryMedia"))
_resource_dir_cache: dict[tuple[str | None, str | None], tuple[Path, Path]] = {}


def _resource_dirs() -> tuple[Path, Path]:
    """Resolve resource roots once per workspace scope instead of per field."""
    scope = board_directory.get()
    override = os.environ.get("PINBOARD_DATA_DIR")
    key = (str(scope) if scope is not None else None, override)
    cached = _resource_dir_cache.get(key)
    if cached is not None:
        return cached
    base = scope if scope is not None else get_data_dir()
    cached = (base / "assets", base / "screenshots")
    _resource_dir_cache[key] = cached
    return cached


def resource_target(url: str) -> Path | None:
    directories = _resource_dirs()
    for prefix, folder in (("/api/assets/", directories[0]), ("/api/screenshots/", directories[1]),
                           ("/api/thumbnails/assets/", directories[0]),
                           ("/api/thumbnails/screenshots/", directories[1])):
        if url.startswith(prefix):
            name = unquote(url[len(prefix):].split("?", 1)[0].split("#", 1)[0])
            if name and name not in (".", "..") and not any(c in name for c in "/\\:"):
                target = folder / name
                # The name has already been restricted to one path component,
                # so the lexical parent check is sufficient for ordinary files.
                # Path.resolve() invokes Windows' filesystem final-path API and
                # was previously called for every metadata field during open.
                # Only resolve an existing symlink, where the target could
                # actually escape the resource directory.
                if target.is_symlink() and target.resolve().parent != folder.resolve():
                    return None
                return target
    return None


def capture_resources(state: dict, directory: Path, known_resources: dict | None = None) -> tuple[dict, dict]:
    resources = {}
    cache = {}
    def visit(value):
        if isinstance(value, dict):
            return {key: child if key in TEXT_METADATA else visit(child) for key, child in value.items()}
        if isinstance(value, list):
            return [visit(child) for child in value]
        if not isinstance(value, str):
            return value
        if value in cache:
            return cache[value]
        target = resource_target(value)
        if target is not None:
            if not target.is_file():
                raise FileNotFoundError(f"暂存图片缺失：{target.name}")
            known_digest = known_resources.get(value) if known_resources else None
            if isinstance(known_digest, str):
                blob = directory / "resources" / known_digest
                if blob.is_file():
                    resources[value] = known_digest
                    cache[value] = value
                    return value
            contents = target.read_bytes()
            output = value
        elif value.startswith("data:image/") and ";base64," in value:
            header, encoded = value.split(",", 1)
            contents = base64.b64decode(encoded, validate=True)
            extension = header.split("/", 1)[1].split(";", 1)[0]
            extension = extension if re.fullmatch(r"[a-zA-Z0-9+.-]{1,24}", extension) else "png"
            output = f"/api/assets/draft-{hashlib.sha256(contents).hexdigest()}.{extension}"
        else:
            return value
        digest = hashlib.sha256(contents).hexdigest()
        blob = directory / "resources" / digest
        if not blob.is_file():
            atomic_bytes(blob, contents)
        resources[output] = digest
        cache[value] = output
        return output
    return visit(state), resources


def verify_resources(resources: dict, directory: Path) -> None:
    for url, digest in resources.items():
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or resource_target(url) is None:
            raise ValueError("恢复记录的图片索引无效")
        blob = directory / "resources" / digest
        with blob.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                raise ValueError("恢复图片校验失败")


def restore_resources(resources: dict, directory: Path) -> None:
    verify_resources(resources, directory)
    for url, digest in resources.items():
        target = resource_target(url)
        atomic_bytes(target, (directory / "resources" / digest).read_bytes())

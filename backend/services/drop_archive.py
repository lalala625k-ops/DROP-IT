"""Validated .drop reads and explicitly requested, CRC-checked salvage."""
import hashlib
import json
import re
import zipfile
import zlib
from pathlib import PurePosixPath
from backend.services.draft_resources import TEXT_METADATA, resource_target
from backend.services.recovery_inspection import validate_snapshot


class NewerReaderRequired(ValueError):
    pass


def resource_name(name):
    parts = PurePosixPath(name).parts
    return len(parts) == 2 and name == '/'.join(parts) and parts[0] in ('assets', 'screenshots') and parts[1] not in ('.', '..') and not any(c in parts[1] for c in '\\:')


def referenced_urls(state):
    references = set()
    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if key not in TEXT_METADATA:
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, str) and resource_target(value) is not None:
            references.add(value)
    visit(state)
    return references


def read_meta(path, resource_bytes=None):
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('便签包包含重复条目')
        raw = archive.read('meta.json')
        meta = json.loads(raw.decode('utf-8-sig'))
        if not isinstance(meta, dict) or any(not isinstance(meta.get(key, []), list) for key in ('cards', 'groups', 'pins')):
            raise ValueError('便签包中的对象数据无效')
        if 'manifest.json' not in names:
            return meta
        manifest = json.loads(archive.read('manifest.json'))
        if not isinstance(manifest, dict):
            raise ValueError('便签包资源清单无效')
        if manifest.get('min_reader', 1) > 2:
            raise NewerReaderRequired('文件需要更高版本，请升级程序后打开')
        if manifest.get('format') != 2:
            raise ValueError('便签包清单格式不受支持')
        if manifest.get('meta_sha256') != hashlib.sha256(raw).hexdigest():
            raise ValueError('便签包元数据校验失败')
        resources = manifest.get('resources')
        if not isinstance(resources, list):
            raise ValueError('便签包资源清单无效')
        listed = set()
        for item in resources:
            if not isinstance(item, dict) or not isinstance(item.get('path'), str) or not resource_name(item['path']):
                raise ValueError('便签包资源清单无效')
            name = item['path']
            if name in listed:
                raise ValueError('便签包资源清单包含重复资源')
            listed.add(name)
            contents = archive.read(name)
            if type(item.get('size')) is not int or len(contents) != item['size'] or item.get('sha256') != hashlib.sha256(contents).hexdigest():
                raise ValueError(f'便签包资源校验失败：{PurePosixPath(name).name}')
            if resource_bytes is not None:
                resource_bytes[name] = contents
        for url in referenced_urls({key: meta.get(key, []) for key in ('cards', 'groups', 'pins')}):
            target = resource_target(url)
            if f'{target.parent.name}/{target.name}' not in listed:
                raise ValueError(f'便签包资源未列入清单：{target.name}')
        counts = manifest.get('object_counts')
        if counts is not None and counts != {key: len(meta.get(key, [])) for key in ('cards', 'groups', 'pins')}:
            raise ValueError('便签包对象数量校验失败')
        return meta


def read_meta_fast(path):
    """Read and validate the package manifest without reading image bytes.

    Opening a large board should be able to render its cards before every
    image has been copied and hashed.  The manifest structure and references
    are still checked here; each resource's size, CRC and SHA-256 are checked
    by the progressive loader before it is published to the live workspace.
    """
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError('便签包包含重复条目')
        raw = archive.read('meta.json')
        meta = json.loads(raw.decode('utf-8-sig'))
        if not isinstance(meta, dict) or any(not isinstance(meta.get(key, []), list)
                                             for key in ('cards', 'groups', 'pins')):
            raise ValueError('便签包中的对象数据无效')
        manifest_entries = {}
        if 'manifest.json' in names:
            manifest = json.loads(archive.read('manifest.json'))
            if not isinstance(manifest, dict):
                raise ValueError('便签包资源清单无效')
            if manifest.get('min_reader', 1) > 2:
                raise NewerReaderRequired('文件需要更高版本，请升级程序后打开')
            if manifest.get('format') != 2 or manifest.get('meta_sha256') != hashlib.sha256(raw).hexdigest():
                raise ValueError('便签包元数据校验失败')
            resources = manifest.get('resources')
            if not isinstance(resources, list):
                raise ValueError('便签包资源清单无效')
            for item in resources:
                if not isinstance(item, dict) or not isinstance(item.get('path'), str) or not resource_name(item['path']):
                    raise ValueError('便签包资源清单无效')
                name = item['path']
                if name in manifest_entries:
                    raise ValueError('便签包资源清单包含重复资源')
                if type(item.get('size')) is not int or not isinstance(item.get('sha256'), str):
                    raise ValueError('便签包资源清单无效')
                manifest_entries[name] = {'size': item['size'], 'sha256': item['sha256']}
            counts = manifest.get('object_counts')
            if counts is not None and counts != {key: len(meta.get(key, [])) for key in ('cards', 'groups', 'pins')}:
                raise ValueError('便签包对象数量校验失败')
        for url in referenced_urls({key: meta.get(key, []) for key in ('cards', 'groups', 'pins')}):
            target = resource_target(url)
            name = f'{target.parent.name}/{target.name}'
            if 'manifest.json' in names and name not in manifest_entries:
                raise ValueError(f'便签包资源未列入清单：{target.name}')
            if name not in names:
                raise ValueError(f'便签包资源缺失：{target.name}')
        return meta, manifest_entries


def _partial_meta(raw):
    try:
        value = json.loads(raw)
        if isinstance(value, dict):
            return value
    except (ValueError, UnicodeError):
        pass
    text = raw.decode('utf-8-sig', errors='replace')
    result = {}
    decoder = json.JSONDecoder()
    for key in ('cards', 'groups', 'pins'):
        match = re.search(r'"' + key + r'"\s*:\s*\[', text)
        if not match:
            continue
        items, index = [], match.end()
        while index < len(text):
            while index < len(text) and text[index] in ' \r\n\t,':
                index += 1
            if index >= len(text) or text[index] == ']':
                break
            try:
                item, index = decoder.raw_decode(text, index)
                items.append(item)
            except ValueError:
                break
        result[key] = items
    return result


def archive_state(path, salvage=False):
    """Return independent data and bytes; never extract into the live board."""
    warnings = []
    verified = {}
    if salvage:
        # Do not use salvage to bypass a newer writer's compatibility gate.
        with zipfile.ZipFile(path) as archive:
            if 'manifest.json' in archive.namelist():
                try:
                    manifest = json.loads(archive.read('manifest.json'))
                except (ValueError, zipfile.BadZipFile, zlib.error):
                    manifest = {}
                if isinstance(manifest, dict) and manifest.get('min_reader', 1) > 2:
                    raise NewerReaderRequired('文件需要更高版本，请升级程序后打开')
            meta = _partial_meta(archive.read('meta.json'))
        warnings.append('抢救模式忽略清单校验，仅保留可解析对象和 CRC 正确的资源')
    else:
        meta = read_meta(path, verified)
    state = {key: meta.get(key, [] if key != 'viewport' else None) for key in ('cards', 'groups', 'pins', 'viewport')}
    if salvage:
        for key in ('cards', 'groups', 'pins'):
            valid, ids = [], set()
            for item in state[key] if isinstance(state[key], list) else []:
                sample = {'cards': [], 'groups': [], 'pins': [], 'viewport': None}
                sample[key] = [item]
                try:
                    validate_snapshot({'format': 'drop-draft-v1', 'workspace_id': '0' * 32, 'state': sample, 'resources': {}})
                    if item['id'] in ids:
                        raise ValueError('重复对象')
                    ids.add(item['id']); valid.append(item)
                except (ValueError, TypeError, KeyError):
                    warnings.append(f'跳过无效的 {key} 对象')
            state[key] = valid
        try:
            validate_snapshot({'format': 'drop-draft-v1', 'workspace_id': '0' * 32, 'state': state, 'resources': {}})
        except (ValueError, TypeError):
            state['viewport'] = None
        if not any(state[key] for key in ('cards', 'groups', 'pins')):
            raise ValueError('未找到可抢救的完整对象')
    references = referenced_urls(state)
    blobs, missing = {}, []
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        for url in references:
            target = resource_target(url)
            name = f'{target.parent.name}/{target.name}'
            try:
                if names.count(name) != 1 or not resource_name(name):
                    raise ValueError('资源条目缺失或重复')
                blobs[url] = verified[name] if name in verified else archive.read(name)  # CRC checked on first read.
            except (KeyError, OSError, ValueError, zipfile.BadZipFile, zlib.error) as error:
                missing.append({'url': url, 'reason': str(error)})
    return state, blobs, missing, warnings, meta.get('savedAt')

# 公共示例 / Public example

`Template一.drop` 包含三张中英文操作说明卡片，没有个人收藏、图片、外部链接或本机文件引用。它是桌面发布包的固定示例资源。

`Template一.drop` contains three bilingual instruction cards, with no personal collection, images, external links or local-file references. It is the designated example resource for desktop packaging.

在项目根目录重新生成 / Regenerate from the repository root:

```powershell
python scripts/create_example.py
```

生成结果可逐字节复现。若示例被编辑，脚本会拒绝覆盖；保留副本后可加 `--force` 重新生成。

Generation is byte-for-byte reproducible. The script refuses to overwrite an edited example; keep a copy before using `--force` to replace it.

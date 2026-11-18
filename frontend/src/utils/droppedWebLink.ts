import { extractClipboardUrls, isClipboardImageUrl } from './clipboardImageSource';

export interface DroppedWebLink { url: string; title?: string }

function httpUrl(value: string): string | undefined {
  if (!/^https?:\/\//i.test(value) || /[\s\0]/.test(value)) return;
  try {
    const url = new URL(value);
    if (url.hostname && !url.username && !url.password) return url.href;
  } catch { /* Invalid shortcuts remain ordinary files. */ }
}

/** A browser can materialize a dragged page as a small Windows InternetShortcut. */
export async function readDroppedWebLink(data: Pick<DataTransfer, 'getData'>, file: File): Promise<DroppedWebLink | null> {
  const html = data.getData('text/html') || '';
  if (html && typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      for (const anchor of Array.from(doc.querySelectorAll('a[href]'))) {
        const url = httpUrl(anchor.getAttribute('href') || '');
        if (url && !isClipboardImageUrl(url)) {
          const title = anchor.textContent?.trim().slice(0, 200);
          return { url, ...(title && title !== url ? { title } : {}) };
        }
      }
    } catch { /* Try the text representations or the shortcut contents. */ }
  }
  const urls = extractClipboardUrls([data.getData('text/uri-list'), data.getData('text/plain')].filter(Boolean).join('\n'));
  const explicit = urls.find(url => !isClipboardImageUrl(url) && httpUrl(url));
  if (explicit) return { url: explicit };

  // Do not infer a URL from the temporary file name, or read arbitrary documents.
  if (!/\.(download|url)$/i.test(file.name) || file.size <= 0 || file.size > 16 * 1024) return null;
  try {
    const content = await file.text();
    let section = '', url: string | undefined;
    for (const line of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const entry = line.trim();
      if (!entry || /^[;#]/.test(entry)) continue;
      if (/^\[.*\]$/.test(entry)) { section = entry.toLowerCase(); continue; }
      if (section !== '[internetshortcut]') continue;
      const match = entry.match(/^URL\s*=\s*(.*)$/i);
      if (!match) continue;
      const candidate = httpUrl(match[1]);
      if (!candidate || (url && url !== candidate)) return null;
      url = candidate;
    }
    return url ? { url } : null;
  } catch { return null; }
}

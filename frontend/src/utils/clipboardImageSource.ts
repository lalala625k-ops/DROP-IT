import { readCarriedArticleSource, readHtmlSourceDocument } from './droppedArticleSource';

export interface ClipboardImageSource {
  url: string;
  title?: string;
}

function toHttpUrl(value: string): string {
  if (!value) return '';
  try {
    const base = typeof document !== 'undefined' && document.baseURI ? document.baseURI : undefined;
    const url = base ? new URL(value.trim(), base) : new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function isImageUrl(value: string): boolean {
  try { return /\.(?:png|jpe?g|gif|webp|avif|bmp|svg)(?:$|[?#])/i.test(new URL(value).pathname); }
  catch { return false; }
}

/**
 * Extract HTTP(S) URLs from clipboard/drag text.  `text/uri-list` is allowed
 * to contain comment lines beginning with `#`, and some browsers append a
 * trailing punctuation mark when they put a URL in `text/plain`.
 */
export function extractClipboardUrls(value: string): string[] {
  if (!value) return [];
  const matches = value.split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')
    .match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  const urls: string[] = [];
  for (const match of matches) {
    const candidate = match.replace(/[),.;:!?\]}>'"]+$/g, '');
    const url = toHttpUrl(candidate);
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}

/** URLs that are likely to be the image bytes in a drag payload. */
export function isClipboardImageUrl(value: string): boolean {
  return isImageUrl(value);
}

/** Read the URL carried beside an image in rich clipboard HTML. */
export function readClipboardImageSource(html: string, plainText: string): ClipboardImageSource | null {
  let anchorUrl = '';
  let anchorTitle = '';
  if (html && typeof DOMParser !== 'undefined') {
    try {
      const document = new DOMParser().parseFromString(html, 'text/html');
      const anchor = Array.from(document.querySelectorAll('a[href]'))
        .map((item) => ({ item, url: toHttpUrl(item.getAttribute('href') || '') }))
        .find(({ url }) => !!url && !isImageUrl(url));
      if (anchor) {
        anchorUrl = anchor.url;
        const text = anchor.item.textContent?.trim() || '';
        if (text && text !== anchorUrl) anchorTitle = text.slice(0, 200);
      }
    } catch {
      // Fall through to the plain URL representation.
    }
  }
  // Prefer a non-image URL from either representation.  This covers
  // `text/uri-list` values such as "# source\nhttps://example.com/story" and
  // payloads where `text/plain` contains the image URL while uri-list carries
  // the page URL.
  const plainUrl = extractClipboardUrls(plainText).find((candidate) => !isImageUrl(candidate)) || '';
  const url = anchorUrl || plainUrl;
  return url ? { url, ...(anchorTitle ? { title: anchorTitle } : {}) } : null;
}

/** Preserve the remote image address when a drag carries no content-page URL. */
export function readDroppedImageSource(html: string, plainText: string, carriedSource = ''): ClipboardImageSource | null {
  const textUrls = extractClipboardUrls(plainText);
  let imageUrl = '';
  let htmlSource = '';
  let page: ClipboardImageSource | null = null;
  if (html && typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const src = doc.querySelector('img[src]')?.getAttribute('src') || '';
      htmlSource = doc.querySelector('img[data-dropit-image-source]')?.getAttribute('data-dropit-image-source') || '';
      // Relative image paths belong to the source page, not this canvas.
      if (/^https?:\/\//i.test(src)) imageUrl = toHttpUrl(src);
      else if (/^(data:image\/|blob:https?:\/\/)/i.test(src)) imageUrl = src;
      const carried = readCarriedArticleSource(carriedSource, imageUrl, textUrls)
        || readCarriedArticleSource(htmlSource, imageUrl, textUrls);
      if (carried) return carried;
      const anchor = Array.from(doc.querySelectorAll('a[href]')).map(item => ({
        item, url: /^https?:\/\//i.test(item.getAttribute('href') || '') ? toHttpUrl(item.getAttribute('href') || '') : '',
      })).find(({ url }) => url && url !== imageUrl && !isImageUrl(url));
      if (anchor) {
        const title = anchor.item.textContent?.trim();
        page = { url: anchor.url, ...(title && title !== anchor.url ? { title: title.slice(0, 200) } : {}) };
      }
    } catch { /* Fall back to the explicit remote image URL. */ }
  }
  const carried = readCarriedArticleSource(carriedSource, imageUrl, textUrls);
  if (carried) return carried;
  const pageUrl = textUrls.find(candidate => candidate !== imageUrl && !isImageUrl(candidate));
  if (page || pageUrl) return page || { url: pageUrl! };
  const documentUrl = imageUrl && readHtmlSourceDocument(html);
  if (documentUrl) return { url: documentUrl };
  const url = (/^https?:\/\//i.test(imageUrl) ? imageUrl : '') || textUrls.find(isClipboardImageUrl);
  return url ? { url } : null;
}

import type { ClipboardImageSource } from './clipboardImageSource';

export const DROPPED_IMAGE_SOURCE_MIME = 'application/x-dropit-image-source+json';

function absoluteWebUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

/** The source travels with this exact image, never with browser history. */
export function readCarriedArticleSource(payload: string, image: string, textUrls: string[]): ClipboardImageSource | null {
  if (!payload || payload.length > 32768) return null;
  try {
    const data = JSON.parse(payload);
    if (data?.version !== 1 || typeof data.imageUrl !== 'string') return null;
    const imageUrl = absoluteWebUrl(data.imageUrl) || (/^(data:image\/|blob:https?:\/\/)/i.test(data.imageUrl) ? data.imageUrl : '');
    if (!imageUrl || (image ? imageUrl !== image : !textUrls.includes(imageUrl))) return null;
    const url = absoluteWebUrl(data.sourceUrl);
    return url ? { url } : null;
  } catch { return null; }
}

/** Native CF_HTML may explicitly name the document that supplied the fragment. */
export function readHtmlSourceDocument(html: string): string {
  const header = html.slice(0, html.indexOf('<') < 0 ? 0 : html.indexOf('<'));
  if (!/^Version:\d+(?:\.\d+)?\r?\n/i.test(header)) return '';
  return absoluteWebUrl(header.match(/^SourceURL:(https?:\/\/[^\r\n]+)\r?$/im)?.[1]);
}

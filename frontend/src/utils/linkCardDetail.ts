import type { Card } from '../types';

export function videoCardPlatform(url?: string): 'bilibili' | 'youtube' | undefined {
  try {
    const { protocol, hostname: host, pathname, searchParams } = new URL(url || '');
    if (!/^https?:$/.test(protocol)) return undefined;
    const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if ((matches('bilibili.com') && /^\/video\/(?:BV|av)/i.test(pathname)) || matches('b23.tv')) return 'bilibili';
    if (matches('youtu.be') || (matches('youtube.com') &&
      ((pathname === '/watch' && searchParams.has('v')) || /^\/(shorts|embed)\//.test(pathname)))) return 'youtube';
  } catch { /* No video source. */ }
  return undefined;
}

export function linkCardDetail(card: Card) {
  if (card.type !== 'web') return { text: '', tooltip: '' };
  let host = '';
  try { host = new URL(card.url || '').hostname.toLowerCase(); } catch { /* No source URL. */ }
  const videoSite = ['bilibili.com', 'b23.tv', 'youtube.com', 'youtu.be']
    .some(domain => host === domain || host.endsWith(`.${domain}`));
  const description = card.description?.trim() || '';
  if (!videoSite) {
    const text = description || card.content?.trim() || '';
    return { text, tooltip: text };
  }
  // Older YouTube cards stored only this author string, without a synopsis.
  const legacyAuthor = /^(?:UP主\s*\/\s*频道):\s*(.+)$/u.exec(description);
  return {
    text: card.author?.trim() || legacyAuthor?.[1] || '',
    tooltip: legacyAuthor ? '' : description,
  };
}

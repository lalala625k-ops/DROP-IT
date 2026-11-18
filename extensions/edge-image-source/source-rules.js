// Shared by the MV3 module and isolated-world content scripts (no build step).
(() => {
  function webUrl(value, base) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      const url = new URL(value.trim(), base);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      return url.href;
    } catch { return ''; }
  }

  function resolveSource(info, details, tab) {
    const pageUrl = webUrl(info.frameUrl) || webUrl(info.pageUrl) || webUrl(tab?.url);
    if (!pageUrl) throw new Error('请在普通 HTTP 或 HTTPS 网页的图片上使用此功能。');
    const imageUrls = [info.srcUrl, ...(info.imageUrls || [])].map(value => webUrl(value, pageUrl));
    const link = webUrl(info.linkUrl, pageUrl);
    const isImageLink = link && (imageUrls.includes(link)
      || /^image\//i.test(info.linkType || '')
      || /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i.test(new URL(link).pathname));
    const sameDocument = link && link.split('#')[0] === pageUrl.split('#')[0];
    const xhsNote = value => {
      if (!value) return '';
      const url = new URL(value);
        return ['xiaohongshu.com', 'www.xiaohongshu.com'].includes(url.hostname)
        ? url.pathname.match(/^\/(?:explore|discovery\/item|search_result)\/([0-9a-f]{24})\/?$/i)?.[1].toLowerCase() || '' : '';
    };
    const currentNote = xhsNote(pageUrl);
    // XHS canonical deliberately drops xsec_token. On the same note retain
    // the gesture's full document URL; never transfer its token to another ID.
    if (currentNote && (!link || isImageLink || sameDocument || xhsNote(link) === currentNote)) {
      const signedLink = link && xhsNote(link) === currentNote && new URL(link).searchParams.get('xsec_token');
      const sourceUrl = signedLink ? link : pageUrl;
      return { pageUrl, sourceUrl, sourceKind: '当前小红书笔记' };
    }
    if (link && !isImageLink && !sameDocument) {
      return { pageUrl, sourceUrl: link, sourceKind: '图片指向的网页' };
    }
    const canonical = webUrl(details?.canonical, pageUrl);
    if (canonical && webUrl(details?.pageUrl) === pageUrl && new URL(canonical).origin === new URL(pageUrl).origin) {
      return { pageUrl, sourceUrl: canonical, sourceKind: '当前网页的正式地址' };
    }
    return { pageUrl, sourceUrl: pageUrl, sourceKind: '当前网页' };
  }

  globalThis.DropItImageSourceRules = Object.freeze({ webUrl, resolveSource });
})();

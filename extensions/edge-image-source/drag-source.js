(() => {
  const { webUrl, resolveSource } = globalThis.DropItImageSourceRules;
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  // Read the current document at the gesture, including after SPA navigation.
  // Keep the native image/file formats and never wait for a network request.
  document.addEventListener('dragstart', event => {
    if (!event.isTrusted || !event.dataTransfer) return;
    const image = event.composedPath().find(node => node instanceof HTMLImageElement);
    if (!image) return;
    const data = event.dataTransfer;
    if (Array.from(data.types).some(type => type.replace(/^web /, '') === 'application/x-infinite-canvas+json')
      || data.getData('text/html').includes('data-infinite-canvas-clipboard')) return;
    const imageUrl = image.currentSrc || image.src;
    if (!/^(https?:\/\/|data:image\/|blob:)/i.test(imageUrl)) return;
    try {
      const link = image.closest('a[href]');
      const base = document.baseURI;
      const imageUrls = [image.src, image.currentSrc];
      // srcset candidates identify extensionless full-size image targets too.
      for (const node of [image, ...Array.from(image.closest('picture')?.querySelectorAll('source[srcset]') || [])]) {
        for (const candidate of (node.getAttribute('srcset') || '').split(',')) {
          const value = candidate.trim().split(/\s+/)[0];
          if (value && !value.startsWith('data:')) imageUrls.push(webUrl(value, base));
        }
      }
      const { sourceUrl } = resolveSource({
        pageUrl: location.href, srcUrl: imageUrl, imageUrls,
        linkUrl: webUrl(link?.getAttribute('href'), base), linkType: link?.getAttribute('type'),
      }, { pageUrl: location.href, canonical: webUrl(document.querySelector('link[rel~="canonical"]')?.getAttribute('href'), base) });
      const payload = JSON.stringify({ version: 1, imageUrl, sourceUrl });
      // HTML survives cross-application drags where Chromium drops custom MIME.
      data.setData('text/html', `<img src="${escape(imageUrl)}" data-dropit-image-source="${escape(payload)}">`);
      data.setData('application/x-dropit-image-source+json', payload);
    } catch { /* Unsupported/read-only transfer: keep the original native drag. */ }
  }, true);
})();

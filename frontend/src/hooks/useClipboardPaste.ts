import { useCallback } from 'react';
import { Card } from '../types';
import { CanvasClipboardSnapshot, normalizeClipboardText } from '../utils/canvasClipboard';
import { CANVAS_CLIPBOARD_MIME, hasCanvasClipboardPayload, readClipboardSnapshot } from '../utils/canvasClipboardTransport';
import { ingestScreenshot } from '../utils/ingestScreenshot';
import { isFeishuUrl, FEISHU_LOGO_URLS } from '../utils/feishu';
import { readPinterestTransfer } from '../utils/pinterestTransfer';
import { extractClipboardUrls, isClipboardImageUrl, readClipboardImageSource, readDroppedImageSource } from '../utils/clipboardImageSource';
import { cacheRemoteImage } from '../utils/remoteImage';
import { CARD_SOURCE_HEIGHT, IMAGE_SOURCE_HEIGHT, LINK_CARD_FOOTER_HEIGHT, LINK_CARD_DEFAULT_WIDTH } from '../utils/cardLayout';
import { droppedFileSource, filePreview, readNativeClipboardImage, sourceCardUpdates, validFileSource } from '../utils/fileSource';
import { readDroppedWebLink } from '../utils/droppedWebLink';
import { DROPPED_IMAGE_SOURCE_MIME } from '../utils/droppedArticleSource';
import { ingestDroppedImage } from '../utils/ingestDroppedImage';
import { getWorkspaceId } from '../utils/workspaceApi';
import { fetchLinkMetadata } from '../utils/linkMetadata';

interface UseClipboardPasteProps {
  createCardAtCursor: (cardData: Partial<Card>) => Card;
  updateCard: (id: string, updates: Partial<Card>) => void;
  showToast?: (msg: string) => void;
  stageCopiedObjects?: (snapshot: CanvasClipboardSnapshot) => void;
  getCopiedObjects?: () => CanvasClipboardSnapshot;
  hasCanvasMultiSelection?: boolean;
  getWorldPosition: () => { x: number; y: number };
  getCardById: (id: string) => Card | undefined;
}

async function readSystemClipboardTransfer(): Promise<DataTransfer | undefined> {
  // Prefer the browser clipboard API because WebView2 can expose the native
  // clipboard contents even when the trusted paste event has no dataTransfer.
  try {
    const items = navigator.clipboard?.read ? await navigator.clipboard.read() : [];
    const data = new DataTransfer();
    for (const item of items) {
      for (const type of item.types) {
        if (!['text/plain', 'text/html', 'text/uri-list', CANVAS_CLIPBOARD_MIME].includes(type)
          && !type.startsWith('image/')) continue;
        try {
          const blob = await item.getType(type);
          if (type.startsWith('image/')) data.items.add(new File([blob], 'pasted-image', { type: blob.type || type }));
          else data.setData(type, await blob.text());
        } catch {
          // One denied representation should not discard the other clipboard
          // types (for example, text/plain alongside a protected HTML item).
        }
      }
    }
    if (data.items.length) return data;
  } catch {
    // Fall through to readText/native image. WebView2 may deny navigator.clipboard
    // even while delivering a trusted paste event.
  }

  try {
    const text = (await navigator.clipboard?.readText?.())?.trim();
    if (text) {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      return data;
    }
  } catch {
    // Fall through to the desktop bridge for native image clipboard data.
  }

  const nativeImage = await readNativeClipboardImage();
  if (!nativeImage) return;
  const blob = await (await fetch(nativeImage)).blob();
  const data = new DataTransfer();
  data.items.add(new File([blob], 'pasted-image.png', { type: blob.type || 'image/png' }));
  return data;
}

function hasImageData(data: DataTransfer | undefined): boolean {
  return !!data && Array.from(data.items).some((item) => item.type.startsWith('image/'));
}

function hasUsableClipboardData(data: DataTransfer | undefined): boolean {
  if (!data) return false;
  if (Array.from(data.items).some((item) =>
    item.type === 'text/plain' || item.type === 'text/html' || item.type === 'text/uri-list'
      || item.type === CANVAS_CLIPBOARD_MIME || item.type.startsWith('image/'))) return true;
  return !!(data.getData('text/plain') || data.getData('text/html') || data.getData('text/uri-list'));
}

export function useClipboardPaste({
  createCardAtCursor,
  updateCard,
  showToast,
  stageCopiedObjects,
  getCopiedObjects,
  hasCanvasMultiSelection,
  getWorldPosition,
  getCardById,
}: UseClipboardPasteProps) {
  const handleDataTransfer = useCallback(
    async (clipboardData: DataTransfer, fromClipboard = false, dropTime?: number) => {
      const snapshot = readClipboardSnapshot(clipboardData);
      if (snapshot && stageCopiedObjects) {
        stageCopiedObjects(snapshot);
        return;
      }
      if (!snapshot && hasCanvasClipboardPayload(clipboardData)) {
        showToast?.('便签数据读取失败，请重新复制');
        return;
      }
      const pinterest = readPinterestTransfer(clipboardData);
      const pinterestImage = pinterest?.kind === 'image';
      const plainText = normalizeClipboardText(clipboardData.getData('text/plain') || '');
      const uriList = normalizeClipboardText(clipboardData.getData('text/uri-list') || '');
      // Browsers commonly put the image URL in text/plain and a page URL in
      // text/uri-list (or prefix uri-list with comment lines). Keep both
      // representations available so the image card can retain the page URL.
      const transferText = [plainText, uriList].filter(Boolean).join('\n');
      const rawText = pinterest?.url || plainText || extractClipboardUrls(uriList)[0] || uriList;
      const html = clipboardData.getData('text/html') || '';
      const imageSource = pinterest && (!fromClipboard || pinterestImage) ? { url: pinterest.url, title: undefined }
        : !pinterest ? (fromClipboard ? readClipboardImageSource(html, transferText || rawText)
          : readDroppedImageSource(html, transferText || rawText, clipboardData.getData(DROPPED_IMAGE_SOURCE_MIME))) : null;
      const sourceTitle = imageSource?.title;

      const items = Array.from(clipboardData.items);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      const file = (!fromClipboard || !pinterest) && (imageItem?.getAsFile() || Array.from(clipboardData.files).find((item) =>
        item.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(item.name)));
      const anyFile = file || (!pinterest && Array.from(clipboardData.files)[0]);
      const fileDropPosition = anyFile && !file ? { ...getWorldPosition() } : undefined;
      // Detect a supplied image before interpreting a browser's accompanying
      // non-image temporary file as a webpage shortcut.
      let imageUrl = pinterest && (!fromClipboard || pinterestImage) ? pinterest.image || '' : '';
      const transferUrls = extractClipboardUrls(transferText || rawText);
      const directUrl = transferUrls.find(isClipboardImageUrl) || '';
      if (!file && (!anyFile || !fromClipboard) && html && (!fromClipboard || !pinterest)) {
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const source = doc.querySelector('img[src]')?.getAttribute('src') || '';
          // A copied webpage can embed a preview; keep the clipboard's image
          // evidence checks while accepting images carried by a browser drag.
          if (/^(https?:\/\/|data:image\/)/i.test(source) &&
            (directUrl === source || transferUrls.includes(source) || !!imageSource || (!transferText && !doc.querySelector('a[href]')))) imageUrl = source;
        } catch { /* Use the text URL below. */ }
      }
      if ((!anyFile || !fromClipboard) && (!fromClipboard || !pinterest) && !imageUrl && directUrl) imageUrl = directUrl;
      const droppedWebLink = !fromClipboard && anyFile && !file && !imageUrl ? await readDroppedWebLink(clipboardData, anyFile) : null;
      const text = droppedWebLink?.url || rawText;
      if (!anyFile && !text && !html) return;

      const performPaste = async () => {
      // Non-image files get the same large canvas treatment as images: a
      // preview panel with the file name and a compact, clickable source row.
      if (anyFile && !file && !droppedWebLink && !imageUrl) {
          const position = fileDropPosition!;
          const created = createCardAtCursor({
            type: 'file', title: anyFile.name || '本地文件', width: 360, height: 240,
            x: position.x - 180, y: position.y - 120,
          });
          const pending = !fromClipboard ? droppedFileSource(anyFile, dropTime) : undefined;
          if (pending) {
            void pending.then(source => {
              if (!validFileSource(source)) return;
              const current = getCardById(created.id);
              if (!current || current.id !== created.id || current.type !== 'file'
                || current.fileSource || current.url || current.title !== (anyFile.name || '本地文件')) return;
              updateCard(created.id, sourceCardUpdates(current, source));
              void filePreview(source.path).then(preview => {
                if (!preview) return;
                const latest = getCardById(created.id);
                if (latest?.id === created.id && latest.type === 'file' && latest.fileSource?.path === source.path
                  && !latest.image && !latest.url) updateCard(created.id, { image: preview });
              });
            });
          }
          return;
      }
      // 1. Image
      if (file) {
          const position = { ...getWorldPosition() };
          const localSource = !fromClipboard && !imageSource ? droppedFileSource(file, dropTime) : undefined;
          await ingestScreenshot(file, {
            createCard: createCardAtCursor,
            updateCard,
            getCard: getCardById,
            showToast: (message) => showToast?.(message),
            position,
            initialWidth: fromClipboard ? undefined : LINK_CARD_DEFAULT_WIDTH,
            sourceUrl: imageSource?.url,
            sourceTitle,
            pendingFileSource: localSource,
            // A trusted screenshot paste may also expose HTML/text in WebView2.
            // Keep the native screenshot lookup enabled; a non-screenshot image
            // simply produces no match and retains the existing paste behavior.
            matchClipboardSource: fromClipboard,
          });
          return;
      }

      // Without file bytes, cache only the image URL supplied by the drag.
      if (imageUrl.startsWith('data:image/')) {
        try {
          const blob = await (await fetch(imageUrl)).blob();
          await ingestScreenshot(new File([blob], 'pasted-image', { type: blob.type || 'image/png' }), {
            createCard: createCardAtCursor,
            updateCard,
            getCard: getCardById,
            showToast: (message) => showToast?.(message),
            position: { ...getWorldPosition() },
            initialWidth: fromClipboard ? undefined : LINK_CARD_DEFAULT_WIDTH,
            sourceUrl: imageSource?.url,
            sourceTitle,
            matchClipboardSource: false, // HTML data URLs are not screenshot clipboard images.
          });
        } catch {
          showToast?.('图片读取失败');
        }
        return;
      }
      if (imageUrl) {
        if (!fromClipboard) {
          await ingestDroppedImage(imageUrl, {
            createCard: createCardAtCursor, updateCard, getCard: getCardById,
            showToast: message => showToast?.(message), position: { ...getWorldPosition() },
            sourceUrl: imageSource?.url, sourceTitle, matchClipboardSource: false,
          });
          return;
        }
        const cached = await cacheRemoteImage(imageUrl, imageSource?.url);
        const sourceUrl = imageSource?.url || imageUrl;
        const created = createCardAtCursor({ type: 'image', image: cached?.image, thumbnail: cached?.thumbnail,
          url: sourceUrl, title: sourceTitle, width: 360, height: 240 });
        if (!cached) {
          showToast?.('图片暂时无法保存，已保留来源链接');
          return;
        }
        const image = new Image();
        image.onload = () => {
          if (image.naturalWidth && image.naturalHeight) {
            updateCard(created.id, { height: Math.round(360 * image.naturalHeight / image.naturalWidth + (sourceUrl ? IMAGE_SOURCE_HEIGHT : 0)) });
          }
        };
        image.src = cached.image;
        return;
      }

      // 2. URL or Plain Text
      let targetUrl = '';
      let targetTitle = droppedWebLink?.title || '';

      if (text) {
        const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
        if (urlMatch) {
          targetUrl = urlMatch[1];
          let cleaned = text.replace(targetUrl, '').trim();
          cleaned = cleaned.replace(/^[:：\-—\s]+|[:：\-—\s]+$/g, '').trim();
          // Strip wrapping brackets like 《...》 or 【...】 without deleting the title inside
          const bracketMatch = cleaned.match(/^[《【\["“](.*?)[》】\]"”]$/);
          if (bracketMatch) {
            cleaned = bracketMatch[1].trim();
          }
          if (cleaned && cleaned.length < 120) {
            targetTitle = cleaned;
          }
        }
      }

      if (html && !targetUrl) {
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const anchor = doc.querySelector('a[href]');
          if (anchor) {
            const href = anchor.getAttribute('href');
            if (href && /^https?:\/\//i.test(href)) {
              targetUrl = href;
              const aText = anchor.textContent?.trim();
              if (aText) targetTitle = aText;
            }
          }
        } catch {
          // ignore html parse error
        }
      }

      // Valid URL
      if (targetUrl && (droppedWebLink || !text || text.length < 500)) {
        const feishu = isFeishuUrl(targetUrl);
        const initialTitle = targetTitle || targetUrl;
        const created = createCardAtCursor({
          type: pinterestImage ? 'image' : 'web',
          url: targetUrl,
          title: initialTitle,
          width: pinterestImage && fromClipboard ? 360 : LINK_CARD_DEFAULT_WIDTH,
          height: 200,
          ...(droppedWebLink && fileDropPosition ? { x: fileDropPosition.x - 140, y: fileDropPosition.y - 100 } : {}),
          isParsing: true,
          favicon: feishu ? FEISHU_LOGO_URLS[0] : undefined,
        });

        const sourceHeight = pinterestImage ? IMAGE_SOURCE_HEIGHT : LINK_CARD_FOOTER_HEIGHT;
        const workspace = getWorkspaceId();
        const originalType = created.type;
        let expectedImage = created.image;
        let automaticTitle = created.title;
        let automaticHeight = created.height;
        const originalWidth = created.width;
        const updateLink = (_id: string, changes: Partial<Card>) => {
          const current = getCardById(created.id);
          if (getWorkspaceId() !== workspace || !current || current.type !== originalType
            || current.url !== targetUrl || current.image !== expectedImage) return;
          const next = { ...changes };
          if (current.title !== automaticTitle) delete next.title;
          if (current.sizeLocked || current.width !== originalWidth || current.height !== automaticHeight) delete next.height;
          if (next.title !== undefined) automaticTitle = next.title;
          if (next.height !== undefined) automaticHeight = next.height;
          if (next.image !== undefined) expectedImage = next.image;
          updateCard(created.id, next);
        };
        const keepPinterestPreview = async (updates: Partial<Card> = {}) => {
          if (!pinterest?.image) return false;
          const cached = await cacheRemoteImage(pinterest.image, targetUrl);
          if (!cached) {
            updateLink(created.id, { ...updates, image: '', thumbnail: undefined, height: 90, isParsing: false });
            showToast?.('链接已添加，预览图暂不可读');
            return true;
          }
          const preview = new Image();
          let finished = false;
          const finish = (readable: boolean) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            updateLink(created.id, { ...updates, image: readable ? cached.image : '',
              thumbnail: readable ? cached.thumbnail : undefined,
              height: readable ? Math.round(created.width * preview.naturalHeight / preview.naturalWidth + sourceHeight) : 90,
              isParsing: false });
            if (!readable) showToast?.('链接已添加，预览图暂不可读');
          };
          const timer = setTimeout(() => finish(false), 10000);
          preview.referrerPolicy = 'no-referrer';
          preview.onload = () => finish(!!preview.naturalWidth && !!preview.naturalHeight);
          preview.onerror = () => finish(false);
          preview.src = cached.image;
          return true;
        };

        try {
          const meta = await fetchLinkMetadata(targetUrl, partial => {
            const title = typeof partial.title === 'string' && partial.title.trim() !== targetUrl ? partial.title.trim() : '';
            updateLink(created.id, {
              ...(title ? { title } : {}),
              ...(typeof partial.description === 'string' ? { description: partial.description } : {}),
              ...(typeof partial.author === 'string' ? { author: partial.author } : {}),
              ...(feishu ? { favicon: FEISHU_LOGO_URLS[0] }
                : typeof partial.favicon === 'string' ? { favicon: partial.favicon } : {}),
            });
          });
          const clipboardTitle = targetTitle && targetTitle !== targetUrl ? targetTitle : '';
          const parsedTitle = typeof meta.title === 'string' && meta.title.trim() !== targetUrl ? meta.title.trim() : '';
          const finalTitle = parsedTitle || clipboardTitle || initialTitle;

          if (feishu) {
            updateLink(created.id, { title: finalTitle, image: '',
              description: meta.description || '', favicon: FEISHU_LOGO_URLS[0],
              height: 90, isParsing: false });
            return;
          }

          if (meta.image) {
            const cached = await cacheRemoteImage(meta.image, targetUrl);
            if (!cached) {
              if (await keepPinterestPreview({ title: finalTitle, description: meta.description || '',
                favicon: meta.favicon || '' })) return;
              updateLink(created.id, { title: finalTitle, image: '', thumbnail: undefined,
                description: meta.description || '', favicon: meta.favicon || '', height: 90, isParsing: false });
              showToast?.('头图无法保存，已保留链接');
              return;
            }
            const img = new Image();
            img.referrerPolicy = 'no-referrer';
            let isHandled = false;
            const finishWithImage = () => {
              if (isHandled) return;
              isHandled = true;
              const ratio = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : (16 / 9);
              const imgHeight = created.width / ratio;
              const footerHeight = sourceHeight;
              const newHeight = Math.round(imgHeight + footerHeight);
              updateLink(created.id, {
                title: finalTitle,
                image: cached.image,
                thumbnail: cached.thumbnail,
                description: meta.description || '',
                favicon: meta.favicon || '',
                height: newHeight,
                isParsing: false,
              });
            };
            const finishWithoutImage = async () => {
              if (isHandled) return;
              isHandled = true;
              if (await keepPinterestPreview({ title: finalTitle, description: meta.description || '',
                favicon: meta.favicon || '' })) return;
              updateLink(created.id, {
                title: finalTitle,
                image: '',
                description: meta.description || '',
                favicon: meta.favicon || '',
                height: 90,
                isParsing: false,
              });
              showToast?.('头图加载失败');
            };
            img.onload = finishWithImage;
            img.onerror = () => { void finishWithoutImage(); };
            img.src = cached.image;

            // A stalled image request should end as a failed load, not as a successful preview.
            setTimeout(() => { void finishWithoutImage(); }, 10000);
          } else {
            if (await keepPinterestPreview({ title: finalTitle, description: meta.description || '',
              favicon: meta.favicon || '' })) return;
            updateLink(created.id, {
              title: finalTitle,
              image: '',
              description: meta.description || '',
              favicon: meta.favicon || '',
              height: 90,
              isParsing: false,
            });
            showToast?.('页面未提供头图');
          }
        } catch (err) {
          console.warn('Metadata fetch failed:', err);
          if (await keepPinterestPreview()) return;
          updateLink(created.id, { isParsing: false, height: 90 });
          showToast?.('链接已添加，元数据解析失败；请检查后端服务');
        }
      } else if (text) {
        createCardAtCursor({
          type: 'text',
          content: text,
          width: 260,
          height: 180,
        });
      }
      };
      await performPaste();
    },
    [createCardAtCursor, updateCard, stageCopiedObjects,
      getWorldPosition, getCardById, showToast]
  );

  const handlePaste = useCallback((event: ClipboardEvent) => {
    if (document.querySelector('[data-modal="settings"]')) return;
    const activeTag = document.activeElement?.tagName.toLowerCase();
    if (activeTag === 'input' || activeTag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable) {
      const hasImage = Array.from(event.clipboardData?.items || []).some((item) => item.type.startsWith('image/'));
      const canvasEditorFocused = !!(document.activeElement as HTMLElement | null)?.closest?.('[data-card-id]');
      const hasObjects = !!event.clipboardData && hasCanvasClipboardPayload(event.clipboardData);
      if (!hasImage && !(canvasEditorFocused && (hasCanvasMultiSelection || hasObjects))) return;
    }
    event.preventDefault();
    const eventData = event.clipboardData || undefined;
    void (async () => {
      // Some WebView2 clipboard events expose only text/html and text/plain for
      // a CF_DIB screenshot. Read the same user clipboard gesture directly so
      // the image bytes and the native screenshot source can still be matched.
      if (!hasImageData(eventData)) {
        const systemData = await readSystemClipboardTransfer();
        // A native screenshot may be represented by text/html in the event;
        // prefer the system image in that case. For a plain URL, use the
        // system text only when the event itself is empty or unusable.
        if (systemData && (hasImageData(systemData) || !hasUsableClipboardData(eventData))) {
          await handleDataTransfer(systemData, true);
          return;
        }
      }
      if (eventData && hasUsableClipboardData(eventData)) await handleDataTransfer(eventData, true);
      else if (!eventData) {
        const systemData = await readSystemClipboardTransfer();
        if (systemData) await handleDataTransfer(systemData, true);
      }
    })();
  }, [handleDataTransfer, hasCanvasMultiSelection]);

  const pasteFromSystemClipboard = useCallback(async () => {
    const data = await readSystemClipboardTransfer();
    if (data) {
      await handleDataTransfer(data, true);
      return;
    }

    if (navigator.clipboard?.readText) {
      try {
        const text = (await navigator.clipboard.readText())?.trim();
        if (text) {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          await handleDataTransfer(dt);
        }
        return;
      } catch {
        // fallback
      }
    }

    const fallbackObjects = getCopiedObjects?.();
    if (fallbackObjects && (fallbackObjects.cards.length || fallbackObjects.groups.length || fallbackObjects.pins?.length)) {
      stageCopiedObjects?.(fallbackObjects);
    }
  }, [getCopiedObjects, stageCopiedObjects, handleDataTransfer]);

  return { handlePaste, handleDroppedData: handleDataTransfer, pasteFromSystemClipboard };
}

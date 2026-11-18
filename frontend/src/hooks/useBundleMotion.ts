import { useCallback, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

type Snapshot = { element: HTMLElement; rect: DOMRect; clone: HTMLElement; zoomX: number; zoomY: number };
const DURATION = 300;
const MAX_ANIMATED_MEMBERS = 32;

function snapshot(element: HTMLElement | null): Snapshot | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const zoomX = rect.width / element.offsetWidth;
  const zoomY = rect.height / element.offsetHeight;
  const clone = element.cloneNode(true) as HTMLElement;
  // A group frame animates independently from its member cards/title strips.
  if (element.hasAttribute('data-bundle-id')) {
    // Only the outline changes size. Labels/buttons get independent translations.
    [...clone.children].forEach(child => { if (child.tagName.toLowerCase() !== 'svg') child.remove(); });
    clone.querySelector('svg')?.setAttribute('preserveAspectRatio', 'none');
  }
  clone.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  clone.style.cssText += `;position:absolute;left:0;top:0;margin:0;visibility:visible;pointer-events:none;
    right:auto;bottom:auto;width:${element.offsetWidth}px;height:${element.offsetHeight}px;transform-origin:0 0;
    transform:scale(${zoomX},${zoomY});`;
  return { element, rect, clone, zoomX, zoomY };
}

/** Transient visual copies allow React to commit the real state immediately.
 * No animated coordinates or temporary dimensions enter saved card data. */
export function useBundleMotion() {
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);

  return useCallback((groupId: string, memberIds: string[], commit: () => void) => {
    cleanup.current();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { commit(); return; }
    const findGroup = () => document.querySelector<HTMLElement>(`[data-bundle-id="${CSS.escape(groupId)}"]`);
    // Large collapsed Bundles only render the front stack layers. Limiting
    // snapshots to the same bound prevents one toggle from querying and
    // cloning thousands of hidden member nodes.
    const animatedMemberIds = memberIds.slice(0, MAX_ANIMATED_MEMBERS);
    const findMember = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`)
      || document.querySelector<HTMLElement>(`[data-stack-card-id="${CSS.escape(id)}"]`)?.parentElement || null;
    const capture = () => [snapshot(findGroup()), ...animatedMemberIds.map(id => snapshot(findMember(id))),
      ...['title', 'toggle'].map(part => snapshot(findGroup()?.querySelector<HTMLElement>(`[data-bundle-motion-part="${part}"]`) ?? null))];
    const before = capture();
    flushSync(commit);
    const after = capture();
    const anchor = findGroup()?.dataset.bundleAnchor ?? 'nw';
    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.inert = true;
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9998;overflow:visible;';
    document.body.appendChild(layer);
    const animations: Animation[] = [];
    const hidden: { element: HTMLElement; visibility: string }[] = [];
    let timer = 0;
    let stopped = false;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timer);
      animations.forEach(animation => animation.cancel());
      hidden.forEach(({ element, visibility }) => { element.style.visibility = visibility; });
      layer.remove();
      window.removeEventListener('wheel', finish, true);
      window.removeEventListener('resize', finish);
      window.removeEventListener('blur', finish);
    };
    cleanup.current = finish;
    window.addEventListener('wheel', finish, { capture: true, passive: true });
    window.addEventListener('resize', finish);
    window.addEventListener('blur', finish);
    after.forEach((target, index) => {
      const source = before[index];
      if (!target || !source) return;
      hidden.push({ element: target.element, visibility: target.element.style.visibility });
      target.element.style.visibility = 'hidden';
      const isFrame = index === 0;
      const isLabel = index > animatedMemberIds.length;
      const delay = isFrame || isLabel ? 0 : Math.min(index - 1, 3) * 5;
      const timing: KeyframeAnimationOptions = { duration: DURATION - delay, delay, fill: 'both',
        easing: 'cubic-bezier(0.22, 0.7, 0.25, 1)' };
      for (const [view, incoming] of [[source, false], [target, true]] as const) {
        const ghost = document.createElement('div');
        ghost.style.cssText = `position:absolute;left:${view.rect.x}px;top:${view.rect.y}px;
          width:${view.rect.width}px;height:${view.rect.height}px;pointer-events:none;overflow:${isFrame || isLabel ? 'visible' : 'hidden'};`;
        // Fixed-size content follows the chosen corner of the changing clip box.
        // Its only scale is the constant canvas zoom captured in snapshot().
        const content = document.createElement('div');
        content.style.cssText = `position:absolute;width:${view.rect.width}px;height:${view.rect.height}px;
          ${!isFrame && !isLabel && anchor.endsWith('e') ? 'right' : 'left'}:0;
          ${!isFrame && !isLabel && anchor.startsWith('s') ? 'bottom' : 'top'}:0;`;
        content.appendChild(view.clone);
        ghost.appendChild(content);
        layer.appendChild(ghost);
        const frames = [
          { offset: 0, progress: 0, opacity: incoming ? 0 : 1 },
          { offset: 1, progress: 1, opacity: incoming ? 1 : 0 },
        ].map(({ offset, progress, opacity }) => {
          const mix = (start: number, end: number) => start + (end - start) * progress;
          const width = Math.max(1, mix(source.rect.width, target.rect.width));
          const height = Math.max(1, mix(source.rect.height, target.rect.height));
          return { offset, opacity, left: `${mix(source.rect.x, target.rect.x)}px`,
            top: `${mix(source.rect.y, target.rect.y)}px`, width: `${width}px`, height: `${height}px` };
        });
        animations.push(ghost.animate(frames, timing));
        if (isFrame) {
          animations.push(view.clone.animate([source, target].map(state => ({
            width: `${state.rect.width / view.zoomX}px`, height: `${state.rect.height / view.zoomY}px`,
          })), timing));
        }
      }
    });
    timer = window.setTimeout(finish, DURATION + 30);
    void Promise.all(animations.map(animation => animation.finished)).then(finish, finish);
  }, []);
}

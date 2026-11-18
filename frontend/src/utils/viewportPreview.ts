import type { Viewport } from '../types';

export type ViewportPreviewListener = (viewport: Viewport) => void;
export type SubscribeViewportPreview = (listener: ViewportPreviewListener) => () => void;

// Transient navigation updates go only to presentation layers. React and
// persistence receive the final viewport when the gesture is committed.
export function createViewportPreview() {
  const listeners = new Set<ViewportPreviewListener>();
  let latest: Viewport | undefined;
  return {
    subscribe: ((listener) => {
      listeners.add(listener);
      // A minimap opened while the pointer is stationary must join the live
      // gesture immediately, without waiting for another mouse/wheel event.
      if (latest) listener(latest);
      return () => { listeners.delete(listener); };
    }) as SubscribeViewportPreview,
    publish: (viewport: Viewport) => {
      latest = viewport;
      listeners.forEach((listener) => listener(viewport));
    },
  };
}

export function viewportSnapshotTransform(base: Viewport, next: Viewport) {
  const scale = next.zoom / Math.max(base.zoom, 0.0001);
  return `translate(${next.x - scale * base.x}px, ${next.y - scale * base.y}px) scale(${scale})`;
}

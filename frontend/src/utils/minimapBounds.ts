import type { Viewport } from '../types';

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

/** Fit the map to content, never to the main canvas's growing empty viewport. */
export function minimapWorldBounds(content: Bounds, viewport: Viewport,
  screen: { width: number; height: number }, padding: number) {
  const hasContent = Object.values(content).every(Number.isFinite) &&
    content.maxX >= content.minX && content.maxY >= content.minY;
  const minX = hasContent ? content.minX : -viewport.x / viewport.zoom;
  const minY = hasContent ? content.minY : -viewport.y / viewport.zoom;
  const width = hasContent ? Math.max(1, content.maxX - content.minX) : Math.max(300, screen.width / viewport.zoom);
  const height = hasContent ? Math.max(1, content.maxY - content.minY) : Math.max(200, screen.height / viewport.zoom);
  return { minX: minX - padding, minY: minY - padding,
    width: width + padding * 2, height: height + padding * 2 };
}

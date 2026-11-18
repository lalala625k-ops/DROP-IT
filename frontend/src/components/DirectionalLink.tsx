import React from 'react';
import type { Rect } from '../types';
import type { LinkPoint } from '../utils/linkEndpoints';

interface Props {
  child: LinkPoint;
  parent: LinkPoint;
  childBounds?: Rect;
  color: string;
  strokeWidth: number;
  squareSize: number;
  parentId?: string;
  childId?: string;
}

// Keep the whole square outside the card, with one face touching its edge.
function squareAtEdge(child: LinkPoint, parent: LinkPoint, size: number, bounds?: Rect) {
  const half = size / 2;
  if (!bounds) {
    const angle = Math.atan2(parent.y - child.y, parent.x - child.x);
    return { x: child.x + Math.cos(angle) * half, y: child.y + Math.sin(angle) * half,
      rotation: angle * 180 / Math.PI };
  }
  const sides = [
    { distance: Math.abs(child.x - bounds.x), dx: -1, dy: 0 },
    { distance: Math.abs(child.x - bounds.x - bounds.width), dx: 1, dy: 0 },
    { distance: Math.abs(child.y - bounds.y), dx: 0, dy: -1 },
    { distance: Math.abs(child.y - bounds.y - bounds.height), dx: 0, dy: 1 },
  ];
  sides.sort((a, b) => a.distance - b.distance ||
    (b.dx - a.dx) * (parent.x - child.x) + (b.dy - a.dy) * (parent.y - child.y));
  const side = sides[0];
  return { x: child.x + side.dx * half, y: child.y + side.dy * half, rotation: 0 };
}

export function DirectionalLink({ child, parent, childBounds, color, strokeWidth, squareSize,
  parentId, childId }: Props) {
  if (Math.hypot(parent.x - child.x, parent.y - child.y) < 1e-6) return null;
  const square = squareAtEdge(child, parent, squareSize, childBounds);
  const dx = parent.x - square.x, dy = parent.y - square.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  const ux = dx / length, uy = dy / length;
  const arrowLength = Math.min(Math.max(8, strokeWidth * 2.2), length / 2);
  const halfWidth = Math.min(Math.max(3, strokeWidth), arrowLength * 0.6);
  const base = { x: parent.x - ux * arrowLength, y: parent.y - uy * arrowLength };
  return <g data-directional-link>
    <line data-parent-id={parentId} data-child-id={childId}
      x1={square.x} y1={square.y} x2={base.x} y2={base.y}
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="butt" />
    <rect data-link-start x={square.x - squareSize / 2} y={square.y - squareSize / 2}
      width={squareSize} height={squareSize} fill={color}
      transform={square.rotation ? `rotate(${square.rotation} ${square.x} ${square.y})` : undefined} />
    <path data-link-arrow d={`M ${parent.x} ${parent.y} L ${base.x - uy * halfWidth} ${base.y + ux * halfWidth} L ${base.x + uy * halfWidth} ${base.y - ux * halfWidth} Z`}
      fill={color} />
  </g>;
}

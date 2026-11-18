import React, { useCallback, MutableRefObject } from 'react';
import { Card, Group, Viewport } from '../types';
import { screenToWorld } from '../utils/canvas';

interface UseCanvasDropProps {
  viewportRef: MutableRefObject<Viewport>;
  mouseWorldRef: MutableRefObject<{ x: number; y: number }>;
  cardsRef: MutableRefObject<Card[]>;
  groupsRef: MutableRefObject<Group[]>;
  createCardAtCursor: (cardData: Partial<Card>) => Card;
  handleCardUpdate: (id: string, updates: Partial<Card>) => void;
  handleDroppedData: (data: DataTransfer, fromClipboard?: boolean, dropTime?: number) => Promise<void>;
  showToast: (msg: string) => void;
}

export function useCanvasDrop({
  viewportRef,
  mouseWorldRef,
  cardsRef,
  groupsRef,
  createCardAtCursor,
  handleCardUpdate,
  handleDroppedData,
  showToast,
}: UseCanvasDropProps) {
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const dropWorld = screenToWorld(e.clientX, e.clientY, viewportRef.current);
      mouseWorldRef.current = dropWorld;
      // The shared intake uses supplied image bytes before image URLs, while
      // retaining the accompanying webpage (including Pin data) as its source.
      await handleDroppedData(e.dataTransfer, false, e.timeStamp);
    },
    [
      viewportRef,
      mouseWorldRef,
      cardsRef,
      groupsRef,
      showToast,
      createCardAtCursor,
      handleCardUpdate,
      handleDroppedData,
    ]
  );

  return { handleDrop };
}

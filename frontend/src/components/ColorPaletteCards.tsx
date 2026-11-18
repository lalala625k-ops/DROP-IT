import React, { useRef, useState } from 'react';
import { BRANCH_COLOR_PALETTE } from '../utils/groupColors';

interface Props { onSelect: (color?: string) => void }

const swatches = [{ name: '去色', color: undefined }, ...BRANCH_COLOR_PALETTE];

export function ColorPaletteCards({ onSelect }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const dragging = useRef(false);
  const indexAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-color-swatch]');
    return [...buttons].findIndex(button => {
      const rect = button.getBoundingClientRect();
      return event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
  };
  return <div role="group" aria-label="配色卡" className="color-palette-cards"
    onPointerDown={event => {
      if (event.button !== 0) return;
      const index = indexAt(event);
      if (index < 0) return;
      event.stopPropagation();
      dragging.current = true;
      setActive(index);
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => { const index = indexAt(event); setActive(index < 0 ? null : index); }}
    onPointerUp={event => {
      if (!dragging.current) return;
      dragging.current = false;
      const index = indexAt(event);
      if (index >= 0) onSelect(swatches[index].color);
      else setActive(null);
    }}
    onPointerCancel={() => { dragging.current = false; setActive(null); }}
    onLostPointerCapture={() => { dragging.current = false; }}
    onPointerLeave={() => { if (!dragging.current) setActive(null); }}>
    {swatches.map(({ name, color }, index) => <button key={color || 'clear'} type="button"
      data-color-swatch={color || 'clear'} data-active={active === index}
      aria-label={color ? `${name} ${color}` : name} title={name}
      className="color-palette-swatch"
      onFocus={() => setActive(index)} onBlur={() => setActive(null)}
      onClick={event => { if (event.detail === 0) onSelect(color); }}>
      <span style={{ backgroundColor: color || '#FFFFFF' }}>
        {!color && <svg viewBox="0 0 42 42" className="w-full h-full" aria-hidden="true">
          <path d="M 5 37 L 37 5" stroke="#FF1744" strokeWidth="2" />
        </svg>}
      </span>
    </button>)}
  </div>;
}

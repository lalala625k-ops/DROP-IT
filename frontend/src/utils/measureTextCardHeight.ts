import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownView } from '../components/MarkdownView';
import { CARD_TEXT_INSET } from './cardLayout';

let preview: HTMLDivElement | null = null;

// Measure the rendered content, rather than the Markdown source in the editor:
// syntax and URLs can wrap into more lines than the visible text.
export function measureTextCardHeight(content: string, width: number): number | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (!preview) {
    preview = document.createElement('div');
    preview.setAttribute('aria-hidden', 'true');
    preview.inert = true;
    preview.style.cssText = `position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;border:0;padding:${CARD_TEXT_INSET}px;margin:0;box-sizing:border-box;`;
    preview.className = 'font-retina';
    document.body.appendChild(preview);
    preview.style.contain = 'layout style';
  }
  preview.style.width = `${width}px`;
  preview.innerHTML = renderToStaticMarkup(createElement(MarkdownView, {
    content, className: 'text-card-markdown',
    style: { height: 'auto', overflow: 'visible', display: 'flow-root' },
  }));
  return Math.ceil(preview.getBoundingClientRect().height);
}

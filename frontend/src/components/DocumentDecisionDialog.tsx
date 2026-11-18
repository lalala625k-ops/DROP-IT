import { useEffect, useRef, useState } from 'react';

export interface DocumentDecision {
  title: string; message: string;
  options: { id: string; label: string }[]; remember?: boolean;
  resolve: (id: string, remember: boolean) => void;
}

export function DocumentDecisionDialog({ decision }: { decision: DocumentDecision | null }) {
  const [remember, setRemember] = useState(false);
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    setRemember(false);
    if (!decision) return;
    const previous = document.activeElement as HTMLElement | null;
    section.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => previous?.focus();
  }, [decision]);
  if (!decision) return null;
  return <div data-modal="document" className="fixed inset-0 z-[10000] flex items-center justify-center bg-ink/20"
    onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); decision.resolve('cancel', false); }
      if (e.key === 'Tab') {
        const controls = [...section.current!.querySelectorAll<HTMLElement>('button, input')];
        const index = controls.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        controls[(index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
      }
    }}>
    <section ref={section} role="dialog" aria-modal="true" aria-label={decision.title}
      className="max-w-lg border-2 border-ink bg-white p-5 text-ink">
      <h2 className="text-lg font-bold">{decision.title}</h2>
      <p className="my-4 whitespace-pre-wrap text-sm">{decision.message}</p>
      {decision.remember && <label className="mb-4 flex gap-2 text-sm">
        <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />记住选择
      </label>}
      <div className="flex flex-wrap justify-end gap-2">
        {decision.options.map((option, index) => <button key={option.id} autoFocus={index === 0}
          className="border border-ink px-3 py-2 text-sm hover:bg-stone focus:outline focus:outline-2"
          onClick={() => decision.resolve(option.id, remember)}>{option.label}</button>)}
      </div>
    </section>
  </div>;
}

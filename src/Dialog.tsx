import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const previous = document.activeElement as HTMLElement | null;
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, a[href], [tabindex="0"]'))
      .filter(el => el.getClientRects().length > 0);
    const focusFirst = () => (controls()[0] ?? panel).focus();
    focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat) close.current(); }
      if (event.key !== 'Tab') return;
      const elements = controls(), first = elements[0], last = elements.at(-1);
      if (!first) { event.preventDefault(); panel.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => { if (!panel.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      if (previous?.isConnected) previous.focus();
    };
  }, [ref]);
}

export function GameDialog({ title, id, onClose, children }: { title: string; id: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  return <div className="game-overlay">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="game-panel w-full max-w-lg space-y-5">
      <header className="flex justify-between items-center gap-3">
        <h2 id={id} className="text-lg font-bold">{title}</h2>
        <button aria-label="閉じてゲームへ戻る" onClick={onClose} className="game-button min-w-11 min-h-11">×</button>
      </header>
      {children}
    </div>
  </div>;
}

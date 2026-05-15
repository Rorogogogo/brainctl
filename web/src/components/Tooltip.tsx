import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  delayMs?: number;
  side?: 'top' | 'bottom';
}

export function Tooltip({ label, children, delayMs = 150, side = 'top' }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delayMs);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
    setCoords(null);
  };

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tooltipRef.current) return;
    const anchorRect = anchorRef.current.getBoundingClientRect();
    const tipRect = tooltipRef.current.getBoundingClientRect();
    const gap = 4;
    const left = anchorRect.left + anchorRect.width / 2 - tipRect.width / 2;
    const top =
      side === 'top'
        ? anchorRect.top - tipRect.height - gap
        : anchorRect.bottom + gap;
    setCoords({ left, top });
  }, [open, side]);

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            style={{
              position: 'fixed',
              left: coords?.left ?? -9999,
              top: coords?.top ?? -9999,
              visibility: coords ? 'visible' : 'hidden',
            }}
            className="pointer-events-none z-[1000] whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[10px] font-medium text-white shadow-md"
          >
            {label}
          </span>,
          document.body
        )}
    </span>
  );
}

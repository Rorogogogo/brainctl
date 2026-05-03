import { useRef, useState, type ReactNode } from 'react';

interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  delayMs?: number;
  side?: 'top' | 'bottom';
}

export function Tooltip({ label, children, delayMs = 150, side = 'top' }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delayMs);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setOpen(false);
  };

  const positionClass =
    side === 'top'
      ? 'bottom-full left-1/2 mb-1 -translate-x-1/2'
      : 'top-full left-1/2 mt-1 -translate-x-1/2';

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-[10px] font-medium text-white shadow-md ${positionClass}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}

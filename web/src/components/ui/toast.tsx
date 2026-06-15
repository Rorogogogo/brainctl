import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { X, RotateCcw } from 'lucide-react';

import { Button } from './button.js';
import { cn } from '../../lib/utils.js';

type ToastType = 'message' | 'success' | 'warning' | 'error';

type Toast = {
  id: number;
  text: string | ReactNode;
  measuredHeight?: number;
  timeout?: ReturnType<typeof setTimeout>;
  remaining?: number;
  start?: number;
  pause?: () => void;
  resume?: () => void;
  preserve?: boolean;
  action?: string;
  onAction?: () => void;
  onUndoAction?: () => void;
  type: ToastType;
};

type ToastOptions = {
  description?: ReactNode;
  duration?: number;
  preserve?: boolean;
  action?: string;
  onAction?: () => void;
  onUndoAction?: () => void;
};

type Message = ToastOptions & {
  text: string | ReactNode;
};

let root: Root | null = null;
let mountEl: HTMLDivElement | null = null;
let toastId = 0;

function renderToastText(text: ReactNode, description?: ReactNode): ReactNode {
  if (!description) return text;
  return (
    <span className="flex flex-col gap-0.5">
      <span>{text}</span>
      <span className="text-[12px] opacity-80">{description}</span>
    </span>
  );
}

const toastStore = {
  toasts: [] as Toast[],
  listeners: new Set<() => void>(),

  add(text: string | ReactNode, type: ToastType, options: ToastOptions = {}) {
    const id = toastId++;
    const toast: Toast = {
      id,
      text: renderToastText(text, options.description),
      preserve: options.preserve,
      action: options.action,
      onAction: options.onAction,
      onUndoAction: options.onUndoAction,
      type,
    };

    if (!toast.preserve) {
      toast.remaining = options.duration ?? 3000;
      toast.start = Date.now();

      const close = () => {
        this.toasts = this.toasts.filter((t) => t.id !== id);
        this.notify();
      };

      toast.timeout = setTimeout(close, toast.remaining);

      toast.pause = () => {
        if (!toast.timeout) return;
        clearTimeout(toast.timeout);
        toast.timeout = undefined;
        toast.remaining = Math.max(0, (toast.remaining ?? 0) - (Date.now() - (toast.start ?? Date.now())));
      };

      toast.resume = () => {
        if (toast.timeout) return;
        toast.start = Date.now();
        toast.timeout = setTimeout(close, toast.remaining);
      };
    }

    this.toasts.push(toast);
    this.notify();
  },

  remove(id: number) {
    const removed = this.toasts.find((t) => t.id === id);
    if (removed?.timeout) clearTimeout(removed.timeout);
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.notify();
  },

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  },

  notify() {
    this.listeners.forEach((fn) => fn());
  },

  reset() {
    for (const t of this.toasts) {
      if (t.timeout) clearTimeout(t.timeout);
    }
    this.toasts = [];
    this.listeners.clear();
  },
};

const toastColors: Record<ToastType, string> = {
  message: 'bg-popover text-popover-foreground border border-border',
  success: 'bg-emerald-600 text-white border border-emerald-700',
  warning: 'bg-amber-500 text-white border border-amber-600',
  error: 'bg-destructive text-white border border-destructive/80',
};

function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [shownIds, setShownIds] = useState<number[]>([]);
  const [isHovered, setIsHovered] = useState(false);

  const measureRef = (toast: Toast) => (node: HTMLDivElement | null) => {
    if (node && toast.measuredHeight == null) {
      toast.measuredHeight = node.getBoundingClientRect().height;
      toastStore.notify();
    }
  };

  useEffect(() => {
    setToasts([...toastStore.toasts]);
    return toastStore.subscribe(() => { setToasts([...toastStore.toasts]); });
  }, []);

  useEffect(() => {
    const unseen = toasts.filter((t) => !shownIds.includes(t.id)).map((t) => t.id);
    if (unseen.length > 0) {
      requestAnimationFrame(() => { setShownIds((prev) => [...prev, ...unseen]); });
    }
  }, [shownIds, toasts]);

  const lastVisibleCount = 3;
  const lastVisibleStart = Math.max(0, toasts.length - lastVisibleCount);

  const getFinalTransform = (index: number, length: number) => {
    if (index === length - 1) return 'none';
    const offset = length - 1 - index;
    let translateY = 0;
    for (let i = length - 1; i > index; i--) {
      translateY += isHovered ? (toasts[i]?.measuredHeight || 63) + 10 : 20;
    }
    const z = -offset;
    const scale = isHovered ? 1 : 1 - 0.05 * offset;
    return `translate3d(0, calc(100% - ${translateY}px), ${z}px) scale(${scale})`;
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
    toastStore.toasts.forEach((t) => t.pause?.());
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    toastStore.toasts.forEach((t) => t.resume?.());
  };

  const visibleToasts = toasts.slice(lastVisibleStart);
  const containerHeight =
    visibleToasts.reduce((acc, t) => acc + (t.measuredHeight ?? 63), 0) +
    (isHovered && visibleToasts.length > 1 ? (visibleToasts.length - 1) * 10 : 0);

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[9999] w-[min(420px,calc(100vw-2rem))]"
      style={{ height: containerHeight }}
    >
      <div
        className="pointer-events-auto relative w-full"
        style={{ height: containerHeight }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {toasts.map((t, index) => {
          const isVisible = index >= lastVisibleStart;
          return (
            <div
              key={t.id}
              ref={measureRef(t)}
              className={cn(
                'absolute right-0 top-0 h-fit rounded-xl p-4 leading-[21px] shadow-lg',
                toastColors[t.type],
                isVisible ? 'opacity-100' : 'opacity-0',
                index < lastVisibleStart && 'pointer-events-none'
              )}
              style={{
                width: 'min(420px, calc(100vw - 2rem))',
                transition: 'all .35s cubic-bezier(.25,.75,.6,.98)',
                transform: shownIds.includes(t.id)
                  ? getFinalTransform(index, toasts.length)
                  : 'translate3d(0, -100%, 150px) scale(1)',
              }}
            >
              <div className="flex flex-col text-[.875rem] font-semibold">
                <div className="flex h-full w-full items-center justify-between gap-4">
                  <span className="min-w-0">{t.text}</span>
                  {!t.action && (
                    <div className="flex shrink-0 gap-1">
                      {t.onUndoAction && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 opacity-80 hover:opacity-100"
                          onClick={() => { t.onUndoAction?.(); toastStore.remove(t.id); }}
                        >
                          <RotateCcw className="size-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 opacity-80 hover:opacity-100"
                        onClick={() => toastStore.remove(t.id)}
                        aria-label="Dismiss notification"
                      >
                        <X className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                {t.action && (
                  <div className="flex w-full items-center justify-end gap-2 mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="opacity-80 hover:opacity-100"
                      onClick={() => toastStore.remove(t.id)}
                    >
                      Dismiss
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => { t.onAction?.(); toastStore.remove(t.id); }}
                    >
                      {t.action}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function mountContainer() {
  if (root || typeof document === 'undefined') return;
  mountEl = document.createElement('div');
  mountEl.className = 'fixed right-4 top-4 z-[9999]';
  document.body.appendChild(mountEl);
  root = createRoot(mountEl);
  root.render(<ToastContainer />);
}

export const toast = {
  message({ text, ...options }: Message) {
    mountContainer();
    toastStore.add(text, 'message', options);
  },
  success(text: string | ReactNode, options?: ToastOptions) {
    mountContainer();
    toastStore.add(text, 'success', options);
  },
  warning(text: string | ReactNode, options?: ToastOptions) {
    mountContainer();
    toastStore.add(text, 'warning', options);
  },
  error(text: string | ReactNode, options?: ToastOptions) {
    mountContainer();
    toastStore.add(text, 'error', options);
  },
};

export const useToasts = () => {
  return {
    message: useCallback((message: Message) => toast.message(message), []),
    success: useCallback((text: ReactNode, options?: ToastOptions) => toast.success(text, options), []),
    warning: useCallback((text: ReactNode, options?: ToastOptions) => toast.warning(text, options), []),
    error: useCallback((text: ReactNode, options?: ToastOptions) => toast.error(text, options), []),
  };
};

export function resetToastsForTest() {
  toastStore.reset();
  root?.unmount();
  root = null;
  mountEl?.remove();
  mountEl = null;
}

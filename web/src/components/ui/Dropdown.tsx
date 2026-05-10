import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface DropdownItem {
  value: string;
  label: string;
  description?: string;
}

export interface DropdownSection {
  title?: string;
  items: DropdownItem[];
}

export interface DropdownProps {
  value?: string;
  placeholder?: string;
  triggerLabel?: ReactNode;
  leftIcon?: ReactNode;
  sections: DropdownSection[];
  onSelect: (value: string) => void;
  emptyLabel?: string;
  footer?: ReactNode;
  width?: string;
  triggerClassName?: string;
  labelClassName?: string;
  align?: 'start' | 'end';
  disabled?: boolean;
}

export function Dropdown({
  value,
  placeholder = 'Select…',
  triggerLabel,
  leftIcon,
  sections,
  onSelect,
  emptyLabel,
  footer,
  width = 'w-80',
  triggerClassName,
  labelClassName,
  align = 'start',
  disabled = false,
}: DropdownProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent): void {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const allItems = sections.flatMap((s) => s.items);
  const totalItems = allItems.length;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={
          triggerClassName ??
          'inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-800 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-50'
        }
      >
        {leftIcon && <span className="text-zinc-500">{leftIcon}</span>}
        <span className={labelClassName ?? 'max-w-[260px] truncate'}>{triggerLabel ?? placeholder}</span>
        <ChevronDown
          size={13}
          className={`text-zinc-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className={`absolute z-20 mt-1.5 ${width} ${align === 'end' ? 'right-0' : 'left-0'} overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl`}
        >
          <div className="scrollbar-none max-h-80 overflow-y-auto">
            {totalItems === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-zinc-400">
                {emptyLabel ?? 'No options'}
              </div>
            ) : (
              sections.map((section, sIdx) => (
                <div key={sIdx} className={sIdx > 0 ? 'border-t border-zinc-100' : ''}>
                  {section.title && (
                    <div className="bg-zinc-50/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {section.title}
                    </div>
                  )}
                  <ul>
                    {section.items.map((item, iIdx) => {
                      const selected = value === item.value;
                      const isLast =
                        sIdx === sections.length - 1 && iIdx === section.items.length - 1;
                      return (
                        <li key={item.value}>
                          <button
                            type="button"
                            onClick={() => {
                              onSelect(item.value);
                              setOpen(false);
                            }}
                            className={`group flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                              selected ? 'bg-zinc-50' : 'hover:bg-zinc-50'
                            } ${isLast ? '' : 'border-b border-zinc-100'}`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-zinc-900">
                                {item.label}
                              </div>
                              {item.description && (
                                <div className="truncate font-mono text-[11px] text-zinc-500">
                                  {item.description}
                                </div>
                              )}
                            </div>
                            {selected && <Check size={14} className="shrink-0 text-zinc-700" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
          {footer && <div className="border-t border-zinc-100 bg-zinc-50/60 p-2">{footer}</div>}
        </div>
      )}
    </div>
  );
}

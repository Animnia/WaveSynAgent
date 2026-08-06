import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface DropdownItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Render a subtle section header instead of a clickable row. */
  header?: boolean;
  /** Right-aligned auxiliary text (e.g. status). */
  hint?: string;
}

/**
 * Minimal dropdown menu: a trigger button + an absolutely-positioned menu
 * that closes on outside click / Escape / item selection.
 */
export default function Dropdown({
  label,
  items,
  active = false,
  disabled = false,
  title,
}: {
  label: ReactNode;
  items: DropdownItem[];
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={title}
        className={`px-3 py-1.5 text-xs rounded border transition-colors flex items-center gap-1.5 disabled:opacity-30 ${
          active
            ? 'bg-text-primary/10 text-text-primary border-border-active'
            : 'bg-bg-tertiary text-text-secondary border-border-default hover:border-border-active'
        }`}
      >
        {label}
        <span className="text-[8px] text-text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[180px] bg-bg-tertiary border border-border-default rounded shadow-lg z-50 py-1 fade-in">
          {items.map((item, i) =>
            item.header ? (
              <div
                key={i}
                className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-text-muted"
              >
                {item.label}
              </div>
            ) : (
              <button
                key={i}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                className="w-full flex items-center justify-between gap-3 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <span>{item.label}</span>
                {item.hint && <span className="text-[10px] text-text-muted">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { faviconSrc } from "../shared/format.ts";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Renders instant 0ms hover tooltips for any `[data-tip]` element in a top-level
 * fixed portal so tooltips are never clipped by overflow or covered by siblings.
 */
export function GlobalTooltip() {
  const [tip, setTip] = useState<{ text: string; left: number; top: number; above: boolean } | null>(null);

  useEffect(() => {
    let activeEl: HTMLElement | null = null;
    const showFor = (el: HTMLElement) => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      activeEl = el;
      const rect = el.getBoundingClientRect();
      const above = rect.bottom + 42 > window.innerHeight && rect.top > 42;
      const centerX = rect.left + rect.width / 2;
      const clampedX = Math.max(120, Math.min(window.innerWidth - 120, centerX));
      setTip({
        text,
        left: clampedX,
        top: above ? rect.top - 6 : rect.bottom + 6,
        above,
      });
    };
    const onOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (target) showFor(target);
    };
    const onOut = (e: MouseEvent) => {
      if (!activeEl) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (related && activeEl.contains(related)) return;
      const next = related?.closest?.("[data-tip]") as HTMLElement | null;
      if (next && next !== activeEl) {
        showFor(next);
      } else {
        activeEl = null;
        setTip(null);
      }
    };
    const hide = () => {
      activeEl = null;
      setTip(null);
    };
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("mousedown", hide, true);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("mousedown", hide, true);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!tip || typeof document === "undefined") return null;
  return createPortal(
    <div
      role="tooltip"
      style={{
        left: `${tip.left}px`,
        top: `${tip.top}px`,
        transform: tip.above ? "translate(-50%, -100%)" : "translateX(-50%)",
      }}
      className="fixed z-[200] pointer-events-none px-2 py-1 rounded-md bg-[var(--st-ink)] text-[var(--st-surface)] text-[11px] font-medium leading-snug max-w-[230px] text-center shadow-lg"
    >
      {tip.text}
    </div>,
    document.body
  );
}

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "outline" | "ghost" | "dark" | "danger";
    size?: "default" | "sm" | "icon" | "icon-sm";
  }
>(({ className, variant = "outline", size = "default", type = "button", title, ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    data-tip={title || undefined}
    aria-label={props["aria-label"] || title}
    className={cn(
      "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-[background-color,border-color,color,transform,opacity] duration-150 cursor-pointer disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] shrink-0",
      size === "default" && "h-8 px-3 text-[13px]",
      size === "sm" && "h-7 px-2.5 text-[12px]",
      size === "icon" && "h-8 w-8 p-0 text-[13px]",
      size === "icon-sm" && "h-7 w-7 p-0 text-[12px]",
      variant === "primary" && "bg-[var(--st-accent)] text-[var(--st-accent-fg)] hover:opacity-92",
      variant === "dark" && "bg-[var(--st-ink)] text-[var(--st-surface)] hover:opacity-90",
      variant === "outline" && "border border-[var(--st-border)] bg-[var(--st-surface)] text-[var(--st-ink)] hover:bg-[var(--st-subtle)]",
      variant === "ghost" && "text-[var(--st-muted)] hover:text-[var(--st-ink)] hover:bg-[var(--st-subtle)]",
      variant === "danger" && "border border-[var(--st-border)] bg-[var(--st-surface)] text-[var(--st-danger)] hover:bg-[var(--st-subtle)]",
      className
    )}
    {...props}
  />
));
Button.displayName = "Button";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 px-2.5 rounded-md border border-[var(--st-border)] bg-[var(--st-surface)] text-[13px] text-[var(--st-ink)] placeholder:text-[var(--st-muted)] focus:outline-none focus:border-[var(--st-accent)] transition-colors",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-8 px-2.5 rounded-md border border-[var(--st-border)] bg-[var(--st-surface)] text-[13px] text-[var(--st-ink)] focus:outline-none focus:border-[var(--st-accent)] transition-colors",
        className
      )}
      {...props}
    />
  )
);
Select.displayName = "Select";

export function Switch({
  id,
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  id?: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={ariaLabel}
      className={cn(
        "relative w-9 h-5 rounded-full transition-colors cursor-pointer shrink-0",
        checked ? "bg-[var(--st-accent)]" : "bg-[var(--st-border)]"
      )}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block w-4 h-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-[2px]"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  ariaLabel?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(Boolean(v))}
      aria-label={ariaLabel}
      className={cn(
        "w-4 h-4 rounded border border-[var(--st-border)] bg-[var(--st-surface)] inline-flex items-center justify-center shrink-0 cursor-pointer transition-colors",
        checked && "bg-[var(--st-accent)] border-[var(--st-accent)] text-white"
      )}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="w-3 h-3" strokeWidth={2.5} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function TabFavicon({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = React.useState(false);
  const src = faviconSrc(url);
  const letter = (title || url || "?")[0]?.toUpperCase() || "?";

  if (!src || failed) {
    return (
      <span className="w-4 h-4 rounded bg-[var(--st-subtle)] text-[var(--st-muted)] text-[10px] font-semibold grid place-items-center shrink-0">
        {letter}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={`${title || "Site"} icon`}
      width={16}
      height={16}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="w-4 h-4 rounded-sm shrink-0"
    />
  );
}

export class SafeErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-[100dvh] p-6 bg-[var(--st-canvas)] text-[var(--st-ink)] flex items-center justify-center">
          <div className="max-w-md w-full rounded-xl border border-[var(--st-border)] bg-[var(--st-surface)] p-5 space-y-3">
            <h1 className="text-[15px] font-semibold">Something interrupted this view</h1>
            <p className="text-[12px] text-[var(--st-muted)]">{this.state.error.message}</p>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function DashboardSkeleton() {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[var(--st-bg)] text-[var(--st-ink)]">
      <div className="h-[52px] px-4 bg-[var(--st-surface)] border-b border-[var(--st-border)] flex items-center justify-between gap-4 shrink-0">
        <div className="st-skeleton h-6 w-32" />
        <div className="st-skeleton h-8 w-80 max-w-full" />
        <div className="st-skeleton h-8 w-44" />
      </div>
      <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_340px]">
        <div className="hidden md:block bg-[var(--st-surface)] border-r border-[var(--st-border)] p-3 space-y-2">
          <div className="st-skeleton h-9 w-full" />
          <div className="st-skeleton h-9 w-full" />
          <div className="st-skeleton h-9 w-full" />
          <div className="st-skeleton h-9 w-full" />
        </div>
        <div className="p-5 space-y-3">
          <div className="st-skeleton h-12 w-full" />
          <div className="st-skeleton h-14 w-full" />
          <div className="st-skeleton h-14 w-full" />
          <div className="st-skeleton h-14 w-full" />
        </div>
        <div className="hidden xl:block bg-[var(--st-surface)] border-l border-[var(--st-border)] p-4 space-y-3">
          <div className="st-skeleton h-6 w-40" />
          <div className="st-skeleton h-10 w-full" />
          <div className="st-skeleton h-10 w-full" />
        </div>
      </div>
    </div>
  );
}

import React, { useContext, useEffect, useId, useRef, useState } from "react";
import { Cloud, Database, Moon, Sliders } from "lucide-react";
import { Input, Select, Switch } from "../../components/ui.tsx";
import type { Settings } from "../../shared/types.ts";

export type CategoryId = "general" | "tabs" | "backups" | "data";

export const CATEGORIES: Array<{ id: CategoryId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: "general", label: "General", icon: Sliders },
  { id: "tabs", label: "Tab Sleep & Groups", icon: Moon },
  { id: "backups", label: "Backups & Sync", icon: Cloud },
  { id: "data", label: "Import, Privacy & Data", icon: Database },
];

export const ALL_GROUP_COLORS: Array<Settings["autoTabGroupColor"]> = [
  "random",
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
];

export const ALL_COPY_FORMATS: Array<{ id: Settings["enabledCopyFormats"][number]; label: string }> = [
  { id: "titleAndUrl", label: "Title & Address" },
  { id: "markdown", label: "Markdown Links" },
  { id: "json", label: "TabVault File" },
  { id: "csv", label: "Spreadsheet" },
  { id: "html", label: "Bookmarks Page" },
  { id: "onetab", label: "Address | Title List" },
];

const SettingRowContext = React.createContext<{ id: string; title: string } | null>(null);

export function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  const controlId = useId();
  return (
    <SettingRowContext.Provider value={{ id: controlId, title }}>
      <div className="py-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0 flex-1 pr-4">
          <label htmlFor={controlId} className="text-[13px] font-medium block">
            {title}
          </label>
          {description && <p className="text-[12px] text-[var(--st-muted)] mt-0.5">{description}</p>}
        </div>
        <div className="shrink-0 flex items-center gap-2">{children}</div>
      </div>
    </SettingRowContext.Provider>
  );
}

export function RowSwitch(props: React.ComponentProps<typeof Switch>) {
  const ctx = useContext(SettingRowContext);
  return <Switch id={props.id ?? ctx?.id} ariaLabel={props.ariaLabel ?? ctx?.title} {...props} />;
}

export function RowSelect(props: React.ComponentProps<typeof Select>) {
  const ctx = useContext(SettingRowContext);
  return <Select id={props.id ?? ctx?.id} aria-label={props["aria-label"] ?? ctx?.title} {...props} />;
}

export function RowInput(props: React.ComponentProps<typeof Input>) {
  const ctx = useContext(SettingRowContext);
  return <Input id={props.id ?? ctx?.id} aria-label={props["aria-label"] ?? ctx?.title} {...props} />;
}

export function BufferedInput({
  value,
  onCommit,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string;
  onCommit: (next: string) => void;
}) {
  const ctx = useContext(SettingRowContext);
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(draft);

  useEffect(() => {
    setDraft(value);
    latestRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const flush = (val: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (val !== value) onCommit(val);
  };

  return (
    <Input
      id={props.id ?? ctx?.id}
      aria-label={props["aria-label"] ?? ctx?.title}
      {...props}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        latestRef.current = next;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          onCommit(next);
        }, 450);
      }}
      onBlur={() => flush(latestRef.current)}
    />
  );
}

export function BufferedTextarea({
  value,
  onCommit,
  ...props
}: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(draft);

  useEffect(() => {
    setDraft(value);
    latestRef.current = value;
  }, [value]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const flush = (val: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (val !== value) onCommit(val);
  };

  return (
    <textarea
      {...props}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        latestRef.current = next;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          onCommit(next);
        }, 450);
      }}
      onBlur={() => flush(latestRef.current)}
    />
  );
}

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--st-border)] bg-[var(--st-subtle)]/50">
        <h2 className="text-[13px] font-semibold">{title}</h2>
      </div>
      <div className="divide-y divide-[var(--st-border)]">{children}</div>
    </section>
  );
}

export async function ensureOptionalPermission(perm: chrome.permissions.Permissions): Promise<boolean> {
  if (!chrome.permissions?.request) return true;
  try {
    return await chrome.permissions.request(perm);
  } catch {
    return false;
  }
}

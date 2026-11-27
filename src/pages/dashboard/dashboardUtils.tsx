import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Copy } from "lucide-react";
import { Button } from "../../components/ui.tsx";
import { plural } from "../../shared/format.ts";
import type { SavedWindow, TabGroupColor } from "../../shared/types.ts";

export const GROUP_DOT_COLORS: Record<TabGroupColor, string> = {
  grey: "#64748B",
  blue: "#3B82F6",
  red: "#EF4444",
  yellow: "#EAB308",
  green: "#10B981",
  pink: "#EC4899",
  purple: "#8B5CF6",
  cyan: "#06B6D4",
  orange: "#F97316",
};

export const COPY_FORMAT_LABELS: Record<"titleAndUrl" | "markdown" | "json" | "csv" | "html" | "onetab", string> = {
  titleAndUrl: "Title & Address",
  markdown: "Markdown Links",
  json: "TabVault File (JSON)",
  csv: "Spreadsheet (CSV)",
  html: "Bookmarks Page (HTML)",
  onetab: "Address | Title List",
};

export function CopyFormatButton({
  count,
  enabledFormats,
  customTemplates,
  onCopy,
}: {
  count: number;
  enabledFormats: Array<"titleAndUrl" | "markdown" | "json" | "csv" | "html" | "onetab">;
  customTemplates: Array<{ name: string; format: string }>;
  onCopy: (
    mode:
      | { kind: "format"; format: "titleAndUrl" | "markdown" | "json" | "csv" | "html" | "onetab" }
      | { kind: "template"; template: string },
    label: string
  ) => void;
}) {
  const formats = enabledFormats.length ? enabledFormats : (["markdown"] as const);
  if (formats.length === 1 && customTemplates.length === 0) {
    const fmt = formats[0];
    return (
      <Button
        variant="outline"
        title={`Copy ${plural(count, "tab")} as ${COPY_FORMAT_LABELS[fmt]}`}
        onClick={() => onCopy({ kind: "format", format: fmt }, COPY_FORMAT_LABELS[fmt])}
      >
        <Copy className="w-3.5 h-3.5" />
        Copy ({count})
      </Button>
    );
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="outline" title="Choose a copy format or custom template">
          <Copy className="w-3.5 h-3.5" />
          Copy ({count})
          <ChevronDown className="w-3 h-3 opacity-70" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[200px] rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] p-1 shadow-xl text-[12.5px] text-[var(--st-ink)]"
        >
          {formats.map((fmt) => (
            <DropdownMenu.Item
              key={fmt}
              onSelect={() => onCopy({ kind: "format", format: fmt }, COPY_FORMAT_LABELS[fmt])}
              className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none hover:bg-[var(--st-subtle)] focus:bg-[var(--st-subtle)]"
            >
              {COPY_FORMAT_LABELS[fmt]}
            </DropdownMenu.Item>
          ))}
          {customTemplates.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-[var(--st-border)]" />
              {customTemplates.map((tpl, i) => (
                <DropdownMenu.Item
                  key={`${tpl.name}-${i}`}
                  onSelect={() => onCopy({ kind: "template", template: tpl.format }, tpl.name)}
                  className="px-2.5 py-1.5 rounded-md cursor-pointer outline-none hover:bg-[var(--st-subtle)] focus:bg-[var(--st-subtle)]"
                >
                  {tpl.name}
                </DropdownMenu.Item>
              ))}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function historyGroupLabel(ts: number): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startOfToday) return "Today";
  if (ts >= startOfToday - 86_400_000) return "Yesterday";
  if (ts >= startOfToday - 7 * 86_400_000) return "This Week";
  return new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function groupWindowTabs(win: SavedWindow) {
  const groupsMeta = new Map((win.groups || []).map((g) => [g.id, g]));
  const sections: Array<{ key: string; title: string | null; color: TabGroupColor | null; tabs: SavedWindow["tabs"] }> = [];
  let currentKey = "";
  for (const t of win.tabs) {
    const g = t.groupKey != null ? groupsMeta.get(t.groupKey) : undefined;
    const key = g ? `g-${g.id}` : "ungrouped";
    if (!sections.length || currentKey !== key) {
      currentKey = key;
      sections.push({
        key: `${key}-${sections.length}`,
        title: g ? g.title || "Tab Group" : null,
        color: g ? g.color : null,
        tabs: [t],
      });
    } else {
      sections[sections.length - 1].tabs.push(t);
    }
  }
  return sections;
}

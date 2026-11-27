import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  ExternalLink,
  Layers,
  PanelRight,
  RotateCcw,
  Save,
  Search,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { BackupPermissionBanner, BuyMeACoffeeButton, HeaderAccountButton, QuickIntervalButton } from "../../components/HeaderExtras.tsx";
import { Button, Checkbox, GlobalTooltip, Input, TabFavicon, cn } from "../../components/ui.tsx";
import { formatTabDisplayUrl } from "../../shared/core.ts";
import { applyTheme, formatTimestamp, openOrFocusDashboard, plural } from "../../shared/format.ts";
import { sendBg } from "../../shared/rpc.ts";
import type {
  AppStateSummary,
  CollapseScope,
  CollectionRecord,
  SavedWindow,
  SearchHit,
  SnapshotMeta,
} from "../../shared/types.ts";

export function PopupApp() {
  const [state, setState] = useState<AppStateSummary | null>(null);
  const [openWindows, setOpenWindows] = useState<SavedWindow[]>([]);
  const [metas, setMetas] = useState<SnapshotMeta[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [tab, setTab] = useState<"open" | "recent" | "collections">("open");
  const [sessionName, setSessionName] = useState("");
  const [query, setQuery] = useState("");
  const [searchSource, setSearchSource] = useState<"all" | "open" | "snapshot" | "collection">("all");
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [activeHitIdx, setActiveHitIdx] = useState(0);
  const [expandedWinIdx, setExpandedWinIdx] = useState<number | null>(null);
  const [selectedTabKeys, setSelectedTabKeys] = useState<Set<string>>(new Set());
  const [pendingCollapse, setPendingCollapse] = useState<CollapseScope | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tipDismissed, setTipDismissed] = useState(() => {
    try {
      return localStorage.getItem("tabvault:tipDismissed") === "1";
    } catch {
      return false;
    }
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2400);
  };

  const refresh = useCallback(async () => {
    const [st, wins, list, cols] = await Promise.all([
      sendBg<AppStateSummary>("state"),
      sendBg<SavedWindow[]>("getOpenWindows"),
      sendBg<SnapshotMeta[]>("listSnapshots"),
      sendBg<CollectionRecord[]>("listCollections"),
    ]);
    if (st.recovery) {
      const checked = await sendBg("checkRecoveryNow");
      if (!checked) st.recovery = null;
    }
    setState(st);
    setOpenWindows(wins);
    setMetas(list);
    setCollections(cols);
    applyTheme(st.settings.theme);
  }, []);

  useEffect(() => {
    void refresh().catch((e) => showToast(String(e.message || e)));
    const listener = (msg: { type?: string }) => {
      if (msg?.type === "tabvault:updated") {
        void refresh().catch(() => {});
      }
    };
    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, [refresh]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      setActiveHitIdx(0);
      return;
    }
    const timer = setTimeout(() => {
      void sendBg<SearchHit[]>("searchAll", { q })
        .then((res) => {
          setSearchResults(res);
          setActiveHitIdx(0);
        })
        .catch((e) => showToast(String(e.message || e)));
    }, 150);
    return () => clearTimeout(timer);
  }, [query]);

  const filteredHits = useMemo(() => {
    if (!searchResults) return null;
    if (searchSource === "all") return searchResults;
    return searchResults.filter((h) => h.source === searchSource);
  }, [searchResults, searchSource]);

  const duplicateOpenCount = useMemo(() => {
    const seen = new Set<string>();
    let dupes = 0;
    for (const w of openWindows) {
      for (const t of w.tabs) {
        if (t.pinned) continue;
        if (seen.has(t.url)) dupes++;
        else seen.add(t.url);
      }
    }
    return dupes;
  }, [openWindows]);

  const activateSearchHit = useCallback((hit: SearchHit) => {
    if (hit.source === "open") {
      void sendBg("focusOpenTab", {
        windowId: Number(hit.id) || undefined,
        url: hit.tab.url,
        tabId: hit.tab.id,
      }).then(() => window.close());
    } else {
      void sendBg("openUrl", { url: hit.tab.url }).then(() => window.close());
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inOtherInput =
        target &&
        target !== searchInputRef.current &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      if (e.key === "/" && !inOtherInput && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && query) {
        e.preventDefault();
        setQuery("");
        return;
      }
      if (filteredHits && filteredHits.length > 0 && !inOtherInput) {
        const max = Math.min(filteredHits.length, 50);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveHitIdx((i) => (i + 1) % max);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveHitIdx((i) => (i - 1 + max) % max);
        } else if (e.key === "Enter") {
          e.preventDefault();
          const hit = filteredHits[Math.min(activeHitIdx, max - 1)];
          if (hit) activateSearchHit(hit);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [query, filteredHits, activeHitIdx, activateSearchHit]);

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const match = await sendBg<{ exact: SnapshotMeta | null }>("checkSaveMatch");
      if (match.exact && !sessionName.trim()) {
        showToast(`Already saved as "${match.exact.name}"`);
        return;
      }
      const meta = await sendBg<SnapshotMeta>("saveNamed", { name: sessionName });
      setSessionName("");
      setTab("recent");
      showToast(`Saved "${meta.name}"`);
      await refresh();
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const executeCollapse = async (scope: CollapseScope) => {
    setPendingCollapse(null);
    try {
      const res = await sendBg<{ capturedCount: number }>("collapse", { scope });
      showToast(`Saved & closed ${plural(res.capturedCount, "tab")}`);
      await refresh();
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const handleCollapse = (scope: CollapseScope) => {
    if ((scope === "currentWindow" || scope === "nukeAll") && !state?.settings.bypassConfirm.closeWindow) {
      setPendingCollapse(scope);
      return;
    }
    void executeCollapse(scope);
  };

  const handleRestoreSnap = async (id: string) => {
    try {
      const res = await sendBg<{ opened: number; windows: number; alreadyOpen: number; focusedExisting?: number }>(
        "restoreSnapshot",
        { id }
      );
      if (res.focusedExisting && !res.opened) {
        showToast("Focused already-open window");
      } else {
        showToast(`Opened ${plural(res.opened, "tab")} across ${plural(res.windows || 1, "window")}`);
      }
      await refresh();
    } catch (err) {
      showToast((err as Error).message);
    }
  };

  const openPage = async (page: string) => {
    if (page.startsWith("dashboard.html")) {
      await openOrFocusDashboard(page);
    } else {
      await chrome.tabs.create({ url: chrome.runtime.getURL(page) });
    }
    window.close();
  };

  const rec = state?.recovery;
  const popupWidth = state?.settings.popupWidth || 400;
  const popupHeight = state?.settings.popupHeight || 560;

  return (
    <div
      data-density={state?.settings.uiDensity || "compact"}
      style={{ width: `${popupWidth}px`, height: `${popupHeight}px` }}
      className="flex flex-col bg-[var(--st-bg)] text-[var(--st-ink)] overflow-hidden"
    >
      {/* Header */}
      <header className="px-3 py-2 bg-[var(--st-surface)] border-b border-[var(--st-border)] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <img src="icons/logo.svg" alt="TabVault" className="w-5 h-5 rounded" />
          <div className="min-w-0">
            <div className="font-bold text-[13.5px] leading-tight">TabVault</div>
            <div className="text-[11px] text-[var(--st-muted)] truncate tabular-nums">
              {state?.counts.openWindows ?? 0}w · {state?.counts.openTabs ?? 0}t open
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <HeaderAccountButton state={state} onRefresh={refresh} onToast={showToast} compact />
          <BuyMeACoffeeButton compact />
          <Button
            size="icon-sm"
            variant="outline"
            title="Open Side Panel"
            aria-label="Open Side Panel"
            onClick={() => {
              const targetWinId = openWindows.find((w) => w.focused)?.id ?? openWindows[0]?.id;
              if (targetWinId != null && chrome.sidePanel?.open) {
                void chrome.sidePanel
                  .open({ windowId: targetWinId })
                  .then(() => window.close())
                  .catch((e) => showToast(String((e as Error)?.message || e)));
              } else {
                void sendBg("openSidePanel")
                  .then(() => window.close())
                  .catch((e) => showToast(String((e as Error)?.message || e)));
              }
            }}
          >
            <PanelRight className="w-3.5 h-3.5" />
          </Button>
          <Button size="sm" variant="outline" title="Open full Dashboard & close popup" onClick={() => openPage("dashboard.html")}>
            Dashboard
            <ExternalLink className="w-3 h-3" />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            title="Settings"
            aria-label="Settings"
            onClick={() => openPage("dashboard.html?section=settings")}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      </header>

      <BackupPermissionBanner onToast={showToast} compact />

      {/* Conditional Crash Recovery Banner */}
      {rec && (
        <div className="mx-3 mt-2.5 p-2.5 rounded-lg bg-[var(--st-warn-bg)] border border-[var(--st-warn-bd)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-[var(--st-warn-ink)] shrink-0" />
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-[var(--st-warn-ink)] truncate">
                {plural(rec.missing, "tab")} from your last session didn&apos;t reopen
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              onClick={() =>
                void sendBg("dismissRecovery")
                  .then(refresh)
                  .catch((e) => showToast(String((e as Error)?.message || e)))
              }
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              className="h-6 px-2.5 text-[11px] bg-[var(--st-warn-cta)] text-[var(--st-warn-cta-fg)] hover:opacity-90"
              onClick={() => void handleRestoreSnap(rec.id)}
            >
              Restore
            </Button>
          </div>
        </div>
      )}

      {/* Primary Save + Quick Search */}
      <div className="p-3 bg-[var(--st-surface)] border-b border-[var(--st-border)] space-y-2 shrink-0">
        <form onSubmit={(e) => void handleSaveAll(e)} className="flex gap-1.5">
          <Input
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            placeholder="Name session (optional)…"
            aria-label="Session name (optional)"
            className="flex-1 h-8 text-[12.5px]"
          />
          <Button
            type="submit"
            variant="primary"
            className="h-8 px-3 text-[12px]"
            title="Save all open windows and tabs as a session without closing them"
          >
            <Save className="w-3.5 h-3.5" />
            Save All
          </Button>
        </form>

        {(() => {
          const targetWin = openWindows.find((w) => w.focused) ?? openWindows[0];
          const hasGroups =
            Boolean(targetWin) &&
            ((targetWin!.groups?.length ?? 0) > 0 || targetWin!.tabs.some((t) => t.groupKey != null));
          return (
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant="outline"
                className="h-8 text-[11.5px]"
                title="Move tabs in the current window into a Collection and close the window"
                onClick={() => handleCollapse("currentWindow")}
              >
                To Collection &amp; Close
              </Button>
              <Button
                variant="outline"
                disabled={!targetWin}
                className="h-8 text-[11.5px]"
                title={
                  hasGroups
                    ? "Remove tab groups in the current window"
                    : "Organize current window's tabs into colored Tab Groups by website"
                }
                onClick={() =>
                  void sendBg<{ grouped: number; groupCount: number; ungrouped?: number }>("groupWindowByDomain", {
                    windowId: targetWin?.id,
                  })
                    .then((r) => {
                      showToast(
                        r.ungrouped
                          ? `Ungrouped ${plural(r.ungrouped, "tab")}`
                          : r.grouped
                            ? `Grouped ${plural(r.grouped, "tab")} into ${plural(r.groupCount, "group")}`
                            : "Need 2+ tabs from the same site to group"
                      );
                      return refresh();
                    })
                    .catch((e) => showToast(String((e as Error)?.message || e)))
                }
              >
                <Layers className="w-3.5 h-3.5" />
                {hasGroups ? "Ungroup Tabs" : "Group by Domain"}
              </Button>
            </div>
          );
        })()}

        {pendingCollapse && (
          <div
            role="alertdialog"
            aria-label="Confirm closing browser window"
            className="p-2.5 rounded-lg bg-[var(--st-warn-bg)] border border-[var(--st-warn-bd)] space-y-2"
          >
            <p className="text-[11.5px] font-medium text-[var(--st-warn-ink)] leading-snug">
              {pendingCollapse === "nukeAll"
                ? "Save all open tabs into a Collection and close every browser window?"
                : "Save all tabs in this window into a Collection and close the window?"}
            </p>
            <div className="flex justify-end gap-1.5">
              <Button variant="outline" className="h-8 px-2.5 text-[11.5px]" onClick={() => setPendingCollapse(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                className="h-8 px-2.5 text-[11.5px] bg-[var(--st-warn-cta)] text-[var(--st-warn-cta-fg)] hover:opacity-90"
                onClick={() => void executeCollapse(pendingCollapse)}
              >
                Confirm &amp; Close
              </Button>
            </div>
          </div>
        )}

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--st-muted)] absolute left-2.5 top-2 pointer-events-none" />
          <Input
            ref={searchInputRef}
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search open, saved & collections (↑↓ Enter)…"
            aria-label="Search open, saved sessions, and collections"
            className="w-full h-8 pl-8 bg-[var(--st-subtle)] border-transparent text-[12px]"
          />
        </div>
      </div>

      {/* Tab Strip or Search Source Filter */}
      {filteredHits ? (
        <div className="px-3 py-1.5 bg-[var(--st-surface)] border-b border-[var(--st-border)] flex items-center gap-1 shrink-0">
          {(
            [
              ["all", "All"],
              ["open", "Open"],
              ["snapshot", "Saved"],
              ["collection", "Collections"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setSearchSource(id);
                setActiveHitIdx(0);
              }}
              className={cn(
                "px-2 py-0.5 rounded-md text-[11px] font-semibold cursor-pointer",
                searchSource === id
                  ? "bg-[var(--st-accent-soft)] text-[var(--st-accent)]"
                  : "text-[var(--st-muted)] hover:bg-[var(--st-subtle)]"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 bg-[var(--st-surface)] border-b border-[var(--st-border)] flex gap-4 shrink-0">
          <button
            type="button"
            onClick={() => setTab("open")}
            className={cn(
              "h-8 border-b-2 text-[12px] font-semibold cursor-pointer",
              tab === "open"
                ? "border-[var(--st-accent)] text-[var(--st-accent)]"
                : "border-transparent text-[var(--st-muted)] hover:text-[var(--st-ink)]"
            )}
          >
            Open ({openWindows.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("recent")}
            className={cn(
              "h-8 border-b-2 text-[12px] font-semibold cursor-pointer",
              tab === "recent"
                ? "border-[var(--st-accent)] text-[var(--st-accent)]"
                : "border-transparent text-[var(--st-muted)] hover:text-[var(--st-ink)]"
            )}
          >
            Saved ({metas.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("collections")}
            className={cn(
              "h-8 border-b-2 text-[12px] font-semibold cursor-pointer",
              tab === "collections"
                ? "border-[var(--st-accent)] text-[var(--st-accent)]"
                : "border-transparent text-[var(--st-muted)] hover:text-[var(--st-ink)]"
            )}
          >
            Collections ({collections.filter((c) => c.kind === "group").length})
          </button>
        </div>
      )}

      {/* Scrollable List */}
      <main className="flex-1 overflow-y-auto scroll-thin p-2.5 space-y-1.5">
        {filteredHits ? (
          filteredHits.length === 0 ? (
            <div className="py-10 text-center text-[12px] text-[var(--st-muted)]">No matching tabs found.</div>
          ) : (
            filteredHits.slice(0, 50).map((hit, i) => (
              <button
                key={`${hit.id}-${i}`}
                type="button"
                onMouseEnter={() => setActiveHitIdx(i)}
                onClick={() => activateSearchHit(hit)}
                className={cn(
                  "w-full text-left px-2.5 py-2 rounded-lg border bg-[var(--st-surface)] cursor-pointer flex items-center gap-2",
                  i === activeHitIdx
                    ? "border-[var(--st-accent)] bg-[var(--st-accent-soft)]/45"
                    : "border-[var(--st-border)] hover:border-[var(--st-accent)]"
                )}
              >
                <TabFavicon url={hit.tab.url} title={hit.tab.title} />
                <div className="min-w-0 flex-1">
                  <div
                    className={cn(
                      "text-[12px] font-medium",
                      state?.settings.truncateTitles === false ? "break-words" : "truncate"
                    )}
                  >
                    {hit.tab.title || hit.tab.url}
                  </div>
                  <div className="text-[11px] text-[var(--st-muted)] truncate">
                    {hit.parentTitle} · {formatTabDisplayUrl(hit.tab.url, state?.settings.urlDisplayMode || "domain")}
                  </div>
                </div>
                {i === activeHitIdx && (
                  <span className="px-1.5 py-0.5 rounded bg-[var(--st-accent)] text-[var(--st-accent-fg)] text-[10px] font-semibold shrink-0">
                    {hit.source === "open" ? "↵ Switch" : "↵ Open"}
                  </span>
                )}
              </button>
            ))
          )
        ) : tab === "open" ? (
          <div className="space-y-1.5">
            {duplicateOpenCount > 0 && (
              <div className="px-2.5 py-1.5 rounded-lg bg-[var(--st-subtle)]/80 border border-[var(--st-border)] flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-[var(--st-muted)]">
                  <strong className="text-[var(--st-ink)] font-semibold">{plural(duplicateOpenCount, "duplicate tab")}</strong> open
                </span>
                <Button
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  title="Close duplicate open tabs across all windows (keeps pinned and active tabs)"
                  onClick={() =>
                    void sendBg<{ closed: number }>("dedupeOpenTabs")
                      .then((r) => {
                        showToast(r.closed ? `Tidied ${plural(r.closed, "duplicate tab")}` : "All clean — no duplicates");
                        return refresh();
                      })
                      .catch((e) => showToast(String((e as Error)?.message || e)))
                  }
                >
                  Tidy
                </Button>
              </div>
            )}
            {selectedTabKeys.size > 0 && (
              <div className="px-2.5 py-2 rounded-lg bg-[var(--st-accent-soft)] border border-[var(--st-accent)]/30 flex items-center justify-between gap-2">
                <span className="text-[11.5px] font-semibold">{selectedTabKeys.size} selected</span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setSelectedTabKeys(new Set())}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="primary"
                    className="h-6 px-2.5 text-[11px]"
                    onClick={async () => {
                      const picked = openWindows.flatMap((w, wi) =>
                        w.tabs
                          .filter((t, ti) => selectedTabKeys.has(`${w.id ?? wi}:${t.id ?? ti}`))
                          .map((t) => ({ url: t.url, title: t.title, favIconUrl: t.favIconUrl, pinned: t.pinned }))
                      );
                      try {
                        const res = await sendBg<{ added: number; collection: { title: string } }>("addTabsToCollection", {
                          tabs: picked,
                        });
                        setSelectedTabKeys(new Set());
                        showToast(`Added ${plural(res.added, "tab")} to "${res.collection.title}"`);
                      } catch (err) {
                        showToast((err as Error).message);
                      }
                    }}
                  >
                    Save to Collection
                  </Button>
                </div>
              </div>
            )}
            {openWindows.map((win, idx) => {
              const isExpanded = expandedWinIdx === idx;
              return (
                <div
                  key={win.id ?? idx}
                  className="rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] overflow-hidden"
                >
                  <div
                    onClick={() => setExpandedWinIdx(isExpanded ? null : idx)}
                    onDoubleClick={() => {
                      if (win.id != null && chrome.windows?.update) {
                        void chrome.windows.update(win.id, { focused: true }).then(() => window.close());
                      }
                    }}
                    title="Click to expand · Double-click to focus window"
                    className="px-3 py-2 flex items-center justify-between gap-2 cursor-pointer hover:bg-[var(--st-subtle)]"
                  >
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold truncate">
                        Window {idx + 1}
                        {win.focused ? " · Focused" : ""}
                      </div>
                      <div className="text-[11px] text-[var(--st-muted)] tabular-nums">
                        {plural(win.tabs.length, "tab")} · {isExpanded ? "Hide tabs" : "Pick tabs"}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="h-7 px-2.5 text-[11px]"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const meta = await sendBg<SnapshotMeta>("saveNamed", { windowId: win.id });
                          showToast(`Saved "${meta.name}"`);
                          await refresh();
                        } catch (err) {
                          showToast((err as Error).message);
                        }
                      }}
                    >
                      Save Window
                    </Button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-[var(--st-border)] bg-[var(--st-bg)] divide-y divide-[var(--st-border)] max-h-44 overflow-y-auto scroll-thin">
                      {win.tabs.map((t, ti) => {
                        const key = `${win.id ?? idx}:${t.id ?? ti}`;
                        const checked = selectedTabKeys.has(key);
                        return (
                          <div
                            key={key}
                            onClick={() =>
                              setSelectedTabKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })
                            }
                            className="px-2.5 py-1.5 flex items-center gap-2 hover:bg-[var(--st-subtle)] cursor-pointer"
                          >
                            <Checkbox checked={checked} onCheckedChange={() => {}} ariaLabel={`Select ${t.title || t.url}`} />
                            <TabFavicon url={t.url} title={t.title} />
                            <span
                              className={cn(
                                "text-[11.5px] flex-1",
                                state?.settings.truncateTitles === false ? "break-words" : "truncate"
                              )}
                            >
                              {t.title || t.url}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : tab === "recent" ? (
          metas.slice(0, 20).map((m) => (
            <div
              key={m.id}
              className="px-3 py-2 rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-[12.5px] font-semibold truncate">
                  {m.name || formatTimestamp(m.t, "absolute")}
                </div>
                <div className="text-[11px] text-[var(--st-muted)] tabular-nums">
                  {plural(m.w, "window")} · {plural(m.n, "tab")} ·{" "}
                  {formatTimestamp(m.t, state?.settings.timestampMode || "relative")}
                </div>
              </div>
              <Button variant="outline" className="h-7 px-2.5 text-[11px]" title="Restore this saved session" onClick={() => void handleRestoreSnap(m.id)}>
                Restore
              </Button>
            </div>
          ))
        ) : (
          collections.filter((c) => c.kind === "group" && !c.archived).length === 0 ? (
            <div className="py-10 text-center text-[12px] text-[var(--st-muted)]">
              No collections yet. Select tabs or use &ldquo;Save &amp; Close Window&rdquo; to create one.
            </div>
          ) : (
            collections
              .filter((c) => c.kind === "group" && !c.archived)
              .map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "px-3 py-2 rounded-lg border bg-[var(--st-surface)] flex items-center justify-between gap-2",
                    c.trackingWindowId != null ? "border-[var(--st-accent)]" : "border-[var(--st-border)]"
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-semibold truncate flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: c.color || "var(--st-accent)" }}
                      />
                      <span className="truncate">{c.title}</span>
                      {c.trackingWindowId != null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--st-accent-soft)] text-[var(--st-accent)] shrink-0">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--st-muted)] tabular-nums">
                      {plural(c.items.filter((i) => !i.archived).length, "tab")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      className="h-7 px-2.5 text-[11px]"
                      title="Open collection in a new window"
                      onClick={() =>
                        void sendBg<{ opened: number }>("restoreCollection", { id: c.id, modeOverride: "newWindow" })
                          .then((res) => {
                            showToast(`Opened ${plural(res.opened, "tab")}`);
                            return refresh();
                          })
                          .catch((e) => showToast(String((e as Error)?.message || e)))
                      }
                    >
                      Open
                    </Button>
                    <Button
                      size="icon"
                      variant={c.trackingWindowId != null ? "primary" : "ghost"}
                      className="h-7 w-7"
                      title="Save current window and replace it with this collection"
                      aria-label={`Switch current window to ${c.title}`}
                      onClick={() => {
                        if (c.trackingWindowId == null && !state?.settings.bypassConfirm.replace) {
                          if (!window.confirm(`Save current window tabs and replace this window with "${c.title}"?`)) {
                            return;
                          }
                        }
                        void sendBg("switchSpace", { collectionId: c.id })
                          .then(() => {
                            showToast(`Switched to "${c.title}"`);
                            return refresh();
                          })
                          .catch((e) => showToast(String((e as Error)?.message || e)));
                      }}
                    >
                      <ArrowLeftRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))
          )
        )}
      </main>

      {!tipDismissed && (
        <div className="px-3 py-1.5 bg-[var(--st-subtle)]/70 border-t border-[var(--st-border)] flex items-center justify-between gap-2 text-[11px] text-[var(--st-muted)] shrink-0">
          <div className="min-w-0 truncate">
            Tip: Type <code className="px-1 py-0.5 rounded bg-[var(--st-surface)] border border-[var(--st-border)] text-[var(--st-ink)] font-semibold">st</code> + Tab in address bar to search · <kbd className="font-semibold text-[var(--st-ink)]">Alt+Shift+S</kbd> saves all
          </div>
          <button
            type="button"
            aria-label="Dismiss tip"
            title="Dismiss tip"
            className="text-[var(--st-muted)] hover:text-[var(--st-ink)] shrink-0 cursor-pointer"
            onClick={() => {
              setTipDismissed(true);
              try {
                localStorage.setItem("tabvault:tipDismissed", "1");
              } catch {
                /* ignore */
              }
            }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="px-3 py-2 bg-[var(--st-surface)] border-t border-[var(--st-border)] flex items-center justify-between gap-2 shrink-0">
        <span className="text-[11px] text-[var(--st-muted)] truncate">
          {state?.lastSaveAt ? `Protected · ${formatTimestamp(state.lastSaveAt, "relative")}` : "Auto-save ready"}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <QuickIntervalButton state={state} onRefresh={refresh} onToast={showToast} compact />
          <Button
            variant="outline"
            className="h-7 px-2.5 text-[11px]"
            title="Restore your most recent saved or auto-saved session"
            onClick={() => {
              const latest = metas[0];
              if (latest) void handleRestoreSnap(latest.id);
              else showToast("Nothing saved yet");
            }}
          >
            <RotateCcw className="w-3 h-3" />
            Restore Latest
          </Button>
        </div>
      </footer>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-11 left-1/2 -translate-x-1/2 z-[100] px-3 py-1.5 rounded-full bg-[var(--st-ink)] text-[var(--st-surface)] text-[11.5px] font-medium shadow-lg"
        >
          {toast}
        </div>
      )}
      <GlobalTooltip />
    </div>
  );
}

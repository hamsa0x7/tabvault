import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, ArrowLeftRight, ExternalLink, FolderPlus, Layers, Pin, Plus, RotateCcw, Save, Search, Settings as SettingsIcon, X } from "lucide-react";
import { BackupPermissionBanner, BuyMeACoffeeButton, HeaderAccountButton, QuickIntervalButton } from "../../components/HeaderExtras.tsx";
import { EmptyStateCard, OnboardingCard } from "../../components/OnboardingCard.tsx";
import { Button, GlobalTooltip, Input, TabFavicon, cn } from "../../components/ui.tsx";
import { formatTabDisplayUrl } from "../../shared/core.ts";
import { applyTheme, formatTimestamp, openOrFocusDashboard, plural } from "../../shared/format.ts";
import { useOnboarding } from "../../shared/onboarding.ts";
import { sendBg } from "../../shared/rpc.ts";
import type { AppStateSummary, CollectionRecord, SavedWindow, SearchHit, SnapshotMeta } from "../../shared/types.ts";

export function SidePanelApp() {
  const [state, setState] = useState<AppStateSummary | null>(null);
  const [openWindows, setOpenWindows] = useState<SavedWindow[]>([]);
  const [metas, setMetas] = useState<SnapshotMeta[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [section, setSection] = useState<"open" | "saved" | "collections">("open");
  const [activeWinIdx, setActiveWinIdx] = useState(0);
  const [sessionName, setSessionName] = useState("");
  const [filter, setFilter] = useState("");
  const [searchSource, setSearchSource] = useState<"all" | "open" | "snapshot" | "collection">("all");
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [activeHitIdx, setActiveHitIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [confirmCloseWin, setConfirmCloseWin] = useState(false);
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
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2200);
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
    void refresh().catch((e) => showToast(String((e as Error)?.message || e)));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refresh().catch(() => {});
      }, 200);
    };
    const listener = (msg: { type?: string }) => {
      if (msg?.type === "tabvault:updated") {
        scheduleRefresh();
      }
    };
    const onVisibility = () => {
      if (!document.hidden) scheduleRefresh();
    };
    chrome.runtime?.onMessage?.addListener(listener);
    chrome.tabs?.onCreated?.addListener(scheduleRefresh);
    chrome.tabs?.onRemoved?.addListener(scheduleRefresh);
    chrome.tabs?.onUpdated?.addListener(scheduleRefresh);
    chrome.windows?.onFocusChanged?.addListener(scheduleRefresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      chrome.runtime?.onMessage?.removeListener(listener);
      chrome.tabs?.onCreated?.removeListener(scheduleRefresh);
      chrome.tabs?.onRemoved?.removeListener(scheduleRefresh);
      chrome.tabs?.onUpdated?.removeListener(scheduleRefresh);
      chrome.windows?.onFocusChanged?.removeListener(scheduleRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const q = filter.trim();
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
        .catch((e) => showToast(String((e as Error)?.message || e)));
    }, 150);
    return () => clearTimeout(timer);
  }, [filter]);

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
      });
    } else {
      void sendBg("openUrl", { url: hit.tab.url });
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
      if (e.key === "Escape" && filter) {
        e.preventDefault();
        setFilter("");
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
  }, [filter, filteredHits, activeHitIdx, activateSearchHit]);

  const openDashboard = async (sectionParam?: string) => {
    const path = sectionParam ? `dashboard.html?section=${sectionParam}` : "dashboard.html";
    await openOrFocusDashboard(path);
    window.close();
  };

  useEffect(() => {
    void chrome.runtime?.sendMessage?.({ event: "sidepanelState", open: true }).catch(() => {});
    const onMessage = (msg: { target?: string; cmd?: string }) => {
      if (msg?.target === "sidepanel" && msg?.cmd === "close") {
        window.close();
      }
    };
    const onUnload = () => {
      void chrome.runtime?.sendMessage?.({ event: "sidepanelState", open: false }).catch(() => {});
    };
    chrome.runtime?.onMessage?.addListener(onMessage);
    window.addEventListener("pagehide", onUnload);
    return () => {
      onUnload();
      chrome.runtime?.onMessage?.removeListener(onMessage);
      window.removeEventListener("pagehide", onUnload);
    };
  }, []);

  const handleSaveSession = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSaving(true);
    try {
      const cleanName = sessionName.trim();
      if (!cleanName) {
        const match = await sendBg<{ exact: SnapshotMeta | null }>("checkSaveMatch");
        if (match.exact) {
          showToast(`Already saved as "${match.exact.name}"`);
          return;
        }
      }
      const meta = await sendBg<SnapshotMeta>("saveNamed", { name: cleanName });
      setSessionName("");
      await refresh();
      showToast(`Saved "${meta.name}"`);
    } catch (e) {
      showToast(String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const executeSaveAndCloseWindow = async () => {
    setConfirmCloseWin(false);
    setSaving(true);
    try {
      const res = await sendBg<{ capturedCount: number; closedCount: number }>("collapse", {
        scope: "currentWindow",
        windowId: currentWin?.id,
      });
      await refresh();
      showToast(`Saved ${plural(res.capturedCount, "tab")} to Collections`);
    } catch (e) {
      showToast(String((e as Error)?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndCloseWindow = () => {
    if (!state?.settings.bypassConfirm.closeWindow) {
      setConfirmCloseWin(true);
      return;
    }
    void executeSaveAndCloseWindow();
  };

  const rec = state?.recovery;
  const q = filter.trim().toLowerCase();
  const safeWinIdx = Math.min(activeWinIdx, Math.max(0, openWindows.length - 1));
  const currentWin = openWindows[safeWinIdx] || null;
  const urlMode = state?.settings.urlDisplayMode || "domain";
  const truncateTitles = state?.settings.truncateTitles ?? true;
  const namedCount = metas.filter((m) => m.kind === "named" || m.kind === "imported").length;
  const onboarding = useOnboarding({
    namedCount,
    collectionCount: collections.length,
    suspenderEnabled: state?.settings.suspenderEnabled,
  });

  return (
    <div
      data-density={state?.settings.uiDensity || "compact"}
      className="h-screen flex flex-col overflow-hidden bg-[var(--st-bg)] text-[var(--st-ink)]"
    >
      {/* Pinned Header */}
      <header className="px-3 py-2 bg-[var(--st-surface)] border-b border-[var(--st-border)] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <img src="icons/logo.svg" alt="TabVault" className="w-5 h-5 rounded" />
          <div className="min-w-0">
            <div className="font-bold text-[13.5px] leading-tight truncate">TabVault</div>
            <div className="text-[11px] text-[var(--st-muted)] truncate tabular-nums flex items-center gap-1.5">
              {state?.lastSaveAt ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--st-success)] shrink-0" aria-hidden="true" />
                  <span>Protected · {formatTimestamp(state.lastSaveAt, "relative")}</span>
                </>
              ) : (
                <span>Auto-save ready</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <QuickIntervalButton state={state} onRefresh={refresh} onToast={showToast} compact />
          <HeaderAccountButton state={state} onRefresh={refresh} onToast={showToast} compact />
          <BuyMeACoffeeButton compact />
          <Button
            size="icon-sm"
            variant="outline"
            title="Settings"
            aria-label="Settings"
            onClick={() => openDashboard("settings")}
          >
            <SettingsIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      </header>

      {/* Primary Top Actions */}
      <div className="px-3 py-2 bg-[var(--st-surface)] border-b border-[var(--st-border)] space-y-1.5 shrink-0">
        <form onSubmit={(e) => void handleSaveSession(e)} className="flex items-center gap-1.5">
          <Input
            value={sessionName}
            onChange={(e) => setSessionName(e.target.value)}
            placeholder="Name session (optional)…"
            aria-label="Session name (optional)"
            className="flex-1 h-8 text-[12px]"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={saving}
            className="h-8 px-2.5 text-[12px]"
            title="Save all open windows and tabs as a session without closing them"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? "Saving…" : "Save All"}
          </Button>
        </form>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            disabled={saving || !currentWin}
            className="flex-1 h-8 px-2 text-[11.5px]"
            title="Save current window's tabs into a Collection and keep tabs open"
            onClick={() =>
              void sendBg("saveWindowAsSpace", { windowId: currentWin?.id })
                .then(() => {
                  showToast("Saved window to Collections (kept open)");
                  return refresh();
                })
                .catch((e) => showToast(String((e as Error)?.message || e)))
            }
          >
            <FolderPlus className="w-3.5 h-3.5" />
            To Collection
          </Button>
          <Button
            variant="outline"
            disabled={saving || !currentWin}
            className="h-8 px-2 text-[11.5px]"
            title="Move current window's tabs into a Collection and close the window"
            onClick={() => handleSaveAndCloseWindow()}
          >
            <Archive className="w-3.5 h-3.5" />
            &amp; Close
          </Button>
          <Button
            variant="outline"
            className="h-8 px-2 text-[11.5px] shrink-0"
            title="Open full Dashboard"
            aria-label="Open full Dashboard"
            onClick={() => openDashboard()}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Dashboard
          </Button>
        </div>
      </div>

      {confirmCloseWin && (
        <div
          role="alertdialog"
          aria-label="Confirm closing window"
          className="mx-3 mt-2.5 p-2.5 rounded-lg bg-[var(--st-warn-bg)] border border-[var(--st-warn-bd)] space-y-2 shrink-0"
        >
          <p className="text-[11.5px] font-medium text-[var(--st-warn-ink)] leading-snug">
            Save all tabs in this window into a Collection and close the window?
          </p>
          <div className="flex justify-end gap-1.5">
            <Button variant="outline" className="h-8 px-2.5 text-[11.5px]" onClick={() => setConfirmCloseWin(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="h-8 px-2.5 text-[11.5px] bg-[var(--st-warn-cta)] text-[var(--st-warn-cta-fg)] hover:opacity-90"
              onClick={() => void executeSaveAndCloseWindow()}
            >
              Confirm &amp; Close
            </Button>
          </div>
        </div>
      )}

      <BackupPermissionBanner onToast={showToast} compact />

      {/* Conditional Crash Recovery Banner */}
      {rec && (
        <div className="mx-3 mt-2.5 p-2.5 rounded-lg bg-[var(--st-warn-bg)] border border-[var(--st-warn-bd)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-[var(--st-warn-ink)] shrink-0" />
            <div className="text-[12px] font-semibold text-[var(--st-warn-ink)] truncate">
              {plural(rec.missing, "tab")} from your last session didn&apos;t reopen
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              className="h-6 px-2 text-[11px]"
              title="Dismiss crash recovery alert"
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
              title="Restore tabs from your last session"
              onClick={() =>
                void sendBg<{ opened: number }>("restoreSnapshot", { id: rec.id })
                  .then((res) => {
                    showToast(`Restored ${plural(res.opened, "tab")}`);
                    return refresh();
                  })
                  .catch((e) => showToast(String((e as Error)?.message || e)))
              }
            >
              Restore
            </Button>
          </div>
        </div>
      )}

      {/* Search + Section Tabs */}
      <div className="px-3 pt-2.5 pb-2 bg-[var(--st-surface)] border-b border-[var(--st-border)] space-y-2 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-[var(--st-muted)] absolute left-2.5 top-2 pointer-events-none" />
          <Input
            ref={searchInputRef}
            autoFocus
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search open, saved & collections (Ctrl+K, ↑↓ Enter)…"
            aria-label="Search open, saved sessions, and collections"
            className="w-full h-7.5 pl-8 bg-[var(--st-subtle)] border-transparent text-[12px]"
          />
        </div>

        {filteredHits ? (
          <div className="flex items-center gap-1">
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
          <div className="flex items-center gap-3 -mb-2">
            {(
              [
                ["open", `Open (${openWindows.length})`],
                ["saved", `Saved (${metas.length})`],
                ["collections", `Collections (${collections.length})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "h-8 border-b-2 text-[12px] font-semibold cursor-pointer",
                  section === id
                    ? "border-[var(--st-accent)] text-[var(--st-accent)]"
                    : "border-transparent text-[var(--st-muted)] hover:text-[var(--st-ink)]"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Per-Window Tabs when viewing Current */}
      {!filteredHits && section === "open" && openWindows.length > 0 && (
        <div className="px-3 bg-[var(--st-surface)] border-b border-[var(--st-border)] flex items-center gap-1 overflow-x-auto scroll-thin shrink-0">
          {openWindows.map((w, idx) => (
            <button
              key={w.id ?? idx}
              type="button"
              onClick={() => setActiveWinIdx(idx)}
              onDoubleClick={() => {
                if (w.id != null && chrome.windows?.update) {
                  void chrome.windows.update(w.id, { focused: true });
                }
              }}
              title="Click to view tabs · Double-click to focus window"
              className={cn(
                "h-8 px-2.5 border-b-2 text-[11.5px] font-semibold whitespace-nowrap cursor-pointer",
                safeWinIdx === idx
                  ? "border-[var(--st-accent)] text-[var(--st-accent)]"
                  : "border-transparent text-[var(--st-muted)] hover:text-[var(--st-ink)]"
              )}
            >
              Window {idx + 1} ({w.tabs.length})
            </button>
          ))}
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
                  <div className={cn("text-[12px] font-medium", truncateTitles ? "truncate" : "break-words")}>
                    {hit.tab.title || hit.tab.url}
                  </div>
                  <div className="text-[11px] text-[var(--st-muted)] truncate">
                    {hit.parentTitle} · {formatTabDisplayUrl(hit.tab.url, urlMode === "none" ? "domain" : urlMode)}
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
        ) : section === "open" ? (
          <>
            {onboarding.shouldShow && !q && (
              <OnboardingCard
                variant="compact"
                autoSaveIntervalMin={state?.settings.autoSaveIntervalMin ?? 5}
                progress={onboarding.progress}
                onDismiss={onboarding.dismiss}
                steps={[
                  {
                    id: "save-session",
                    title: "Save your first named session",
                    description: "Capture open windows so you can restore them anytime.",
                    done: onboarding.progress.savedSession,
                    actionLabel: saving ? "Saving…" : "Save",
                    disabled: saving,
                    onAction: () => void handleSaveSession(),
                  },
                  {
                    id: "create-collection",
                    title: "Turn a window into a Collection",
                    description: "Group a window's tabs into a reusable workspace.",
                    done: onboarding.progress.createdCollection,
                    actionLabel: "Save Win",
                    disabled: !currentWin,
                    onAction: () =>
                      void sendBg("saveWindowAsSpace", { windowId: currentWin?.id })
                        .then(() => {
                          showToast("Saved current window as Collection");
                          return refresh();
                        })
                        .catch((e) => showToast(String((e as Error)?.message || e))),
                  },
                  {
                    id: "enable-tab-sleep",
                    title: "Enable Tab Sleep (save RAM)",
                    description: "Automatically discard idle tabs to keep Chrome fast.",
                    done: onboarding.progress.tabSleepEnabled,
                    actionLabel: "Enable",
                    onAction: () =>
                      void sendBg("setSettings", { patch: { suspenderEnabled: true } })
                        .then(() => {
                          showToast("Tab Sleep enabled");
                          return refresh();
                        })
                        .catch((e) => showToast(String((e as Error)?.message || e))),
                  },
                  {
                    id: "open-dashboard",
                    title: "Explore Dashboard & shortcuts",
                    description: "Search all tabs with Ctrl+K or type st in the address bar.",
                    done: onboarding.progress.exploredGuide,
                    actionLabel: "Open",
                    onAction: () => {
                      onboarding.markGuideExplored();
                      openDashboard();
                    },
                  },
                ]}
              />
            )}
            {!currentWin ? (
              <div className="py-10 text-center text-[12px] text-[var(--st-muted)]">No open windows.</div>
            ) : (
            <div className="space-y-1.5">
              <div className="px-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-[var(--st-muted)] tabular-nums">
                  {plural(currentWin.tabs.length, "open tab")}
                </span>
                <div className="flex items-center gap-1">
                  {duplicateOpenCount > 0 && (
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
                      Tidy {duplicateOpenCount} Dupes
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    title={
                      (currentWin.groups?.length ?? 0) > 0 || currentWin.tabs.some((t) => t.groupKey != null)
                        ? "Remove tab groups in this window"
                        : "Organize this window's tabs into colored Tab Groups by website"
                    }
                    onClick={() =>
                      void sendBg<{ grouped: number; groupCount: number; ungrouped?: number }>("groupWindowByDomain", {
                        windowId: currentWin.id,
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
                    <Layers className="w-3 h-3" />
                    {(currentWin.groups?.length ?? 0) > 0 || currentWin.tabs.some((t) => t.groupKey != null)
                      ? "Ungroup Tabs"
                      : "Group by Domain"}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] divide-y divide-[var(--st-border)]">
                {currentWin.tabs
                  .filter((t) => !q || `${t.title} ${t.url}`.toLowerCase().includes(q))
                  .map((t, ti) => (
                    <div
                      key={t.id ?? ti}
                      className="st-tab-row row-hover px-2.5 py-2 flex items-center justify-between gap-2 hover:bg-[var(--st-subtle)]"
                    >
                    <button
                      type="button"
                      onClick={() => void sendBg("focusOpenTab", { windowId: currentWin.id, url: t.url, tabId: t.id })}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                    >
                      <TabFavicon url={t.url} title={t.title} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium flex items-center gap-1 min-w-0">
                          {t.pinned && <Pin className="w-3 h-3 text-[var(--st-accent)] shrink-0" />}
                          <span className={truncateTitles ? "truncate" : "break-words"}>{t.title || t.url}</span>
                        </div>
                        <div className="text-[11px] text-[var(--st-muted)] truncate">
                          {formatTabDisplayUrl(t.url, urlMode === "none" ? "domain" : urlMode)}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void sendBg("closeOpenTab", { windowId: currentWin.id, url: t.url, tabId: t.id })
                          .then(refresh)
                          .catch((e) => showToast(String((e as Error)?.message || e)))
                      }
                      title="Close tab"
                      aria-label={`Close ${t.title || t.url}`}
                      className="row-actions w-6 h-6 rounded hover:bg-[var(--st-border)] grid place-items-center text-[var(--st-muted)] cursor-pointer shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          </>
        ) : section === "saved" ? (
          (() => {
            const visibleMetas = metas.filter((m) => !q || (m.name || "").toLowerCase().includes(q)).slice(0, 25);
            if (visibleMetas.length === 0) {
              if (q) {
                return (
                  <div className="py-10 px-3 text-center text-[12px] text-[var(--st-muted)]">
                    No matching saved sessions.
                  </div>
                );
              }
              return (
                <EmptyStateCard
                  compact
                  icon={<Layers className="w-4 h-4" />}
                  title="No saved sessions yet"
                  description="Named sessions stay pinned forever so you can restore your open windows in one click."
                  primaryLabel={saving ? "Saving…" : "Save This Session"}
                  onPrimary={() => void handleSaveSession()}
                  secondaryLabel="Import Tabs"
                  onSecondary={() => openDashboard("named")}
                />
              );
            }
            return visibleMetas.map((m) => (
              <div
                key={m.id}
                className="px-3 py-2 rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold truncate">
                    {m.name || formatTimestamp(m.t, "absolute")}
                  </div>
                  <div className="text-[11px] text-[var(--st-muted)] tabular-nums flex items-center gap-1.5">
                    <span className="px-1.5 py-0.2 rounded bg-[var(--st-subtle)] text-[10px] font-medium">
                      {m.kind === "named" ? "Saved" : m.kind === "imported" ? "Imported" : m.kind === "windowClose" ? "Closed" : "Auto"}
                    </span>
                    <span className="truncate">
                      {plural(m.w, "window")} · {plural(m.n, "tab")} · {formatTimestamp(m.t, state?.settings.timestampMode || "relative")}
                    </span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  onClick={() =>
                    void sendBg("restoreSnapshot", { id: m.id })
                      .then(() => showToast("Restored session"))
                      .catch((e) => showToast(String((e as Error)?.message || e)))
                  }
                >
                  <RotateCcw className="w-3 h-3" />
                  Restore
                </Button>
              </div>
            ));
          })()
        ) : (
          <div className="space-y-2">
            <Button
              variant="outline"
              className="w-full h-8 text-[12px]"
              title="Save the current window's tabs as a Collection so you can switch back to it anytime"
              onClick={() =>
                void sendBg("saveWindowAsSpace", { windowId: currentWin?.id })
                  .then(() => {
                    showToast("Saved current window as Collection");
                    return refresh();
                  })
                  .catch((e) => showToast(String((e as Error)?.message || e)))
              }
            >
              <Plus className="w-3.5 h-3.5" />
              Save Window as Collection
            </Button>
            {(() => {
              const visibleCols = collections.filter((c) => !q || c.title.toLowerCase().includes(q));
              if (visibleCols.length === 0) {
                if (q) {
                  return (
                    <div className="py-8 px-3 text-center text-[12px] text-[var(--st-muted)]">
                      No matching collections.
                    </div>
                  );
                }
                return (
                  <EmptyStateCard
                    compact
                    icon={<FolderPlus className="w-4 h-4" />}
                    title="No collections yet"
                    description="Turn any browser window into a reusable workspace you can switch between anytime."
                    primaryLabel="Save Current Window"
                    onPrimary={() =>
                      void sendBg("saveWindowAsSpace", { windowId: currentWin?.id })
                        .then(() => {
                          showToast("Saved current window as Collection");
                          return refresh();
                        })
                        .catch((e) => showToast(String((e as Error)?.message || e)))
                    }
                  />
                );
              }
              return visibleCols.map((c) => (
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
                    <div className="text-[11px] text-[var(--st-muted)] tabular-nums">{plural(c.items.length, "tab")}</div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      className="h-7 px-2.5 text-[11px]"
                      title="Open collection tabs in a new window"
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
                      variant={c.trackingWindowId != null ? "primary" : "outline"}
                      className="h-7 w-7"
                      title={
                        c.trackingWindowId != null
                          ? "Active workspace — click to refocus or sync"
                          : "Save current window first, then replace current window with this collection"
                      }
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
              ));
            })()}
          </div>
        )}
      </main>

      {!tipDismissed && (
        <div className="px-3 py-1.5 bg-[var(--st-subtle)]/70 border-t border-[var(--st-border)] flex items-center justify-between gap-2 text-[11px] text-[var(--st-muted)] shrink-0">
          <div className="min-w-0 truncate">
            Tip: Type <code className="px-1 py-0.5 rounded bg-[var(--st-surface)] border border-[var(--st-border)] text-[var(--st-ink)] font-semibold">st</code> + Tab in address bar to search · <kbd className="font-semibold text-[var(--st-ink)]">Alt+Shift+S</kbd> saves all
            {state?.settings.localBackupSchedule === "off" && (
              <>
                {" · "}
                <button
                  type="button"
                  className="text-[var(--st-accent)] font-medium hover:underline cursor-pointer"
                  onClick={async () => {
                    try {
                      if (chrome.permissions?.request) {
                        const ok = await chrome.permissions.request({ permissions: ["downloads"] }).catch(() => false);
                        if (!ok) {
                          showToast("Downloads permission is needed for weekly backups.");
                          return;
                        }
                      }
                      await sendBg("setSettings", { patch: { localBackupSchedule: "weekly" } });
                      await refresh();
                      showToast("Weekly Downloads backup enabled");
                    } catch (e) {
                      showToast(String((e as Error)?.message || e));
                    }
                  }}
                >
                  Enable weekly backup
                </button>
              </>
            )}
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

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[100] px-3 py-1.5 rounded-full bg-[var(--st-ink)] text-[var(--st-surface)] text-[11.5px] font-medium shadow-lg"
        >
          {toast}
        </div>
      )}
      <GlobalTooltip />
    </div>
  );
}

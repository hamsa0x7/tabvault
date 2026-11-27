import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertCircle,
  AlertTriangle,
  Bookmark,
  BookOpen,
  ExternalLink,
  Folder,
  FolderPlus,
  HelpCircle,
  History,
  Layers,
  Lightbulb,
  Lock,
  Monitor,
  PanelRight,
  Pin,
  Plus,
  Redo2,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Star,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { BackupPermissionBanner, BuyMeACoffeeButton, FeedbackDialog, HeaderAccountButton, QuickIntervalButton } from "../../components/HeaderExtras.tsx";
import { EmptyStateCard, OnboardingCard } from "../../components/OnboardingCard.tsx";
import { BackupsPanel } from "./BackupsPanel.tsx";
import { Button, Checkbox, DashboardSkeleton, GlobalTooltip, Input, Select, TabFavicon, cn } from "../../components/ui.tsx";
import {
  type DateFilter,
  type NavSection,
  type SortOrder,
  kindLabel,
  useDashboardController,
} from "../../hooks/useDashboardController.ts";
import { formatTabDisplayUrl, isStaleItem } from "../../shared/core.ts";
import { formatAgo, formatTimestamp, plural } from "../../shared/format.ts";
import { useOnboarding } from "../../shared/onboarding.ts";
import { sendBg } from "../../shared/rpc.ts";
import type { SnapshotMeta } from "../../shared/types.ts";
import { OptionsApp } from "../options/OptionsApp.tsx";
import { DashboardDialogs } from "./DashboardDialogs.tsx";
import { DashboardInspector } from "./DashboardInspector.tsx";
import { GROUP_DOT_COLORS, groupWindowTabs, historyGroupLabel } from "./dashboardUtils.tsx";

export function DashboardApp() {
  const ctrl = useDashboardController();
  const [activeWinIdx, setActiveWinIdx] = useState<number | "all">(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);

  useEffect(() => {
    const syncSidePanelState = async () => {
      try {
        const ctxs = await chrome.runtime?.getContexts?.({
          contextTypes: [chrome.runtime.ContextType.SIDE_PANEL],
        });
        if (ctxs) setSidePanelOpen(ctxs.length > 0);
      } catch {
        /* ignore */
      }
    };
    void syncSidePanelState();
    const onMsg = (msg: { event?: string; open?: boolean }) => {
      if (msg?.event === "sidepanelState" && typeof msg.open === "boolean") {
        setSidePanelOpen(msg.open);
      }
    };
    chrome.runtime?.onMessage?.addListener(onMsg);
    return () => chrome.runtime?.onMessage?.removeListener(onMsg);
  }, []);
  const [staleOnly, setStaleOnly] = useState(false);
  const [settingsCategory, setSettingsCategory] = useState<"general" | "tabs" | "backups" | "data">("general");
  const [guideOpen, setGuideOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackKind, setFeedbackKind] = useState<"issue" | "recommendation">("issue");
  const [searchSource, setSearchSource] = useState<"all" | "open" | "snapshot" | "collection">("all");
  const [selectedOpenTabKeys, setSelectedOpenTabKeys] = useState<Set<string>>(new Set());
  const [targetCollectionForSelected, setTargetCollectionForSelected] = useState<string>("");
  const [dragOverCollectionsNav, setDragOverCollectionsNav] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const namedCount = useMemo(
    () => ctrl.snapshots.filter((s) => s.kind === "named" || s.kind === "imported").length,
    [ctrl.snapshots]
  );
  const onboarding = useOnboarding({
    namedCount,
    collectionCount: ctrl.collections.length,
    suspenderEnabled: ctrl.settings?.suspenderEnabled,
  });

  useEffect(() => {
    setStaleOnly(false);
  }, [ctrl.section]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !inInput) {
        if (e.shiftKey) {
          if (ctrl.canRedo) {
            e.preventDefault();
            void ctrl.handleRedo();
          }
        } else if (ctrl.canUndo) {
          e.preventDefault();
          void ctrl.handleUndo();
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === "y" && !inInput && ctrl.canRedo) {
        e.preventDefault();
        void ctrl.handleRedo();
      } else if (e.key === "/" && !inInput) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape") {
        if (drawerOpen) setDrawerOpen(false);
        else if (ctrl.searchQuery) ctrl.setSearchQuery("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen, ctrl]);

  const { state, settings, openWindows, visibleSnapshots, visibleCollections } = ctrl;
  const tsMode = settings?.timestampMode || "relative";
  const urlMode = settings?.urlDisplayMode || "domain";

  const activeSection: NavSection = ctrl.section === "overview" ? "open" : ctrl.section;

  const staleSessions = useMemo(
    () => visibleSnapshots.filter((s) => isStaleItem(s)),
    [visibleSnapshots]
  );
  const staleCollections = useMemo(
    () => visibleCollections.filter((c) => isStaleItem(c)),
    [visibleCollections]
  );
  const displayedSavedSnapshots = staleOnly ? staleSessions : visibleSnapshots;
  const displayedCollections = staleOnly ? staleCollections : visibleCollections;
  const filteredSearchHits = useMemo(() => {
    if (!ctrl.searchHits) return null;
    if (searchSource === "all") return ctrl.searchHits;
    return ctrl.searchHits.filter((h) => h.source === searchSource);
  }, [ctrl.searchHits, searchSource]);

  const groupedHistory = useMemo(() => {
    const map = new Map<string, SnapshotMeta[]>();
    for (const s of visibleSnapshots) {
      const label = historyGroupLabel(s.t);
      const list = map.get(label) || [];
      list.push(s);
      map.set(label, list);
    }
    return Array.from(map.entries());
  }, [visibleSnapshots]);

  if (!settings) {
    return <DashboardSkeleton />;
  }

  const safeWinIdx =
    activeWinIdx === "all" ? "all" : Math.min(activeWinIdx, Math.max(0, openWindows.length - 1));
  const displayedWindows =
    safeWinIdx === "all" ? openWindows : openWindows[safeWinIdx] ? [openWindows[safeWinIdx]] : [];

  const navItems: Array<{ id: NavSection; label: string; icon: typeof Monitor; badge?: string | number }> = [
    {
      id: "open",
      label: "Current Session",
      icon: Monitor,
      badge: `${state?.counts.openWindows ?? 0}w · ${state?.counts.openTabs ?? 0}t`,
    },
    { id: "named", label: "Saved Sessions", icon: Bookmark, badge: state?.counts.named ?? 0 },
    { id: "collections", label: "Collections", icon: Layers, badge: ctrl.collections.length },
    { id: "auto", label: "Auto-Save History", icon: History, badge: state?.counts.auto ?? 0 },
  ];

  const isSessionPinned = ctrl.selectedSnapshot
    ? ctrl.pinnedBookmarks.has(`session:${ctrl.selectedSnapshot.id}`)
    : false;
  const isCollectionPinned = ctrl.selectedCollection
    ? ctrl.pinnedBookmarks.has(`collection:${ctrl.selectedCollection.id}`)
    : false;

  return (
    <div
      data-density={settings.uiDensity || "compact"}
      className="h-screen flex flex-col overflow-hidden bg-[var(--st-bg)] text-[var(--st-ink)]"
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-md focus:bg-[var(--st-accent)] focus:text-[var(--st-accent-fg)] focus:text-xs focus:font-semibold"
      >
        Skip to main content
      </a>
      {/* Conditional Crash Recovery Banner */}
      {state?.recovery && (
        <div className="px-5 py-2 bg-[var(--st-warn-bg)] border-b border-[var(--st-warn-bd)] text-[var(--st-warn-ink)] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 text-[13px] min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="font-semibold">Recovery ready:</span>
            <span className="truncate tabular-nums">
              {plural(state.recovery.missing, "tab")} from {plural(state.recovery.w, "window")} didn&apos;t reopen.
            </span>
          </div>
          <div className="order-2 md:order-3 flex items-center gap-1.5 sm:gap-2 shrink-0">
          {(ctrl.canUndo || ctrl.canRedo) && (
            <div className="flex items-center gap-0.5">
              <Button
                size="icon"
                variant="ghost"
                disabled={!ctrl.canUndo || ctrl.busy}
                onClick={() => void ctrl.handleUndo()}
                title="Undo last session or collection edit"
                aria-label="Undo last edit"
              >
                <Undo2 className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={!ctrl.canRedo || ctrl.busy}
                onClick={() => void ctrl.handleRedo()}
                title="Redo last session or collection edit"
                aria-label="Redo last edit"
              >
                <Redo2 className="w-4 h-4" />
              </Button>
            </div>
          )}
            <Button
              variant="ghost"
              className="h-7 px-2.5 text-xs"
              onClick={() => void sendBg("dismissRecovery").then(ctrl.loadAll)}
            >
              Dismiss
            </Button>
            <Button
              variant="primary"
              className="h-7 px-3 text-xs bg-[var(--st-warn-cta)] text-[var(--st-warn-cta-fg)] hover:opacity-90"
              onClick={() => void ctrl.handleRestoreSnapshot(state.recovery!.id, null, true)}
            >
              Restore Missing
            </Button>
          </div>
        </div>
      )}

      <BackupPermissionBanner onToast={ctrl.notify} />

      {/* Pinned Top Bar */}
      <header className="min-h-[52px] px-3 sm:px-4 py-1.5 bg-[var(--st-surface)] border-b border-[var(--st-border)] flex flex-wrap items-center justify-between gap-2 sm:gap-4 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="icons/logo.svg" alt="TabVault" className="w-6 h-6 rounded shrink-0" />
          <span className="font-bold text-[15px] tracking-tight truncate">TabVault</span>
        </div>

        <div className="order-3 md:order-2 w-full md:w-auto md:flex-1 max-w-xl relative">
          <Search className="w-4 h-4 text-[var(--st-muted)] absolute left-3 top-2 pointer-events-none" />
          <Input
            ref={searchRef}
            type="search"
            aria-label="Search tabs, sessions, or collections"
            value={ctrl.searchQuery}
            onChange={(e) => ctrl.setSearchQuery(e.target.value)}
            placeholder="Search tabs, sessions, or collections (Ctrl+K or /)..."
            className="w-full pl-9 pr-8 bg-[var(--st-subtle)] border-transparent focus:bg-[var(--st-surface)]"
          />
          {ctrl.searchQuery && (
            <button
              type="button"
              onClick={() => ctrl.setSearchQuery("")}
              className="absolute right-2.5 top-2 text-[var(--st-muted)] hover:text-[var(--st-ink)] cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="order-2 md:order-3 flex items-center gap-1.5 sm:gap-2 shrink-0">
          <QuickIntervalButton state={state} onRefresh={ctrl.loadAll} onToast={ctrl.notify} />
          <HeaderAccountButton state={state} onRefresh={ctrl.loadAll} onToast={ctrl.notify} />
          <BuyMeACoffeeButton />
          {(ctrl.canUndo || ctrl.canRedo) && (
            <div className="flex items-center gap-0.5">
              <Button
                size="icon"
                variant="ghost"
                disabled={!ctrl.canUndo || ctrl.busy}
                onClick={() => void ctrl.handleUndo()}
                title="Undo last session or collection edit"
                aria-label="Undo last edit"
              >
                <Undo2 className="w-4 h-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                disabled={!ctrl.canRedo || ctrl.busy}
                onClick={() => void ctrl.handleRedo()}
                title="Redo last session or collection edit"
                aria-label="Redo last edit"
              >
                <Redo2 className="w-4 h-4" />
              </Button>
            </div>
          )}
          {ctrl.duplicateOpenCount > 0 && (
            <Button
              variant="outline"
              onClick={() => void ctrl.handleDedupeOpenTabs()}
              disabled={ctrl.busy}
              title="Close duplicate open tabs across all windows (keeps pinned and active tabs)"
            >
              Close {ctrl.duplicateOpenCount} Duplicates
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => void ctrl.openSaveDialog(null)}
            disabled={ctrl.busy}
            title="Save all open windows and tabs as a named session (keeps everything open)"
          >
            <Plus className="w-3.5 h-3.5" />
            Save All Windows
          </Button>
          <Button
            size="icon"
            variant={sidePanelOpen ? "outline" : "ghost"}
            title={sidePanelOpen ? "Close Side Panel" : "Open Side Panel"}
            aria-label={sidePanelOpen ? "Close Side Panel" : "Open Side Panel"}
            aria-pressed={sidePanelOpen}
            onClick={() => {
              if (sidePanelOpen) {
                setSidePanelOpen(false);
                void chrome.runtime?.sendMessage?.({ target: "sidepanel", cmd: "close" }).catch(() => {});
                return;
              }
              const targetWinId = openWindows.find((w) => w.focused)?.id ?? openWindows[0]?.id;
              if (targetWinId != null && chrome.sidePanel?.open) {
                setSidePanelOpen(true);
                void chrome.sidePanel
                  .open({ windowId: targetWinId })
                  .catch((e) => {
                    setSidePanelOpen(false);
                    ctrl.notify(String((e as Error)?.message || e));
                  });
              } else {
                void sendBg("openSidePanel").catch((e) => ctrl.notify(String((e as Error)?.message || e)));
              }
            }}
          >
            <PanelRight className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="relative"
            title="Quick Guide & Defaults"
            aria-label="Quick Guide & Defaults"
            onClick={() => {
              onboarding.markGuideExplored();
              setGuideOpen(true);
            }}
          >
            <HelpCircle className="w-4 h-4" />
            {!onboarding.progress.exploredGuide && (
              <span className="absolute top-1 right-1 flex h-2.5 w-2.5" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--st-accent)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--st-accent)]" />
              </span>
            )}
          </Button>
        </div>
      </header>

      {/* Locked 3-Zone Workspace */}
      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[248px_minmax(0,1fr)]",
          (activeSection === "named" || activeSection === "auto" || activeSection === "collections") &&
            "lg:grid-cols-[248px_minmax(0,1fr)_340px] xl:grid-cols-[256px_minmax(0,1fr)_420px]"
        )}
      >
        {/* Left Rail */}
        <aside className="bg-[var(--st-surface)] border-b md:border-b-0 md:border-r border-[var(--st-border)] flex flex-col min-h-0 p-2 md:p-2.5 shrink-0">
          <nav className="flex md:flex-col gap-1 md:gap-0.5 md:space-y-0.5 overflow-x-auto md:overflow-x-visible md:overflow-y-auto md:flex-1 scroll-thin">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = activeSection === item.id;
              const isColNav = item.id === "collections";
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    ctrl.setSection(item.id);
                    if (item.id !== "collections") ctrl.setSelectedCollectionId(null);
                  }}
                  onDragOver={
                    isColNav
                      ? (e) => {
                          if (e.dataTransfer.types.includes("application/x-tabvault-tab")) {
                            e.preventDefault();
                            setDragOverCollectionsNav(true);
                          }
                        }
                      : undefined
                  }
                  onDragLeave={
                    isColNav
                      ? () => {
                          setDragOverCollectionsNav(false);
                        }
                      : undefined
                  }
                  onDrop={
                    isColNav
                      ? (e) => {
                          e.preventDefault();
                          setDragOverCollectionsNav(false);
                          const raw = e.dataTransfer.getData("application/x-tabvault-tab");
                          if (!raw) return;
                          try {
                            const tab = JSON.parse(raw) as {
                              url: string;
                              title?: string;
                              favIconUrl?: string;
                              pinned?: boolean;
                            };
                            void sendBg<{ added: number; collection: { id: string; title: string } }>(
                              "addTabsToCollection",
                              { tabs: [tab] }
                            )
                              .then(async (res) => {
                                await ctrl.loadAll();
                                ctrl.notify(`Saved tab to "${res.collection.title}".`);
                              })
                              .catch((err) => ctrl.notify(String((err as Error)?.message || err)));
                          } catch {
                            /* ignore malformed drag payload */
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "w-auto md:w-full shrink-0 h-9 px-2.5 rounded-md flex items-center justify-between gap-2 text-[13px] font-medium transition-colors cursor-pointer",
                    isColNav && dragOverCollectionsNav && "ring-2 ring-[var(--st-accent)] bg-[var(--st-accent-soft)] text-[var(--st-accent)]",
                    active
                      ? "bg-[var(--st-accent-soft)] text-[var(--st-accent)] font-semibold"
                      : "text-[var(--st-muted)] hover:text-[var(--st-ink)] hover:bg-[var(--st-subtle)]"
                  )}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge !== undefined && (
                    <span
                      className={cn(
                        "text-[11px] tabular-nums px-1.5 py-0.5 rounded-full shrink-0",
                        active
                          ? "bg-[var(--st-surface)] text-[var(--st-accent)]"
                          : "bg-[var(--st-subtle)] text-[var(--st-muted)]"
                      )}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => ctrl.setSection("settings")}
              className={cn(
                "md:hidden w-auto shrink-0 h-9 px-2.5 rounded-md flex items-center gap-2 text-[13px] font-medium transition-colors cursor-pointer",
                activeSection === "settings"
                  ? "bg-[var(--st-accent-soft)] text-[var(--st-accent)] font-semibold"
                  : "text-[var(--st-muted)] hover:text-[var(--st-ink)] hover:bg-[var(--st-subtle)]"
              )}
            >
              <SettingsIcon className="w-4 h-4 shrink-0" />
              <span>Settings</span>
            </button>

            <div className="hidden md:block my-2 border-t border-[var(--st-border)]" />

            <div className="hidden md:flex h-9 px-2.5 items-center gap-2.5 text-[13px] font-semibold text-[var(--st-ink)]">
              <SettingsIcon className="w-4 h-4 shrink-0 text-[var(--st-muted)]" />
              <span>Settings</span>
            </div>
            {(
              [
                ["general", "General"],
                ["tabs", "Tab Sleep & Groups"],
                ["backups", "Backups & Sync"],
                ["data", "Import, Privacy & Data"],
              ] as const
            ).map(([catId, label]) => {
              const active = activeSection === "settings" && settingsCategory === catId;
              return (
                <button
                  key={catId}
                  type="button"
                  onClick={() => {
                    setSettingsCategory(catId);
                    ctrl.setSection("settings");
                  }}
                  className={cn(
                    "hidden md:flex w-full h-9 pl-9 pr-2.5 rounded-md items-center text-[13px] font-medium transition-colors cursor-pointer",
                    active
                      ? "bg-[var(--st-accent-soft)] text-[var(--st-accent)] font-semibold"
                      : "text-[var(--st-muted)] hover:text-[var(--st-ink)] hover:bg-[var(--st-subtle)]"
                  )}
                >
                  <span className="truncate">{label}</span>
                </button>
              );
            })}

            <div className="hidden md:block my-2 border-t border-[var(--st-border)]" />

            <button
              type="button"
              onClick={() => {
                setFeedbackKind("issue");
                setFeedbackOpen(true);
              }}
              className="w-auto md:w-full shrink-0 h-9 px-2.5 rounded-md flex items-center gap-2.5 text-[13px] font-medium text-[var(--st-muted)] hover:text-[var(--st-ink)] hover:bg-[var(--st-subtle)] transition-colors cursor-pointer"
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">Report an Issue</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setFeedbackKind("recommendation");
                setFeedbackOpen(true);
              }}
              className="w-auto md:w-full shrink-0 h-9 px-2.5 rounded-md flex items-center gap-2.5 text-[13px] font-medium text-[var(--st-muted)] hover:text-[var(--st-ink)] hover:bg-[var(--st-subtle)] transition-colors cursor-pointer"
            >
              <Lightbulb className="w-4 h-4 shrink-0" />
              <span className="truncate">Recommendations</span>
            </button>
          </nav>

          <div className="hidden md:block pt-2 border-t border-[var(--st-border)] shrink-0">
            <div className="px-2.5 py-1 text-[11px] text-[var(--st-muted)] truncate">
              {state?.lastSaveAt ? `Auto-saved ${formatAgo(state.lastSaveAt)}` : "Auto-save ready"}
            </div>
          </div>
        </aside>

        {/* Center Pane (Pinned Header + Independent Scrollable List) */}
        <main id="main-content" tabIndex={-1} className="flex flex-col min-h-0 min-w-0 overflow-hidden bg-[var(--st-bg)] focus:outline-none">
          {activeSection === "settings" ? (
            <OptionsApp embedded initialCategory={settingsCategory} />
          ) : (
            <>
              {/* Pinned Pane Header */}
              <div className="px-5 pt-3.5 bg-[var(--st-surface)] border-b border-[var(--st-border)] shrink-0">
                {ctrl.searchQuery.trim() ? (
                  <div className="pb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h1 className="text-[16px] font-bold tracking-tight">Search Results</h1>
                      <p className="text-[12px] text-[var(--st-muted)]">
                        {filteredSearchHits ? plural(filteredSearchHits.length, "matching tab") : "Searching..."}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
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
                          onClick={() => setSearchSource(id)}
                          className={cn(
                            "h-7 px-2.5 rounded-md text-[11.5px] font-semibold cursor-pointer",
                            searchSource === id
                              ? "bg-[var(--st-accent-soft)] text-[var(--st-accent)]"
                              : "text-[var(--st-muted)] hover:bg-[var(--st-subtle)]"
                          )}
                        >
                          {label}
                        </button>
                      ))}
                      <Button variant="ghost" onClick={() => ctrl.setSearchQuery("")}>
                        Clear
                      </Button>
                    </div>
                  </div>
                ) : activeSection === "open" ? (
                  <>
                    <div className="flex items-center justify-between gap-3 pb-2.5">
                      <div>
                        <h1 className="text-[16px] font-bold tracking-tight">Current Session</h1>
                        <p className="text-[12px] text-[var(--st-muted)] tabular-nums">
                          {plural(openWindows.length, "open window")} · {plural(state?.counts.openTabs ?? 0, "tab")}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => void ctrl.handleCollapse("nukeAll")}
                        disabled={ctrl.busy}
                        title="Move all open tabs into a Collection and close all browser windows to free memory"
                      >
                        Move All to Collection &amp; Close
                      </Button>
                    </div>

                    {/* Per-Window Tab Strip */}
                    <div className="flex items-center gap-1 overflow-x-auto scroll-thin">
                      {openWindows.map((win, idx) => {
                        const active = safeWinIdx === idx;
                        return (
                          <button
                            key={win.id ?? idx}
                            type="button"
                            onClick={() => setActiveWinIdx(idx)}
                            onDoubleClick={() => {
                              if (win.id != null && chrome.windows?.update) {
                                void chrome.windows.update(win.id, { focused: true });
                              }
                            }}
                            title="Click to view tabs · Double-click to focus window"
                            className={cn(
                              "h-9 px-3 border-b-2 text-[12.5px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer",
                              active
                                ? "border-[var(--st-accent)] text-[var(--st-accent)]"
                                : "border-transparent text-[var(--st-muted)] hover:text-[var(--st-ink)]"
                            )}
                          >
                            {win.focused && <span className="w-1.5 h-1.5 rounded-full bg-[var(--st-success)]" />}
                            <span>Window {idx + 1}</span>
                            <span className="tabular-nums opacity-75">({win.tabs.length})</span>
                          </button>
                        );
                      })}
                      {openWindows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setActiveWinIdx("all")}
                          className={cn(
                            "h-9 px-3 border-b-2 text-[12.5px] font-semibold whitespace-nowrap cursor-pointer",
                            safeWinIdx === "all"
                              ? "border-[var(--st-accent)] text-[var(--st-accent)]"
                              : "border-transparent text-[var(--st-muted)] hover:text-[var(--st-ink)]"
                          )}
                        >
                          All ({state?.counts.openTabs ?? 0})
                        </button>
                      )}
                    </div>
                  </>
                ) : activeSection === "named" ? (
                  <div className="pb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h1 className="text-[16px] font-bold tracking-tight">Saved Sessions</h1>
                      <p className="text-[12px] text-[var(--st-muted)]">
                        Named sessions you intentionally kept
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={staleOnly ? "primary" : "outline"}
                        onClick={() => setStaleOnly((v) => !v)}
                        title="Show sessions untouched for 30+ days"
                      >
                        Stale &gt;30d ({staleSessions.length})
                      </Button>
                      {staleOnly && staleSessions.length > 0 && (
                        <Button
                          variant="danger"
                          onClick={() => void ctrl.handleDeleteSnapshots(staleSessions.map((s) => s.id))}
                        >
                          Clean Stale
                        </Button>
                      )}
                      <Select
                        aria-label="Sort saved sessions"
                        value={ctrl.sortOrder}
                        onChange={(e) => ctrl.setSortOrder(e.target.value as SortOrder)}
                      >
                        <option value="newest">Newest first</option>
                        <option value="oldest">Oldest first</option>
                        <option value="mostTabs">Most tabs</option>
                        <option value="name">Name A–Z</option>
                      </Select>
                      <Button variant="primary" onClick={() => void ctrl.openSaveDialog(null)}>
                        <Plus className="w-3.5 h-3.5" />
                        Save All Windows
                      </Button>
                    </div>
                  </div>
                ) : activeSection === "collections" ? (
                  <div className="pb-3 flex items-center justify-between gap-2">
                    <div>
                      <h1 className="text-[16px] font-bold tracking-tight">Collections</h1>
                      <p className="text-[12px] text-[var(--st-muted)]">
                        Reusable project stacks and tab groups
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant={staleOnly ? "primary" : "outline"}
                        onClick={() => setStaleOnly((v) => !v)}
                        title="Show collections untouched for 30+ days"
                      >
                        Stale &gt;30d ({staleCollections.length})
                      </Button>
                      <Button
                        variant="outline"
                        disabled={ctrl.busy}
                        onClick={() => void ctrl.handleImportReadingList()}
                        title="Import your Chrome Reading List into a new Collection"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        Reading List
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          ctrl.setNewColKind("folder");
                          ctrl.setNewColDialogOpen(true);
                        }}
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        Folder
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => {
                          ctrl.setNewColKind("group");
                          ctrl.setNewColDialogOpen(true);
                        }}
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Collection
                      </Button>
                    </div>
                  </div>
                ) : activeSection === "auto" ? (
                  <div className="pb-3 flex items-center justify-between gap-2">
                    <div>
                      <h1 className="text-[16px] font-bold tracking-tight">Auto-Save History</h1>
                      <p className="text-[12px] text-[var(--st-muted)]">
                        Automatic safety snapshots grouped by day
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select
                        aria-label="Filter history by date"
                        value={ctrl.dateFilter}
                        onChange={(e) => ctrl.setDateFilter(e.target.value as DateFilter)}
                      >
                        <option value="all">All time</option>
                        <option value="today">Today</option>
                        <option value="week">Last 7 days</option>
                        <option value="month">Last 30 days</option>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="pb-3 flex items-center justify-between gap-2">
                    <div>
                      <h1 className="text-[16px] font-bold tracking-tight">Backups &amp; Sync</h1>
                      <p className="text-[12px] text-[var(--st-muted)]">
                        Local file backups, Google Drive sync, and import/export
                      </p>
                    </div>
                    <Button variant="outline" onClick={() => ctrl.setImportDialogOpen(true)}>
                      <Upload className="w-3.5 h-3.5" />
                      Import / Export
                    </Button>
                  </div>
                )}

                {ctrl.checkedIds.size > 0 && (
                  <div className="py-2 border-t border-[var(--st-border)] flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold">{ctrl.checkedIds.size} selected</span>
                    <div className="flex items-center gap-1.5">
                      {ctrl.checkedIds.size >= 2 && (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => void ctrl.handleMergeToSession()}
                            title="Combine selected sessions into one new Saved Session"
                          >
                            Merge Sessions
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => void ctrl.handleMergeSelected()}
                            title="Combine unique tabs from selected sessions into a Collection"
                          >
                            Merge into Collection
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => void ctrl.handleExport("json", Array.from(ctrl.checkedIds))}
                      >
                        Export
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => void ctrl.handleDeleteSnapshots(Array.from(ctrl.checkedIds))}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Scrollable List Area */}
              <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden scroll-thin p-4 space-y-3">
                {onboarding.shouldShow && activeSection === "open" && !ctrl.searchQuery.trim() && (
                  <OnboardingCard
                    variant="wide"
                    autoSaveIntervalMin={settings.autoSaveIntervalMin}
                    progress={onboarding.progress}
                    onDismiss={onboarding.dismiss}
                    onOpenGuide={() => {
                      onboarding.markGuideExplored();
                      setGuideOpen(true);
                    }}
                    steps={[
                      {
                        id: "save-session",
                        title: "Save your first named session",
                        description: "Capture open windows so you can restore them anytime.",
                        done: onboarding.progress.savedSession,
                        actionLabel: "Save Session",
                        onAction: () => void ctrl.openSaveDialog(null),
                      },
                      {
                        id: "create-collection",
                        title: "Create a Collection",
                        description: "Organize project tabs into reusable workspaces.",
                        done: onboarding.progress.createdCollection,
                        actionLabel: "New Collection",
                        onAction: () => ctrl.setNewColDialogOpen(true),
                      },
                      {
                        id: "enable-tab-sleep",
                        title: "Enable Tab Sleep (save RAM)",
                        description: "Automatically discard idle background tabs to keep Chrome fast.",
                        done: onboarding.progress.tabSleepEnabled,
                        actionLabel: "Enable",
                        onAction: () =>
                          void sendBg("setSettings", { patch: { suspenderEnabled: true } })
                            .then(() => {
                              ctrl.notify("Tab Sleep enabled.");
                              return ctrl.loadAll();
                            })
                            .catch((e) => ctrl.notify(String((e as Error)?.message || e))),
                      },
                      {
                        id: "explore-guide",
                        title: "Check shortcuts & defaults",
                        description: "Ctrl+K searches everything; st in Chrome's bar jumps to tabs.",
                        done: onboarding.progress.exploredGuide,
                        actionLabel: "Quick Guide",
                        onAction: () => {
                          onboarding.markGuideExplored();
                          setGuideOpen(true);
                        },
                      },
                    ]}
                  />
                )}
                {ctrl.searchQuery.trim() ? (
                  !filteredSearchHits || filteredSearchHits.length === 0 ? (
                    <div className="py-12 text-center text-[13px] text-[var(--st-muted)]">
                      No matching tabs found.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] divide-y divide-[var(--st-border)]">
                      {filteredSearchHits.slice(0, 80).map((hit, i) => (
                        <div
                          key={`${hit.id}-${i}`}
                          className="row-hover px-3.5 py-2 flex items-center justify-between gap-2.5 hover:bg-[var(--st-subtle)]"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              hit.source === "open"
                                ? void ctrl.handleFocusOpenTab(Number(hit.id) || undefined, hit.tab.url, hit.tab.id)
                                : void sendBg("openUrl", { url: hit.tab.url })
                            }
                            className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                          >
                            <TabFavicon url={hit.tab.url} title={hit.tab.title} />
                            <div className="min-w-0 flex-1">
                              <div
                                className={cn(
                                  "text-[13px] font-medium",
                                  settings.truncateTitles ? "truncate" : "break-words"
                                )}
                              >
                                {hit.tab.title || hit.tab.url}
                              </div>
                              <div className="text-[11.5px] text-[var(--st-muted)] truncate">
                                {hit.parentTitle} ·{" "}
                                {formatTabDisplayUrl(hit.tab.url, urlMode === "none" ? "domain" : urlMode)}
                              </div>
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            {hit.source !== "open" && (
                              <Button
                                variant="ghost"
                                className="h-7 px-2 text-[11px]"
                                title={`Inspect ${hit.parentTitle}`}
                                onClick={() => {
                                  if (hit.source === "collection") {
                                    ctrl.setSection("collections");
                                    ctrl.setSelectedCollectionId(hit.id);
                                    ctrl.setSelectedSnapshotId(null);
                                  } else {
                                    ctrl.setSection(hit.kind === "named" || hit.kind === "imported" ? "named" : "auto");
                                    ctrl.setSelectedSnapshotId(hit.id);
                                    ctrl.setSelectedCollectionId(null);
                                  }
                                  ctrl.setSearchQuery("");
                                  setDrawerOpen(true);
                                }}
                              >
                                Inspect
                              </Button>
                            )}
                            <ExternalLink className="w-3.5 h-3.5 text-[var(--st-muted)] shrink-0" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : activeSection === "open" ? (
                  displayedWindows.length === 0 ? (
                    <div className="py-12 text-center text-[13px] text-[var(--st-muted)]">No open windows found.</div>
                  ) : (
                    displayedWindows.map((win, idx) => {
                      const displayNumber = safeWinIdx === "all" ? idx + 1 : Number(safeWinIdx) + 1;
                      const sections = groupWindowTabs(win);
                      return (
                        <div key={win.id ?? idx} className="space-y-2.5 min-w-0">
                          {selectedOpenTabKeys.size > 0 && idx === 0 && (
                            <div className="px-3.5 py-2 rounded-lg border border-[var(--st-accent)]/40 bg-[var(--st-accent-soft)]/60 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[12.5px] font-semibold tabular-nums">
                                {plural(selectedOpenTabKeys.size, "tab")} selected
                              </span>
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Select
                                  value={targetCollectionForSelected}
                                  onChange={(e) => setTargetCollectionForSelected(e.target.value)}
                                  className="h-7 text-[11.5px]"
                                  aria-label="Target collection"
                                >
                                  <option value="">New Collection</option>
                                  {ctrl.collections
                                    .filter((c) => c.kind === "group")
                                    .map((c) => (
                                      <option key={c.id} value={c.id}>
                                        Add to: {c.title}
                                      </option>
                                    ))}
                                </Select>
                                <Button
                                  variant="primary"
                                  className="h-7 px-2.5 text-[11.5px]"
                                  onClick={async () => {
                                    const picked = openWindows.flatMap((w, wi) =>
                                      w.tabs
                                        .filter((t, ti) => selectedOpenTabKeys.has(`${w.id ?? wi}:${t.id ?? ti}`))
                                        .map((t) => ({
                                          url: t.url,
                                          title: t.title,
                                          favIconUrl: t.favIconUrl,
                                          pinned: t.pinned,
                                        }))
                                    );
                                    try {
                                      const res = await sendBg<{ added: number; collection: { id: string; title: string } }>(
                                        "addTabsToCollection",
                                        {
                                          collectionId: targetCollectionForSelected || undefined,
                                          tabs: picked,
                                        }
                                      );
                                      setSelectedOpenTabKeys(new Set());
                                      await ctrl.loadAll();
                                      ctrl.notify(`Added ${plural(res.added, "tab")} to "${res.collection.title}".`);
                                    } catch (err) {
                                      ctrl.notify(String((err as Error).message || err));
                                    }
                                  }}
                                >
                                  Save to Collection
                                </Button>
                                <Button
                                  variant="ghost"
                                  className="h-7 px-2 text-[11.5px]"
                                  onClick={() => setSelectedOpenTabKeys(new Set())}
                                >
                                  Clear
                                </Button>
                              </div>
                            </div>
                          )}
                          <div className="px-3.5 py-2.5 rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[13.5px] font-semibold">
                                Window {displayNumber}
                                {win.focused ? " · Focused" : ""}
                              </span>
                              <span className="text-[12px] text-[var(--st-muted)] tabular-nums">
                                {plural(win.tabs.length, "tab")}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Button
                                variant="outline"
                                onClick={() => void ctrl.handleGroupWindowByDomain(win.id)}
                                disabled={ctrl.busy}
                                title={
                                  (win.groups?.length ?? 0) > 0 || win.tabs.some((t) => t.groupKey != null)
                                    ? "Remove tab groups in this window"
                                    : "Organize tabs in this window into colored Chrome Tab Groups by website"
                                }
                              >
                                {(win.groups?.length ?? 0) > 0 || win.tabs.some((t) => t.groupKey != null)
                                  ? "Ungroup Tabs"
                                  : "Group by Domain"}
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => void ctrl.openSaveDialog(win.id ?? null)}
                                disabled={ctrl.busy}
                                title="Save only this window's tabs as a named session without closing them"
                              >
                                Save Session
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() =>
                                  void sendBg("saveWindowAsSpace", { windowId: win.id })
                                    .then(async () => {
                                      await ctrl.loadAll();
                                      ctrl.notify("Saved window to Collections (kept open).");
                                    })
                                    .catch((err) => ctrl.notify(String((err as Error)?.message || err)))
                                }
                                disabled={ctrl.busy}
                                title="Save this window's tabs into a Collection without closing them"
                              >
                                Save to Collection
                              </Button>
                              <Button
                                variant="primary"
                                onClick={() => void ctrl.handleCollapse("currentWindow", undefined, win.id)}
                                disabled={ctrl.busy}
                                title="Move this window's tabs into a Collection and close this window"
                              >
                                Move to Collection &amp; Close
                              </Button>
                            </div>
                          </div>

                          {sections.map((sec) => (
                            <div
                              key={sec.key}
                              className="rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] overflow-hidden"
                            >
                              {sec.title && (
                                <div className="px-3.5 py-1.5 bg-[var(--st-subtle)] border-b border-[var(--st-border)] flex items-center justify-between text-[12px] font-semibold">
                                  <span className="flex items-center gap-2">
                                    <span
                                      className="w-2.5 h-2.5 rounded-sm"
                                      style={{
                                        backgroundColor: sec.color ? GROUP_DOT_COLORS[sec.color] : "var(--st-muted)",
                                      }}
                                    />
                                    {sec.title}
                                  </span>
                                  <span className="text-[var(--st-muted)] tabular-nums">
                                    {plural(sec.tabs.length, "tab")}
                                  </span>
                                </div>
                              )}
                              <div className="divide-y divide-[var(--st-border)]">
                                {sec.tabs.map((tab, tIdx) => {
                                  const tabKey = `${win.id ?? idx}:${tab.id ?? tIdx}`;
                                  return (
                                  <div
                                    key={tabKey}
                                    draggable
                                    onDragStart={(e) => {
                                      e.dataTransfer.effectAllowed = "copy";
                                      e.dataTransfer.setData(
                                        "application/x-tabvault-tab",
                                        JSON.stringify({
                                          url: tab.url,
                                          title: tab.title,
                                          favIconUrl: tab.favIconUrl,
                                          pinned: tab.pinned,
                                        })
                                      );
                                    }}
                                    className="st-tab-row row-hover px-3.5 py-2 flex items-center justify-between gap-2.5 min-w-0 hover:bg-[var(--st-subtle)]"
                                  >
                                    <Checkbox
                                      ariaLabel={`Select ${tab.title || tab.url}`}
                                      checked={selectedOpenTabKeys.has(tabKey)}
                                      onCheckedChange={(v) =>
                                        setSelectedOpenTabKeys((prev) => {
                                          const next = new Set(prev);
                                          if (v) next.add(tabKey);
                                          else next.delete(tabKey);
                                          return next;
                                        })
                                      }
                                    />
                                    <button
                                      type="button"
                                      onClick={() => void ctrl.handleFocusOpenTab(win.id, tab.url, tab.id)}
                                      className="flex items-center justify-between gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                                    >
                                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <TabFavicon url={tab.url} title={tab.title} />
                                        <span
                                          className={cn(
                                            "text-[13px] font-medium min-w-0",
                                            settings.truncateTitles ? "truncate" : "break-words"
                                          )}
                                        >
                                          {tab.title || tab.url}
                                        </span>
                                        {tab.pinned && (
                                          <Pin className="w-3 h-3 text-[var(--st-accent)] shrink-0" />
                                        )}
                                        {tab.discarded && (
                                          <span className="text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--st-subtle)] text-[var(--st-muted)] shrink-0">
                                            Sleeping
                                          </span>
                                        )}
                                      </div>
                                      <span className="text-[11.5px] text-[var(--st-muted)] shrink-0">
                                        {formatTabDisplayUrl(tab.url, urlMode === "none" ? "domain" : urlMode)}
                                      </span>
                                    </button>
                                    <div className="row-actions flex items-center gap-1 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => void ctrl.handleCloseOpenTab(win.id, tab.url, tab.id)}
                                        title="Close tab"
                                        aria-label={`Close ${tab.title || tab.url}`}
                                        className="w-7 h-7 rounded hover:bg-[var(--st-border)] grid place-items-center text-[var(--st-muted)] hover:text-[var(--st-ink)] cursor-pointer"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })
                  )
                ) : activeSection === "named" ? (
                  displayedSavedSnapshots.length === 0 ? (
                    staleOnly ? (
                      <div className="py-12 text-center text-[13px] text-[var(--st-muted)]">
                        No stale sessions untouched for 30+ days.
                      </div>
                    ) : (
                      <EmptyStateCard
                        icon={<Layers className="w-5 h-5" />}
                        title="No saved sessions yet"
                        description="Save your open windows to create a named restore point that never expires, or import existing tabs from OneTab, JSON, or Bookmarks HTML."
                        primaryLabel="Save All Windows"
                        onPrimary={() => void ctrl.openSaveDialog(null)}
                        secondaryLabel="Import Sessions"
                        onSecondary={() => ctrl.setImportDialogOpen(true)}
                      />
                    )
                  ) : (
                    <div className="space-y-2">
                      {displayedSavedSnapshots.map((s) => {
                        const selected = ctrl.selectedSnapshotId === s.id;
                        return (
                          <div
                            key={s.id}
                            className={cn(
                              "px-3.5 py-2.5 rounded-lg border bg-[var(--st-surface)] flex items-center justify-between gap-3",
                              selected
                                ? "border-[var(--st-accent)] bg-[var(--st-accent-soft)]/50"
                                : "border-[var(--st-border)] hover:border-[var(--st-accent)]"
                            )}
                          >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <Checkbox
                                ariaLabel={`Select ${s.name || "saved session"}`}
                                checked={ctrl.checkedIds.has(s.id)}
                                onCheckedChange={(v) => {
                                  ctrl.setCheckedIds((prev) => {
                                    const next = new Set(prev);
                                    if (v) next.add(s.id);
                                    else next.delete(s.id);
                                    return next;
                                  });
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  ctrl.setSelectedSnapshotId(s.id);
                                  ctrl.setSelectedCollectionId(null);
                                  setDrawerOpen(true);
                                }}
                                className="min-w-0 flex-1 text-left cursor-pointer"
                              >
                                <div className="text-[13.5px] font-semibold truncate">
                                  {s.name || formatTimestamp(s.t, tsMode)}
                                </div>
                                <div className="text-[12px] text-[var(--st-muted)] tabular-nums">
                                  {plural(s.w, "window")} · {plural(s.n, "tab")} · {formatTimestamp(s.t, tsMode)}
                                </div>
                              </button>
                            </div>
                            <Button
                              variant="outline"
                              onClick={() => void ctrl.handleRestoreSnapshot(s.id)}
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Restore
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : activeSection === "collections" ? (
                  displayedCollections.length === 0 ? (
                    staleOnly ? (
                      <div className="py-12 text-center text-[13px] text-[var(--st-muted)]">
                        No stale collections untouched for 30+ days.
                      </div>
                    ) : (
                      <EmptyStateCard
                        icon={<FolderPlus className="w-5 h-5" />}
                        title="No collections yet"
                        description="Organize tabs into reusable project workspaces or folders you can restore, pin to the Bookmarks Bar, or track live."
                        primaryLabel="New Collection"
                        onPrimary={() => ctrl.setNewColDialogOpen(true)}
                        secondaryLabel="Import Tabs"
                        onSecondary={() => ctrl.setImportDialogOpen(true)}
                      />
                    )
                  ) : (
                    <div className="space-y-2">
                      {displayedCollections
                        .filter((c) => c.kind === "folder" || !c.parentFolderId || !displayedCollections.some((p) => p.id === c.parentFolderId))
                        .map((col) => {
                          const children = col.kind === "folder"
                            ? displayedCollections.filter((c) => c.parentFolderId === col.id)
                            : [];
                          const renderColRow = (itemCol: typeof col, nested = false) => {
                            const selected = ctrl.selectedCollectionId === itemCol.id;
                            const activeCount = itemCol.items.filter((i) => !i.archived).length;
                            return (
                              <div
                                key={itemCol.id}
                                className={cn(
                                  "px-3.5 py-2.5 rounded-lg border bg-[var(--st-surface)] flex items-center justify-between gap-3",
                                  nested && "ml-6",
                                  selected
                                    ? "border-[var(--st-accent)] bg-[var(--st-accent-soft)]/50"
                                    : "border-[var(--st-border)] hover:border-[var(--st-accent)]"
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    ctrl.setSelectedCollectionId(itemCol.id);
                                    ctrl.setSelectedSnapshotId(null);
                                    setDrawerOpen(true);
                                  }}
                                  className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                                >
                                  <span
                                    className="w-7 h-7 rounded-md text-white grid place-items-center shrink-0"
                                    style={{ backgroundColor: itemCol.color || "var(--st-accent)" }}
                                  >
                                    {itemCol.kind === "folder" ? (
                                      <Folder className="w-3.5 h-3.5" />
                                    ) : (
                                      <Layers className="w-3.5 h-3.5" />
                                    )}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="text-[13.5px] font-semibold truncate flex items-center gap-1.5">
                                      <span className="truncate">{itemCol.title}</span>
                                      {itemCol.locked && <Lock className="w-3 h-3 text-[var(--st-muted)] shrink-0" />}
                                      {itemCol.starred && (
                                        <Star className="w-3 h-3 text-[var(--st-star)] fill-[var(--st-star)] shrink-0" />
                                      )}
                                    </div>
                                    <div className="text-[12px] text-[var(--st-muted)] tabular-nums">
                                      {itemCol.kind === "folder"
                                        ? plural(children.length, "collection")
                                        : `${plural(activeCount, "tab")} · ${formatAgo(itemCol.updatedAt)}`}
                                    </div>
                                  </div>
                                </button>
                                {itemCol.kind === "group" && (
                                  <Button
                                    variant="outline"
                                    onClick={() => void ctrl.handleRestoreCollection(itemCol.id, "keep")}
                                  >
                                    Open
                                  </Button>
                                )}
                              </div>
                            );
                          };
                          return (
                            <div key={col.id} className="space-y-1.5">
                              {renderColRow(col, false)}
                              {children.map((child) => renderColRow(child, true))}
                            </div>
                          );
                        })}
                    </div>
                  )
                ) : activeSection === "auto" ? (
                  visibleSnapshots.length === 0 ? (
                    <div className="py-12 text-center text-[13px] text-[var(--st-muted)]">
                      No auto-saves recorded yet.
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {groupedHistory.map(([day, list]) => (
                        <div key={day} className="space-y-1.5">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--st-muted)] flex items-center justify-between">
                            <span>{day}</span>
                            <span className="tabular-nums font-normal">{list.length}</span>
                          </div>
                          {list.map((s) => {
                            const selected = ctrl.selectedSnapshotId === s.id;
                            return (
                              <div
                                key={s.id}
                                className={cn(
                                  "px-3.5 py-2.5 rounded-lg border bg-[var(--st-surface)] flex items-center justify-between gap-3",
                                  selected
                                    ? "border-[var(--st-accent)] bg-[var(--st-accent-soft)]/50"
                                    : "border-[var(--st-border)] hover:border-[var(--st-accent)]"
                                )}
                              >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                  <Checkbox
                                    ariaLabel={`Select ${s.name || "auto-save"}`}
                                    checked={ctrl.checkedIds.has(s.id)}
                                    onCheckedChange={(v) => {
                                      ctrl.setCheckedIds((prev) => {
                                        const next = new Set(prev);
                                        if (v) next.add(s.id);
                                        else next.delete(s.id);
                                        return next;
                                      });
                                    }}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      ctrl.setSelectedSnapshotId(s.id);
                                      ctrl.setSelectedCollectionId(null);
                                      setDrawerOpen(true);
                                    }}
                                    className="min-w-0 flex-1 text-left cursor-pointer"
                                  >
                                    <div className="text-[13px] font-semibold truncate">
                                      {s.name || `${kindLabel(s.kind)} · ${formatTimestamp(s.t, "absolute")}`}
                                    </div>
                                    <div className="text-[12px] text-[var(--st-muted)] tabular-nums">
                                      {kindLabel(s.kind)} · {plural(s.w, "window")} · {plural(s.n, "tab")} ·{" "}
                                      {formatTimestamp(s.t, tsMode)}
                                    </div>
                                  </button>
                                </div>
                                <Button
                                  variant="outline"
                                  onClick={() => void ctrl.handleRestoreSnapshot(s.id)}
                                >
                                  Restore
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <BackupsPanel
                    state={state}
                    settings={settings}
                    tsMode={tsMode}
                    driveSyncPassword={ctrl.driveSyncPassword}
                    onReload={ctrl.loadAll}
                    onNotify={ctrl.notify}
                    onConfigureDrive={() => {
                      setSettingsCategory("backups");
                      ctrl.setSection("settings");
                    }}
                  />
                )}
              </div>
            </>
          )}
        </main>

        {/* Responsive Inspector Backdrop (< lg) */}
        {(activeSection === "named" || activeSection === "auto" || activeSection === "collections") && drawerOpen && (
          <div
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          />
        )}

        {/* Persistent Right Inspector (lg+) / Slide-over Drawer (< lg) */}
        <DashboardInspector
          ctrl={ctrl}
          activeSection={activeSection}
          drawerOpen={drawerOpen}
          onCloseDrawer={() => setDrawerOpen(false)}
          settings={settings}
          tsMode={tsMode}
          urlMode={urlMode}
          isSessionPinned={isSessionPinned}
          isCollectionPinned={isCollectionPinned}
        />
      </div>

      <DashboardDialogs ctrl={ctrl} />

      <FeedbackDialog
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
        initialKind={feedbackKind}
        onToast={ctrl.notify}
      />

      {/* Quick Guide & Defaults Dialog */}
      <Dialog.Root open={guideOpen} onOpenChange={setGuideOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg rounded-2xl border border-[var(--st-border)] bg-[var(--st-surface)] text-[var(--st-ink)] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-[15px] font-bold">Quick Guide &amp; Default Settings</Dialog.Title>
              <Dialog.Close asChild>
                <Button size="icon" variant="ghost" aria-label="Close dialog">
                  <X className="w-4 h-4" />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Overview of TabVault default auto-save, crash recovery, and optional tools.
            </Dialog.Description>

            <div className="space-y-3 text-[12.5px]">
              <div className="p-3 rounded-lg bg-[var(--st-subtle)] space-y-1.5">
                <div className="font-semibold text-[13px]">On by default (zero setup needed)</div>
                <ul className="list-disc pl-4 space-y-1 text-[var(--st-muted)]">
                  <li>
                    <strong className="text-[var(--st-ink)]">Auto-Save &amp; History:</strong> Saves open windows every{" "}
                    {settings.autoSaveIntervalMin} min and on window close (with 70% shrink protection).
                  </li>
                  <li>
                    <strong className="text-[var(--st-ink)]">Crash Recovery:</strong> Alerts you automatically if tabs didn&apos;t reopen on startup.
                  </li>
                  <li>
                    <strong className="text-[var(--st-ink)]">Smart Restore:</strong> Focuses matching open windows and skips already-open tabs instead of duplicating them.
                  </li>
                  <li>
                    <strong className="text-[var(--st-ink)]">Tab Groups &amp; Lazy Load:</strong> Preserves Chrome Tab Groups and discards background tabs on large restores to save RAM.
                  </li>
                </ul>
              </div>

              <div className="p-3 rounded-lg border border-[var(--st-border)] space-y-1.5">
                <div className="font-semibold text-[13px]">Optional (turn on when you want them)</div>
                <ul className="list-disc pl-4 space-y-1 text-[var(--st-muted)]">
                  <li>
                    <strong className="text-[var(--st-ink)]">Automatic Tab Sleep:</strong> Off by default; use{" "}
                    <strong>Sleep Idle</strong> anytime or enable automatic sleeping in <em>Tab Sleep &amp; Groups</em>.
                  </li>
                  <li>
                    <strong className="text-[var(--st-ink)]">Local &amp; Google Drive Backups:</strong> Off by default; configure in <em>Backups &amp; Sync</em>.
                  </li>
                  <li>
                    <strong className="text-[var(--st-ink)]">Bookmarks Bar Pinning:</strong> Click <strong>Pin Bar</strong> on any Saved Session or Collection for 1-click multi-window restore.
                  </li>
                </ul>
              </div>

              <div className="text-[11.5px] text-[var(--st-muted)]">
                Tip: Press <kbd className="px-1.5 py-0.5 rounded bg-[var(--st-subtle)] border border-[var(--st-border)]">Ctrl+K</kbd> or{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-[var(--st-subtle)] border border-[var(--st-border)]">/</kbd> to search everything, or type{" "}
                <code className="px-1 py-0.5 rounded bg-[var(--st-subtle)]">st</code> in Chrome&apos;s address bar.
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <Button
                variant="outline"
                onClick={() => {
                  setGuideOpen(false);
                  onboarding.markGuideExplored();
                  ctrl.setSection("settings");
                }}
              >
                Open Settings
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setGuideOpen(false);
                  onboarding.markGuideExplored();
                }}
              >
                Got it
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {ctrl.toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[100] max-w-md rounded-lg bg-[var(--st-ink)] text-[var(--st-surface)] px-4 py-2 text-[13px] font-medium shadow-lg text-center"
        >
          {ctrl.toast}
        </div>
      )}
      <GlobalTooltip />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmDialogRequest } from "../components/ConfirmDialog.tsx";
import { extractDomain, findDuplicateOpenTabIds } from "../shared/core.ts";
import { DEFAULT_COLLECTION_COLOR } from "../shared/defaults.ts";
import { applyTheme, plural, triggerTextDownload } from "../shared/format.ts";
import {
  collectionToSnapshot,
  exportAsBookmarksHtml,
  exportAsCsv,
  exportAsJson,
  exportAsMarkdown,
  exportAsOneTabText,
  formatWithTemplate,
  SOURCE_LABELS,
} from "../shared/import-export.ts";
import { sendBg } from "../shared/rpc.ts";
import type {
  AppStateSummary,
  CollectionItem,
  CollectionRecord,
  CollapseScope,
  SavedTab,
  SavedWindow,
  SearchHit,
  SessionSnapshot,
  Settings,
  SnapshotKind,
  SnapshotMeta,
} from "../shared/types.ts";

export type NavSection = "overview" | "open" | "auto" | "named" | "collections" | "backups" | "settings";
export type InspectorTab = "tabs" | "versions" | "more";
export type DateFilter = "all" | "today" | "week" | "month";
export type SortOrder = "newest" | "oldest" | "mostTabs" | "name";
export type KindFilter = "all" | "auto" | "windowClose" | "browserExit" | "named" | "imported";

export function kindLabel(kind: SnapshotKind): string {
  switch (kind) {
    case "auto":
      return "Auto-save";
    case "windowClose":
      return "Window closed";
    case "browserExit":
      return "Before exit";
    case "named":
      return "Saved";
    case "imported":
      return "Imported";
  }
}

export function flattenSnapshotTabs(snap: SessionSnapshot | null): SavedTab[] {
  if (!snap) return [];
  const out: SavedTab[] = [];
  for (const w of snap.windows) {
    for (const t of w.tabs) out.push(t);
  }
  return out;
}

export function flattenCollectionTabs(col: CollectionRecord | null): SavedTab[] {
  if (!col) return [];
  return col.items
    .filter((i) => !i.archived)
    .map((i) => ({ url: i.url, title: i.title, pinned: i.pinned, favIconUrl: i.favIconUrl }));
}

export function useDashboardController() {
  const initialQuery = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get("q") || "";
    } catch {
      return "";
    }
  }, []);

  const initialSection = useMemo<NavSection>(() => {
    try {
      const s = new URLSearchParams(window.location.search).get("section");
      if (s === "open" || s === "named" || s === "collections" || s === "auto" || s === "backups" || s === "settings") {
        return s;
      }
      return "open";
    } catch {
      return "open";
    }
  }, []);

  const [state, setState] = useState<AppStateSummary | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [openWindows, setOpenWindows] = useState<SavedWindow[]>([]);

  const [section, setSection] = useState<NavSection>(initialSection);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("tabs");

  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<SessionSnapshot | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [pinnedBookmarks, setPinnedBookmarks] = useState<Set<string>>(new Set());

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [searchHits, setSearchHits] = useState<SearchHit[] | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const [restoreMode, setRestoreMode] = useState<Settings["defaultOpenMode"]>("newWindow");
  const [skipAlreadyOpen, setSkipAlreadyOpen] = useState<boolean>(true);

  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  type EditEntry =
    | { kind: "snapshot"; prev: SessionSnapshot; next: SessionSnapshot }
    | { kind: "collection"; prev: CollectionRecord; next: CollectionRecord };
  const [undoStack, setUndoStack] = useState<EditEntry[]>([]);
  const [redoStack, setRedoStack] = useState<EditEntry[]>([]);

  const pushHistory = useCallback((entry: EditEntry) => {
    setUndoStack((prev) => [...prev.slice(-24), entry]);
    setRedoStack([]);
  }, []);

  // Dialog states
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [saveTagsInput, setSaveTagsInput] = useState("");
  const [saveStartupReg, setSaveStartupReg] = useState(false);
  const [saveWindowId, setSaveWindowId] = useState<number | null>(null);
  const [saveMatchInfo, setSaveMatchInfo] = useState<{
    exact: SnapshotMeta | null;
    closest: { meta: SnapshotMeta; overlap: number } | null;
  } | null>(null);

  const [newColDialogOpen, setNewColDialogOpen] = useState(false);
  const [newColTitle, setNewColTitle] = useState("");
  const [newColKind, setNewColKind] = useState<"group" | "folder">("group");
  const [newColColor, setNewColColor] = useState<string>(DEFAULT_COLLECTION_COLOR);
  const [newColParent, setNewColParent] = useState<string>("");

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPassword, setImportPassword] = useState("");

  const [promoteTargetId, setPromoteTargetId] = useState<string | null>(null);
  const [promoteNameInput, setPromoteNameInput] = useState("");
  const [driveSyncPassword, setDriveSyncPassword] = useState("");

  // Inspector inline edit fields
  const [editSnapName, setEditSnapName] = useState("");
  const [editSnapTags, setEditSnapTags] = useState("");
  const [editColNotes, setEditColNotes] = useState("");
  const [editColTags, setEditColTags] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemNote, setEditingItemNote] = useState("");
  const [showArchivedItems, setShowArchivedItems] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmDialogRequest | null>(null);
  const confirmResolverRef = useRef<((confirmed: boolean) => void) | null>(null);

  const requestConfirm = useCallback((req: ConfirmDialogRequest): Promise<boolean> => {
    confirmResolverRef.current?.(false);
    setConfirmRequest(req);
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }, []);

  const resolveConfirm = useCallback((confirmed: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmRequest(null);
    resolver?.(confirmed);
  }, []);

  const notify = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  const notifyError = useCallback(
    (err: unknown, fallback = "Operation failed.") => {
      notify((err as Error)?.message || fallback);
    },
    [notify]
  );

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const pendingLoadRef = useRef<Promise<void> | null>(null);
  const loadAll = useCallback(() => {
    if (pendingLoadRef.current) return pendingLoadRef.current;
    const promise = (async () => {
      try {
        const [st, snaps, cols, openWins, pinned] = await Promise.all([
          sendBg<AppStateSummary>("state"),
          sendBg<SnapshotMeta[]>("listSnapshots"),
          sendBg<CollectionRecord[]>("listCollections"),
          sendBg<SavedWindow[]>("getOpenWindows"),
          sendBg<string[]>("listPinnedBookmarks").catch(() => []),
        ]);
        setState(st);
        setSnapshots(snaps);
        setCollections(cols);
        setOpenWindows(openWins);
        setPinnedBookmarks(new Set(pinned));
        applyTheme(st.settings.theme);
        setRestoreMode(st.settings.defaultOpenMode);
        setSkipAlreadyOpen(st.settings.skipAlreadyOpenOnCrashRestore);

        setSelectedSnapshotId((prev) => {
          if (prev && snaps.some((s) => s.id === prev)) return prev;
          return snaps[0]?.id ?? null;
        });
      } catch (err) {
        notifyError(err, "Failed to load extension state.");
      } finally {
        pendingLoadRef.current = null;
      }
    })();
    pendingLoadRef.current = promise;
    return promise;
  }, [notifyError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Handle 1-click Bookmarks Bar restore URL (?restore=session:<id>&autoclose=1)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const restoreParam = params.get("restore");
    if (!restoreParam) return;
    const autoClose = params.get("autoclose") === "1";
    const [kind, id] = restoreParam.split(":");
    if (!id) return;

    const run = async () => {
      try {
        if (kind === "session") {
          await sendBg("restoreSnapshot", { id });
        } else if (kind === "collection") {
          await sendBg("restoreCollection", { id });
        }
        if (autoClose) {
          window.close();
        } else {
          await loadAll();
          notify("Restored from bookmark.");
        }
      } catch (err) {
        notifyError(err, "Could not restore bookmarked session.");
      }
    };
    void run();
  }, [loadAll, notify, notifyError]);

  useEffect(() => {
    let updateTimer: ReturnType<typeof setTimeout> | null = null;
    const listener = (msg: { type?: string; message?: string }) => {
      if (msg?.type === "tabvault:updated") {
        if (updateTimer) clearTimeout(updateTimer);
        updateTimer = setTimeout(() => {
          updateTimer = null;
          void loadAll();
        }, 150);
      } else if (msg?.type === "tabvault:toast" && msg.message) {
        notify(msg.message);
      }
    };
    chrome.runtime?.onMessage?.addListener(listener);
    return () => {
      if (updateTimer) clearTimeout(updateTimer);
      chrome.runtime?.onMessage?.removeListener(listener);
    };
  }, [loadAll, notify]);

  useEffect(() => {
    if (!selectedSnapshotId) {
      setSelectedSnapshot(null);
      return;
    }
    let cancelled = false;
    void sendBg<SessionSnapshot | null>("getSnapshot", { id: selectedSnapshotId })
      .then((full) => {
        if (cancelled) return;
        setSelectedSnapshot(full);
        if (full) {
          setEditSnapName(full.name || "");
          setEditSnapTags((full.tags || []).join(", "));
        }
      })
      .catch((err) => {
        if (!cancelled) notifyError(err, "Could not load session details.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSnapshotId, notifyError]);

  const selectedCollection = useMemo(
    () => collections.find((c) => c.id === selectedCollectionId) || null,
    [collections, selectedCollectionId]
  );

  useEffect(() => {
    if (selectedCollection) {
      setEditColNotes(selectedCollection.notes || "");
      setEditColTags((selectedCollection.tags || []).join(", "));
      setEditingItemId(null);
    }
  }, [selectedCollection]);

  // Keep inspector selection aligned with the active sidebar section
  useEffect(() => {
    if (section === "named") {
      const matches = snapshots.some(
        (s) => s.id === selectedSnapshotId && (s.kind === "named" || s.kind === "imported")
      );
      if (!matches) {
        const first = snapshots.find((s) => s.kind === "named" || s.kind === "imported");
        setSelectedSnapshotId(first?.id ?? null);
      }
    } else if (section === "auto") {
      const matches = snapshots.some(
        (s) => s.id === selectedSnapshotId && (s.kind === "auto" || s.kind === "windowClose" || s.kind === "browserExit")
      );
      if (!matches) {
        const first = snapshots.find(
          (s) => s.kind === "auto" || s.kind === "windowClose" || s.kind === "browserExit"
        );
        setSelectedSnapshotId(first?.id ?? null);
      }
    } else if (section === "collections") {
      const matches = collections.some((c) => c.id === selectedCollectionId);
      if (!matches) {
        const first = collections.find((c) => c.kind === "group") || collections[0];
        setSelectedCollectionId(first?.id ?? null);
      }
    }
  }, [section, snapshots, collections, selectedSnapshotId, selectedCollectionId]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchHits(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void sendBg<SearchHit[]>("searchAll", { q })
        .then((hits) => {
          if (!cancelled) setSearchHits(hits);
        })
        .catch((err) => {
          if (!cancelled) notifyError(err, "Search failed.");
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchQuery, notifyError]);

  const visibleSnapshots = useMemo(() => {
    const now = Date.now();
    const q = searchQuery.trim().toLowerCase();

    const filtered = snapshots.filter((s) => {
      if (section === "auto" && !["auto", "windowClose", "browserExit"].includes(s.kind)) return false;
      if (section === "named" && !["named", "imported"].includes(s.kind)) return false;
      if (kindFilter !== "all" && s.kind !== kindFilter) return false;
      if (dateFilter === "today" && now - s.t > 24 * 3600_000) return false;
      if (dateFilter === "week" && now - s.t > 7 * 24 * 3600_000) return false;
      if (dateFilter === "month" && now - s.t > 30 * 24 * 3600_000) return false;
      if (q) {
        const hay = `${s.name} ${kindLabel(s.kind)} ${(s.tags || []).join(" ")} ${s.deviceName || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    filtered.sort((a, b) => {
      if (sortOrder === "oldest") return a.t - b.t;
      if (sortOrder === "mostTabs") return b.n - a.n;
      if (sortOrder === "name") return (a.name || kindLabel(a.kind)).localeCompare(b.name || kindLabel(b.kind));
      return b.t - a.t;
    });
    return filtered;
  }, [snapshots, section, kindFilter, dateFilter, searchQuery, sortOrder]);

  const folders = useMemo(
    () => collections.filter((c) => c.kind === "folder").sort((a, b) => a.order - b.order),
    [collections]
  );

  const visibleCollections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return collections
      .filter((c) => {
        if (!q) return true;
        const hay = `${c.title} ${c.notes || ""} ${c.tags.join(" ")} ${c.items.map((i) => `${i.title} ${i.url}`).join(" ")}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)) || b.updatedAt - a.updatedAt);
  }, [collections, searchQuery]);

  const siblingVersions = useMemo(() => {
    if (!selectedSnapshot) return [];
    const sameRun = snapshots.filter((s) => s.runId === selectedSnapshot.runId);
    const list = sameRun.length > 1 ? sameRun : snapshots.slice(0, 15);
    return list.slice(0, 20);
  }, [snapshots, selectedSnapshot]);

  const domainBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of openWindows) {
      for (const t of w.tabs) {
        const d = extractDomain(t.url);
        counts.set(d, (counts.get(d) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7);
  }, [openWindows]);

  const settings = state?.settings;

  const duplicateOpenCount = useMemo(
    () =>
      findDuplicateOpenTabIds(
        openWindows.map((w) => ({
          tabs: w.tabs.map((t, idx) => ({ id: idx + 1, url: t.url, pinned: t.pinned, active: t.active })),
        }))
      ).length,
    [openWindows]
  );

  const openSaveDialog = async (windowId: number | null = null) => {
    setSaveWindowId(windowId);
    setSaveMatchInfo(null);
    setSaveDialogOpen(true);
    try {
      const match = await sendBg<{
        exact: SnapshotMeta | null;
        closest: { meta: SnapshotMeta; overlap: number } | null;
      }>("checkSaveMatch", { windowId: windowId ?? undefined });
      setSaveMatchInfo(match);
    } catch {
      /* ignore */
    }
  };

  const handleSaveNamedSubmit = async (e: React.FormEvent, replaceId?: string) => {
    e.preventDefault();
    setBusy(true);
    try {
      const tags = saveTagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      const created = await sendBg<SnapshotMeta>("saveNamed", {
        name: saveNameInput.trim(),
        tags,
        startupRegistered: saveStartupReg,
        windowId: saveWindowId ?? undefined,
        replaceId,
      });
      setSaveDialogOpen(false);
      setSaveNameInput("");
      setSaveTagsInput("");
      setSaveStartupReg(false);
      setSaveWindowId(null);
      setSaveMatchInfo(null);
      await loadAll();
      setSelectedSnapshotId(created.id);
      setSelectedCollectionId(null);
      notify(replaceId ? `Updated "${created.name}".` : `Saved "${created.name}".`);
    } catch (err) {
      notifyError(err, "Could not save session.");
    } finally {
      setBusy(false);
    }
  };

  const handleDedupeOpenTabs = async () => {
    setBusy(true);
    try {
      const res = await sendBg<{ closed: number }>("dedupeOpenTabs");
      await loadAll();
      notify(res.closed ? `Closed ${plural(res.closed, "duplicate tab")}.` : "No duplicate tabs open.");
    } catch (err) {
      notifyError(err, "Could not deduplicate tabs.");
    } finally {
      setBusy(false);
    }
  };

  const handleGroupWindowByDomain = async (windowId?: number) => {
    setBusy(true);
    try {
      const res = await sendBg<{ grouped: number; groupCount?: number; ungrouped?: number }>("groupWindowByDomain", { windowId });
      await loadAll();
      notify(
        res.ungrouped
          ? `Ungrouped ${plural(res.ungrouped, "tab")}.`
          : res.grouped
            ? `Grouped ${plural(res.grouped, "tab")} into ${plural(res.groupCount ?? 1, "Chrome tab group")}.`
            : "All tabs in this window are from different sites (need 2+ tabs from the same site to group)."
      );
    } catch (err) {
      notifyError(err, "Could not group tabs.");
    } finally {
      setBusy(false);
    }
  };

  const handleFocusOpenTab = async (windowId: number | undefined, url: string, tabId?: number) => {
    try {
      await sendBg("focusOpenTab", { windowId, url, tabId });
    } catch (err) {
      notifyError(err, "Could not focus tab.");
    }
  };

  const handleCloseOpenTab = async (windowId: number | undefined, url: string, tabId?: number) => {
    try {
      await sendBg("closeOpenTab", { windowId, url, tabId });
      await loadAll();
    } catch (err) {
      notifyError(err, "Could not close tab.");
    }
  };

  const handleTogglePinBookmark = async (type: "session" | "collection", id: string, title: string) => {
    const key = `${type}:${id}`;
    const isPinned = pinnedBookmarks.has(key);
    try {
      if (chrome.permissions?.request) {
        const granted = await chrome.permissions.request({ permissions: ["bookmarks"] });
        if (!granted) {
          notify("Bookmarks permission is required to pin to the Bookmarks Bar.");
          return;
        }
      }
      if (isPinned) {
        await sendBg("unpinFromBookmarksBar", { type, id });
        notify("Removed from Bookmarks Bar.");
      } else {
        await sendBg("pinToBookmarksBar", { type, id, title });
        notify(`Pinned "${title}" to Bookmarks Bar.`);
      }
      await loadAll();
    } catch (err) {
      notifyError(err, "Could not update Bookmarks Bar.");
    }
  };

  const handleCollapse = async (scope: CollapseScope, targetCollectionId?: string, windowId?: number) => {
    if (scope === "nukeAll" && settings && !settings.bypassConfirm.closeWindow) {
      const ok = await requestConfirm({
        title: "Move all open tabs & close windows?",
        description: "All open tabs will be saved into a Collection and every browser window will close.",
        confirmLabel: "Move & Close All",
        variant: "primary",
      });
      if (!ok) return;
    } else if (scope === "currentWindow" && settings && !settings.bypassConfirm.closeWindow) {
      const ok = await requestConfirm({
        title: "Move window tabs & close window?",
        description: "All tabs in this window will be saved into a Collection and the window will close.",
        confirmLabel: "Move & Close",
        variant: "primary",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await sendBg<{ collection: CollectionRecord; capturedCount: number; closedCount: number }>("collapse", {
        scope,
        targetCollectionId,
        windowId,
      });
      await loadAll();
      setSection("collections");
      setSelectedCollectionId(res.collection.id);
      setSelectedSnapshotId(null);
      notify(`Saved ${plural(res.capturedCount, "tab")}${res.closedCount ? ` and closed ${plural(res.closedCount, "tab")}` : ""}.`);
    } catch (err) {
      notifyError(err, "Couldn't save and close those tabs. Your open tabs were not changed.");
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreSnapshot = async (
    id: string,
    windowIndex: number | null = null,
    forceSkip?: boolean,
    allowDuplicates = false
  ) => {
    const meta = snapshots.find((s) => s.id === id);
    if (
      settings &&
      !settings.bypassConfirm.replace &&
      restoreMode === "currentWindow" &&
      windowIndex == null
    ) {
      const ok = await requestConfirm({
        title: "Replace current window?",
        description: "Non-pinned tabs in your current window will be replaced by this saved session.",
        confirmLabel: "Replace Window",
        variant: "primary",
      });
      if (!ok) return;
    }
    if (
      meta &&
      settings &&
      !settings.bypassConfirm.openLarge &&
      meta.n >= settings.warnOnOpenTabCount &&
      windowIndex == null
    ) {
      const ok = await requestConfirm({
        title: `Open ${plural(meta.n, "tab")}?`,
        description: "Opening many tabs at once may slow down your browser temporarily.",
        confirmLabel: `Open ${meta.n} Tabs`,
        variant: "primary",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await sendBg<{
        opened: number;
        skipped: number;
        windows: number;
        alreadyOpen: number;
        focusedExisting?: number;
      }>("restoreSnapshot", {
        id,
        windowIndex,
        skipOpen: forceSkip ?? skipAlreadyOpen,
        allowDuplicates,
        modeOverride: restoreMode,
      });
      const parts: string[] = [];
      if (res.focusedExisting) parts.push(`Focused ${plural(res.focusedExisting, "open window")}`);
      if (res.opened) parts.push(`Opened ${plural(res.opened, "tab")} in ${plural(res.windows || 1, "window")}`);
      if (res.alreadyOpen) parts.push(`${res.alreadyOpen} already open`);
      notify(parts.length ? parts.join(" · ") : "Everything in this session is already open.");
      await loadAll();
    } catch (err) {
      notifyError(err, "Could not restore session.");
    } finally {
      setBusy(false);
    }
  };

  const handlePromoteSnapshot = (id: string) => {
    setPromoteTargetId(id);
    setPromoteNameInput(selectedSnapshot?.name || "");
  };

  const handlePromoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoteTargetId) return;
    setBusy(true);
    try {
      const created = await sendBg<SnapshotMeta>("promoteSnapshot", {
        id: promoteTargetId,
        name: promoteNameInput.trim(),
      });
      setPromoteTargetId(null);
      await loadAll();
      setSelectedSnapshotId(created.id);
      setSelectedCollectionId(null);
      notify(`Saved copy "${created.name}".`);
    } catch (err) {
      notifyError(err, "Could not save copy.");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSnapshots = async (ids: string[]) => {
    if (ids.length === 0) return;
    if (settings && !settings.bypassConfirm.deleteSession) {
      const ok = await requestConfirm({
        title: `Delete ${plural(ids.length, "session")}?`,
        description: "This permanently removes the selected session history. This can't be undone.",
        confirmLabel: `Delete ${plural(ids.length, "Session")}`,
        variant: "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await sendBg("deleteSnapshots", { ids });
      setCheckedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      if (selectedSnapshotId && ids.includes(selectedSnapshotId)) setSelectedSnapshotId(null);
      await loadAll();
      notify(`Deleted ${plural(ids.length, "session")}.`);
    } catch (err) {
      notifyError(err, "Could not delete sessions.");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSnapshotMeta = async () => {
    if (!selectedSnapshot) return;
    const prevSnap = selectedSnapshot;
    const tags = editSnapTags.split(",").map((t) => t.trim()).filter(Boolean);
    await sendBg("updateSnapshot", { id: selectedSnapshot.id, patch: { name: editSnapName.trim(), tags } });
    await loadAll();
    const updated = await sendBg<SessionSnapshot | null>("getSnapshot", { id: selectedSnapshot.id });
    if (updated) pushHistory({ kind: "snapshot", prev: prevSnap, next: updated });
    setSelectedSnapshot(updated);
    notify("Session details updated.");
  };

  const handleReorderSnapshotTabs = async (winIdx: number, fromIdx: number, toIdx: number) => {
    if (!selectedSnapshot || fromIdx === toIdx) return;
    const win = selectedSnapshot.windows[winIdx];
    if (!win || fromIdx < 0 || toIdx < 0 || fromIdx >= win.tabs.length || toIdx >= win.tabs.length) return;
    const prevSnap = selectedSnapshot;
    const nextTabs = [...win.tabs];
    const [moved] = nextTabs.splice(fromIdx, 1);
    nextTabs.splice(toIdx, 0, moved);
    const nextWindows = selectedSnapshot.windows.map((w, i) => (i === winIdx ? { ...w, tabs: nextTabs } : w));
    const updated = await sendBg<SessionSnapshot>("updateSnapshot", {
      id: selectedSnapshot.id,
      patch: { windows: nextWindows },
    });
    pushHistory({ kind: "snapshot", prev: prevSnap, next: updated });
    setSelectedSnapshot(updated);
    await loadAll();
  };

  const handleDeduplicate = async (id: string) => {
    const prevSnap = selectedSnapshot?.id === id ? selectedSnapshot : await sendBg<SessionSnapshot | null>("getSnapshot", { id });
    const res = await sendBg<{ removed: number; tabCount: number }>("deduplicateSnapshot", { id });
    const updated = await sendBg<SessionSnapshot | null>("getSnapshot", { id });
    if (prevSnap && updated && res.removed > 0) {
      pushHistory({ kind: "snapshot", prev: prevSnap, next: updated });
    }
    setSelectedSnapshot(updated);
    await loadAll();
    notify(res.removed > 0 ? `Removed ${plural(res.removed, "duplicate tab")}.` : "No duplicate tabs found.");
  };

  const handleRemoveSnapshotTab = async (winIdx: number, tabIdx: number) => {
    if (!selectedSnapshot) return;
    const win = selectedSnapshot.windows[winIdx];
    if (!win || tabIdx < 0 || tabIdx >= win.tabs.length) return;
    const prevSnap = selectedSnapshot;
    const nextWindows = selectedSnapshot.windows
      .map((w, i) => (i === winIdx ? { ...w, tabs: w.tabs.filter((_, ti) => ti !== tabIdx) } : w))
      .filter((w) => w.tabs.length > 0);
    if (nextWindows.length === 0) {
      notify("A saved session must keep at least one tab. Delete the session instead.");
      return;
    }
    const updated = await sendBg<SessionSnapshot>("updateSnapshot", {
      id: selectedSnapshot.id,
      patch: { windows: nextWindows },
    });
    pushHistory({ kind: "snapshot", prev: prevSnap, next: updated });
    setSelectedSnapshot(updated);
    await loadAll();
    notify("Removed tab from session.");
  };

  const handleDeduplicateCollection = async (col: CollectionRecord) => {
    if (col.locked) {
      notify("Unlock this collection before modifying it.");
      return;
    }
    const seen = new Set<string>();
    const kept: CollectionItem[] = [];
    let removed = 0;
    for (const item of col.items) {
      if (item.archived) {
        kept.push(item);
        continue;
      }
      if (seen.has(item.url)) {
        removed++;
        continue;
      }
      seen.add(item.url);
      kept.push(item);
    }
    if (removed === 0) {
      notify("No duplicate tabs found in this collection.");
      return;
    }
    await handleUpdateCollection({ ...col, items: kept }, `Removed ${plural(removed, "duplicate tab")}.`);
  };

  const handleSortCollection = async (col: CollectionRecord, by: "title" | "domain" = "title") => {
    if (col.locked) {
      notify("Unlock this collection before sorting it.");
      return;
    }
    const active = col.items.filter((i) => !i.archived);
    const archived = col.items.filter((i) => i.archived);
    const sorted = [...active].sort((a, b) => {
      if (by === "domain") {
        const da = extractDomain(a.url);
        const db = extractDomain(b.url);
        return da.localeCompare(db) || (a.title || a.url).localeCompare(b.title || b.url);
      }
      return (a.title || a.url).localeCompare(b.title || b.url);
    });
    await handleUpdateCollection(
      { ...col, items: [...sorted, ...archived] },
      by === "domain" ? "Sorted collection by site." : "Sorted collection A–Z."
    );
  };

  const handleExportCollection = async (
    col: CollectionRecord,
    format: "json" | "html" | "csv" | "markdown" | "onetab" = "json"
  ) => {
    try {
      const text = await sendBg<string>("exportData", { format, collectionIds: [col.id] });
      const ext = format === "markdown" ? "md" : format === "onetab" ? "txt" : format;
      const slug = (col.title || "collection").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "collection";
      triggerTextDownload(`tabvault-${slug}.${ext}`, text);
      notify(`Exported "${col.title}".`);
    } catch (err) {
      notifyError(err, "Collection export failed.");
    }
  };

  const handleCreateCollectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await sendBg<CollectionRecord>("createCollection", {
      title: newColTitle.trim() || (newColKind === "folder" ? "New Folder" : "New Collection"),
      kind: newColKind,
      color: newColColor,
      parentFolderId: newColParent || null,
    });
    setNewColDialogOpen(false);
    setNewColTitle("");
    await loadAll();
    setSection("collections");
    setSelectedCollectionId(created.id);
    setSelectedSnapshotId(null);
    notify(`Created "${created.title}".`);
  };

  const handleUpdateCollection = async (nextCol: CollectionRecord, toastMsg?: string, recordHistory = true) => {
    const prevCol = collections.find((c) => c.id === nextCol.id);
    await sendBg("saveCollection", { col: nextCol });
    if (recordHistory && prevCol) {
      pushHistory({ kind: "collection", prev: prevCol, next: nextCol });
    }
    await loadAll();
    if (toastMsg) notify(toastMsg);
  };

  const handleUndo = async () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setUndoStack((prev) => prev.slice(0, -1));
    setRedoStack((prev) => [...prev.slice(-24), entry]);
    if (entry.kind === "snapshot") {
      const restored = await sendBg<SessionSnapshot>("updateSnapshot", {
        id: entry.prev.id,
        patch: { name: entry.prev.name, tags: entry.prev.tags, windows: entry.prev.windows },
      });
      if (selectedSnapshotId === restored.id) setSelectedSnapshot(restored);
      await loadAll();
      notify("Undid session edit.");
    } else {
      await sendBg("saveCollection", { col: entry.prev });
      await loadAll();
      notify("Undid collection edit.");
    }
  };

  const handleRedo = async () => {
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    setRedoStack((prev) => prev.slice(0, -1));
    setUndoStack((prev) => [...prev.slice(-24), entry]);
    if (entry.kind === "snapshot") {
      const restored = await sendBg<SessionSnapshot>("updateSnapshot", {
        id: entry.next.id,
        patch: { name: entry.next.name, tags: entry.next.tags, windows: entry.next.windows },
      });
      if (selectedSnapshotId === restored.id) setSelectedSnapshot(restored);
      await loadAll();
      notify("Redid session edit.");
    } else {
      await sendBg("saveCollection", { col: entry.next });
      await loadAll();
      notify("Redid collection edit.");
    }
  };

  const handleDeleteCollection = async (col: CollectionRecord) => {
    if (col.locked) {
      notify("Unlock this collection before deleting it.");
      return;
    }
    if (settings && !settings.bypassConfirm.deleteSession) {
      const ok = await requestConfirm({
        title: `Delete "${col.title}"?`,
        description: "This permanently removes the collection and its saved tabs. This can't be undone.",
        confirmLabel: "Delete Collection",
        variant: "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await sendBg("deleteCollection", { id: col.id });
      if (selectedCollectionId === col.id) setSelectedCollectionId(null);
      await loadAll();
      notify(`Deleted "${col.title}".`);
    } catch (err) {
      notifyError(err, "Could not delete collection.");
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreCollection = async (id: string, actionOverride?: "keep" | "remove" | "archive") => {
    setBusy(true);
    try {
      const res = await sendBg<{ opened: number }>("restoreCollection", {
        id,
        actionOverride,
        modeOverride: restoreMode,
      });
      await loadAll();
      notify(`Opened ${plural(res.opened, "tab")}.`);
    } catch (err) {
      notifyError(err, "Could not open collection.");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleItemField = async (col: CollectionRecord, itemId: string, patch: Partial<CollectionItem>) => {
    if (col.locked && patch.archived) return;
    const next: CollectionRecord = {
      ...col,
      updatedAt: Date.now(),
      items: col.items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    };
    await handleUpdateCollection(next);
  };

  const handleDeleteCollectionItem = async (col: CollectionRecord, itemId: string) => {
    if (col.locked) {
      notify("This collection is locked.");
      return;
    }
    if (settings && !settings.bypassConfirm.deleteItem) {
      const ok = await requestConfirm({
        title: "Remove tab from collection?",
        description: "You can undo this action immediately afterward if needed.",
        confirmLabel: "Remove Tab",
        variant: "danger",
      });
      if (!ok) return;
    }
    const next: CollectionRecord = {
      ...col,
      updatedAt: Date.now(),
      items: col.items.filter((i) => i.id !== itemId),
    };
    await handleUpdateCollection(next, "Tab removed.");
  };

  const handleSleepIdle = async () => {
    setBusy(true);
    try {
      const res = await sendBg<{ count: number }>("sleepIdleNow");
      await loadAll();
      notify(res.count > 0 ? `Put ${plural(res.count, "idle tab")} to sleep.` : "No idle tabs needed sleeping.");
    } catch (err) {
      notifyError(err, "Could not sleep idle tabs.");
    } finally {
      setBusy(false);
    }
  };

  const handleMergeSelected = async () => {
    const ids = Array.from(checkedIds);
    if (ids.length < 2) return;
    setBusy(true);
    try {
      const snaps = (await Promise.all(ids.map((id) => sendBg<SessionSnapshot | null>("getSnapshot", { id })))).filter(
        Boolean
      ) as SessionSnapshot[];
      const seen = new Set<string>();
      const mergedTabs: SavedTab[] = [];
      for (const s of snaps) {
        for (const w of s.windows) {
          for (const t of w.tabs) {
            if (seen.has(t.url)) continue;
            seen.add(t.url);
            mergedTabs.push(t);
          }
        }
      }
      if (mergedTabs.length === 0) {
        notify("No tabs to merge.");
        return;
      }
      const col = await sendBg<CollectionRecord>("createCollection", {
        title: `Merged (${snaps.length} sessions)`,
        kind: "group",
        color: "#6366F1",
      });
      const nextCol: CollectionRecord = {
        ...col,
        items: mergedTabs.map((t, idx) => ({
          id: `${Date.now().toString(36)}_${idx}`,
          url: t.url,
          title: t.title,
          favIconUrl: t.favIconUrl,
          pinned: t.pinned,
          addedAt: Date.now(),
        })),
      };
      await sendBg("saveCollection", { col: nextCol });
      setCheckedIds(new Set());
      await loadAll();
      setSection("collections");
      setSelectedCollectionId(nextCol.id);
      setSelectedSnapshotId(null);
      notify(`Merged ${plural(mergedTabs.length, "unique tab")} into "${nextCol.title}".`);
    } catch (err) {
      notifyError(err, "Could not merge selected sessions.");
    } finally {
      setBusy(false);
    }
  };

  const handleMergeToSession = async () => {
    const ids = Array.from(checkedIds);
    if (ids.length < 2) return;
    setBusy(true);
    try {
      const merged = await sendBg<SnapshotMeta>("mergeSnapshots", { ids });
      setCheckedIds(new Set());
      await loadAll();
      setSection("named");
      setSelectedSnapshotId(merged.id);
      setSelectedCollectionId(null);
      notify(`Merged ${plural(ids.length, "session")} into "${merged.name || "Merged Session"}".`);
    } catch (err) {
      notifyError(err, "Could not merge sessions.");
    } finally {
      setBusy(false);
    }
  };

  const handleImportReadingList = async () => {
    setBusy(true);
    try {
      if (chrome.permissions?.request) {
        const granted = await chrome.permissions.request({ permissions: ["readingList"] }).catch(() => false);
        if (!granted) {
          notify("Reading List permission is required to import Reading List items.");
          return;
        }
      }
      const res = await sendBg<{ imported: number; collectionId: string | null }>("importReadingList");
      if (res.imported === 0) {
        if (res.collectionId) {
          setSection("collections");
          setSelectedCollectionId(res.collectionId);
          setSelectedSnapshotId(null);
          notify("All Chrome Reading List items are already in your collection.");
        } else {
          notify("Your Chrome Reading List is empty.");
        }
        return;
      }
      await loadAll();
      setSection("collections");
      if (res.collectionId) setSelectedCollectionId(res.collectionId);
      setSelectedSnapshotId(null);
      notify(`Imported ${plural(res.imported, "Reading List item")}.`);
    } catch (err) {
      notifyError(err, "Could not import Reading List.");
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (format: "json" | "html" | "csv" | "markdown" | "onetab", ids?: string[], copyOnly = false) => {
    try {
      const text = await sendBg<string>("exportData", { format, ids });
      if (copyOnly) {
        await navigator.clipboard.writeText(text);
        notify(`Copied ${format.toUpperCase()} to clipboard.`);
        return;
      }
      const ext = format === "markdown" ? "md" : format === "onetab" ? "txt" : format;
      triggerTextDownload(`tabvault-export.${ext}`, text);
      notify(`Downloaded ${format.toUpperCase()} export.`);
    } catch (err) {
      notifyError(err, "Export failed.");
    }
  };

  const handleCopyInspectorTabs = async (
    mode:
      | { kind: "format"; format: Settings["enabledCopyFormats"][number] }
      | { kind: "template"; template: string },
    label: string
  ) => {
    const tabs = selectedCollection ? flattenCollectionTabs(selectedCollection) : flattenSnapshotTabs(selectedSnapshot);
    if (tabs.length === 0) {
      notify("No tabs selected to copy.");
      return;
    }
    try {
      let text = "";
      if (mode.kind === "template") {
        text = formatWithTemplate(tabs, mode.template);
      } else {
        const syntheticSnap: SessionSnapshot = selectedSnapshot ?? collectionToSnapshot(selectedCollection!);
        switch (mode.format) {
          case "titleAndUrl":
            text = formatWithTemplate(tabs, "%t — %u");
            break;
          case "markdown":
            text = exportAsMarkdown([syntheticSnap]);
            break;
          case "json":
            text = exportAsJson([syntheticSnap]);
            break;
          case "csv":
            text = exportAsCsv([syntheticSnap]);
            break;
          case "html":
            text = exportAsBookmarksHtml([syntheticSnap]);
            break;
          case "onetab":
            text = exportAsOneTabText([syntheticSnap]);
            break;
        }
      }
      await navigator.clipboard.writeText(text);
      notify(`Copied ${plural(tabs.length, "tab")} as ${label}.`);
    } catch (err) {
      notifyError(err, "Could not copy to clipboard.");
    }
  };

  const handleImportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importText.trim()) return;
    setBusy(true);
    try {
      const res = await sendBg<{
        source: string;
        sessions: number;
        collections?: number;
        skipped: number;
        tabs: number;
        deduped?: number;
      }>("importData", {
        text: importText,
        password: importPassword || undefined,
      });
      setImportDialogOpen(false);
      setImportText("");
      setImportPassword("");
      await loadAll();
      const sourceName = SOURCE_LABELS[res.source] || res.source;
      const colPart = res.collections ? `, ${plural(res.collections, "collection")}` : "";
      notify(
        `Imported ${plural(res.sessions, "session")}${colPart} (${plural(res.tabs, "tab")}${res.deduped ? `, ${res.deduped} duplicates skipped` : ""}) from ${sourceName}.`
      );
    } catch (err) {
      notify((err as Error).message || "Could not read imported text.");
    } finally {
      setBusy(false);
    }
  };

  const handleImportFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result || ""));
    reader.readAsText(file);
  };

  const handleThemeCycle = async () => {
    if (!settings) return;
    const nextTheme: Settings["theme"] =
      settings.theme === "light" ? "dark" : settings.theme === "dark" ? "system" : "light";
    await sendBg("setSettings", { patch: { theme: nextTheme } });
    applyTheme(nextTheme);
    await loadAll();
    notify(`Theme set to ${nextTheme}.`);
  };

  return {
    state,
    settings,
    snapshots,
    collections,
    openWindows,
    visibleSnapshots,
    visibleCollections,
    folders,
    siblingVersions,
    domainBreakdown,
    section,
    setSection,
    inspectorTab,
    setInspectorTab,
    selectedSnapshotId,
    setSelectedSnapshotId,
    selectedSnapshot,
    selectedCollectionId,
    setSelectedCollectionId,
    selectedCollection,
    checkedIds,
    setCheckedIds,
    searchQuery,
    setSearchQuery,
    searchHits,
    dateFilter,
    setDateFilter,
    kindFilter,
    setKindFilter,
    sortOrder,
    setSortOrder,
    restoreMode,
    setRestoreMode,
    skipAlreadyOpen,
    setSkipAlreadyOpen,
    toast,
    notify,
    busy,
    saveDialogOpen,
    setSaveDialogOpen,
    saveNameInput,
    setSaveNameInput,
    saveTagsInput,
    setSaveTagsInput,
    saveStartupReg,
    setSaveStartupReg,
    newColDialogOpen,
    setNewColDialogOpen,
    newColTitle,
    setNewColTitle,
    newColKind,
    setNewColKind,
    newColColor,
    setNewColColor,
    newColParent,
    setNewColParent,
    importDialogOpen,
    setImportDialogOpen,
    importText,
    setImportText,
    importPassword,
    setImportPassword,
    driveSyncPassword,
    setDriveSyncPassword,
    editSnapName,
    setEditSnapName,
    editSnapTags,
    setEditSnapTags,
    editColNotes,
    setEditColNotes,
    editColTags,
    setEditColTags,
    editingItemId,
    setEditingItemId,
    editingItemNote,
    setEditingItemNote,
    showArchivedItems,
    setShowArchivedItems,
    loadAll,
    openSaveDialog,
    saveWindowId,
    saveMatchInfo,
    pinnedBookmarks,
    duplicateOpenCount,
    handleDedupeOpenTabs,
    handleGroupWindowByDomain,
    handleFocusOpenTab,
    handleCloseOpenTab,
    handleTogglePinBookmark,
    handleSaveNamedSubmit,
    handleCollapse,
    handleRestoreSnapshot,
    handlePromoteSnapshot,
    promoteTargetId,
    setPromoteTargetId,
    promoteNameInput,
    setPromoteNameInput,
    handlePromoteSubmit,
    handleDeleteSnapshots,
    handleSaveSnapshotMeta,
    handleDeduplicate,
    handleRemoveSnapshotTab,
    handleDeduplicateCollection,
    handleSortCollection,
    handleExportCollection,
    handleCreateCollectionSubmit,
    handleUpdateCollection,
    handleDeleteCollection,
    handleRestoreCollection,
    handleToggleItemField,
    handleDeleteCollectionItem,
    handleSleepIdle,
    handleMergeSelected,
    handleMergeToSession,
    handleReorderSnapshotTabs,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    handleUndo,
    handleRedo,
    handleImportReadingList,
    handleExport,
    handleCopyInspectorTabs,
    handleImportSubmit,
    handleImportFilePick,
    handleThemeCycle,
    confirmRequest,
    resolveConfirm,
  };
}

export type DashboardController = ReturnType<typeof useDashboardController>;

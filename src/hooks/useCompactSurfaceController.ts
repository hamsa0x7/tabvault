import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyTheme } from "../shared/format.ts";
import { sendBg } from "../shared/rpc.ts";
import type { AppStateSummary, CollectionRecord, SavedWindow, SearchHit, SnapshotMeta } from "../shared/types.ts";

/**
 * Shared controller hook for compact extension surfaces (PopupApp and SidePanelApp).
 * Centralizes state loading, live tab listeners, debounced search, keyboard navigation,
 * duplicate counting, toast notifications, and collection space switching.
 */
export function useCompactSurfaceController(opts: {
  closeOnActivate?: boolean;
  watchLiveTabs?: boolean;
  toastDurationMs?: number;
} = {}) {
  const { closeOnActivate = false, watchLiveTabs = false, toastDurationMs = 2400 } = opts;

  const [state, setState] = useState<AppStateSummary | null>(null);
  const [openWindows, setOpenWindows] = useState<SavedWindow[]>([]);
  const [metas, setMetas] = useState<SnapshotMeta[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [query, setQuery] = useState("");
  const [searchSource, setSearchSource] = useState<"all" | "open" | "snapshot" | "collection">("all");
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [activeHitIdx, setActiveHitIdx] = useState(0);
  const [pendingSwitchCol, setPendingSwitchCol] = useState<CollectionRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tipDismissed, setTipDismissed] = useState(() => {
    try {
      return localStorage.getItem("tabvault:tipDismissed") === "1";
    } catch {
      return false;
    }
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), toastDurationMs);
    },
    [toastDurationMs]
  );

  const dismissTip = useCallback(() => {
    setTipDismissed(true);
    try {
      localStorage.setItem("tabvault:tipDismissed", "1");
    } catch {
      /* ignore */
    }
  }, []);

  const pendingRefreshRef = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (pendingRefreshRef.current) return pendingRefreshRef.current;
    const promise = (async () => {
      try {
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
      } finally {
        pendingRefreshRef.current = null;
      }
    })();
    pendingRefreshRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    void refresh().catch((e) => showToast(String((e as Error)?.message || e)));
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void refresh().catch(() => {});
      }, 150);
    };
    const onTabUpdated = (_id: number, ch: chrome.tabs.OnUpdatedInfo) => {
      if (ch.url || ch.status === "complete" || ch.pinned !== undefined || ch.groupId !== undefined) {
        scheduleRefresh();
      }
    };
    const listener = (msg: { type?: string; message?: string }) => {
      if (msg?.type === "tabvault:updated") {
        scheduleRefresh();
      } else if (msg?.type === "tabvault:toast" && msg.message) {
        showToast(msg.message);
      }
    };
    chrome.runtime?.onMessage?.addListener(listener);

    const onVisibility = () => {
      if (!document.hidden) scheduleRefresh();
    };
    if (watchLiveTabs) {
      chrome.tabs?.onCreated?.addListener(scheduleRefresh);
      chrome.tabs?.onRemoved?.addListener(scheduleRefresh);
      chrome.tabs?.onUpdated?.addListener(onTabUpdated);
      chrome.windows?.onFocusChanged?.addListener(scheduleRefresh);
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      if (timer) clearTimeout(timer);
      chrome.runtime?.onMessage?.removeListener(listener);
      if (watchLiveTabs) {
        chrome.tabs?.onCreated?.removeListener(scheduleRefresh);
        chrome.tabs?.onRemoved?.removeListener(scheduleRefresh);
        chrome.tabs?.onUpdated?.removeListener(onTabUpdated);
        chrome.windows?.onFocusChanged?.removeListener(scheduleRefresh);
        document.removeEventListener("visibilitychange", onVisibility);
      }
    };
  }, [refresh, showToast, watchLiveTabs]);

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
        .catch((e) => showToast(String((e as Error)?.message || e)));
    }, 150);
    return () => clearTimeout(timer);
  }, [query, showToast]);

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

  const activateSearchHit = useCallback(
    (hit: SearchHit) => {
      const p =
        hit.source === "open"
          ? sendBg("focusOpenTab", {
              windowId: Number(hit.id) || undefined,
              url: hit.tab.url,
              tabId: hit.tab.id,
            })
          : sendBg("openUrl", { url: hit.tab.url });
      if (closeOnActivate) {
        void p.then(() => window.close());
      } else {
        void p;
      }
    },
    [closeOnActivate]
  );

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

  const confirmSwitchSpace = useCallback(
    (confirmed: boolean) => {
      const target = pendingSwitchCol;
      setPendingSwitchCol(null);
      if (!confirmed || !target) return;
      void sendBg("switchSpace", { collectionId: target.id })
        .then(() => {
          showToast(`Switched to "${target.title}"`);
          return refresh();
        })
        .catch((e) => showToast(String((e as Error)?.message || e)));
    },
    [pendingSwitchCol, refresh, showToast]
  );

  return {
    state,
    openWindows,
    metas,
    collections,
    query,
    setQuery,
    searchSource,
    setSearchSource,
    filteredHits,
    activeHitIdx,
    setActiveHitIdx,
    duplicateOpenCount,
    pendingSwitchCol,
    setPendingSwitchCol,
    confirmSwitchSpace,
    toast,
    showToast,
    tipDismissed,
    dismissTip,
    searchInputRef,
    refresh,
    activateSearchHit,
  };
}

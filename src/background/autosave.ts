import {
  cleanWindow,
  countTabs,
  effectiveLimits,
  hasContent,
  normalizeGroupColor,
  pruneIds,
  shouldIgnoreUrl,
  signature,
  uid,
} from "../shared/core.ts";
import {
  deleteSnapshots,
  getAllCollections,
  getLivePointer,
  getMetaIndex,
  getSettings,
  getSnapshot,
  putCollection,
  putSnapshot,
  setLivePointer,
} from "../shared/db.ts";
import type { CollectionItem, SavedTabGroup, SavedWindow, SessionSnapshot } from "../shared/types.ts";
import { captureWindows } from "./capture.ts";

let runIdPromise: Promise<string> | null = null;
let onStartupCheckHook: (() => void) | null = null;

export function registerStartupCheckHook(fn: () => void): void {
  onStartupCheckHook = fn;
}

export function getRunId(): Promise<string> {
  if (!runIdPromise) {
    runIdPromise = (async () => {
      const got = (await chrome.storage.session.get("runId")).runId as string | undefined;
      if (got) return got;
      const id = "r" + uid();
      const prevBeat = ((await chrome.storage.local.get("beat")).beat as { runId: string; t: number } | undefined) || null;
      await chrome.storage.session.set({ runId: id, runStartedAt: Date.now(), prevBeat });
      onStartupCheckHook?.();
      return id;
    })();
  }
  return runIdPromise;
}

let savingChain: Promise<string | null> = Promise.resolve(null);
export function autosave(opts: { fork?: boolean } = {}): Promise<string | null> {
  savingChain = savingChain.then(() => doAutosave(opts)).catch((e) => {
    console.warn("autosave", e);
    return null;
  });
  return savingChain;
}

// Keep a rolling cache of live windows keyed by Chrome windowId so windowClose can save what closed
const liveWindowCache = new Map<number, SavedWindow>();

export async function refreshLiveWindowCache(): Promise<void> {
  const settings = await getSettings();
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const ownPrefix = chrome.runtime.getURL("");
  liveWindowCache.clear();
  for (const w of wins) {
    if (w.id == null) continue;
    if (w.incognito && settings.incognitoPolicy !== "include") continue;
    let groups: SavedTabGroup[] = [];
    if (settings.includeTabGroupsOnCapture && chrome.tabGroups) {
      try {
        const rawGroups = await chrome.tabGroups.query({ windowId: w.id });
        groups = rawGroups.map((g) => ({
          id: g.id,
          title: g.title || "",
          color: normalizeGroupColor(g.color),
          collapsed: g.collapsed,
        }));
      } catch {
        groups = [];
      }
    }
    const cleaned = cleanWindow(
      {
        state: w.state,
        left: w.left,
        top: w.top,
        width: w.width,
        height: w.height,
        focused: w.focused,
        groups,
        tabs: (w.tabs || [])
          .filter((t) => {
            const u = t.pendingUrl || t.url || "";
            return u && !u.startsWith(ownPrefix);
          })
          .sort((a, b) => a.index - b.index)
          .map((t) => ({
            url: t.pendingUrl || t.url || "",
            title: t.title || t.pendingUrl || t.url || "",
            favIconUrl: t.favIconUrl,
            pinned: t.pinned,
            active: t.active,
            discarded: t.discarded,
            groupKey: typeof t.groupId === "number" && t.groupId >= 0 ? t.groupId : undefined,
          })),
      },
      settings
    );
    if (cleaned.tabs.length > 0) {
      liveWindowCache.set(w.id, cleaned);
    }
  }
  const serialized: Record<string, SavedWindow> = {};
  for (const [id, win] of liveWindowCache.entries()) {
    serialized[String(id)] = win;
  }
  await chrome.storage.session.set({ liveWindowCache: serialized }).catch(() => {});
}

async function doAutosave({ fork = false }: { fork?: boolean } = {}): Promise<string | null> {
  const settings = await getSettings();
  const rid = await getRunId();
  const windows = await captureWindows(settings);
  const now = Date.now();
  await chrome.storage.local.set({ lastCheckAt: now, beat: { runId: rid, t: now } });

  if (!settings.autoSaveEnabled && !fork) return null;
  if (!windows.length || !hasContent(windows)) return null;

  const sig = signature(windows);
  const live = await getLivePointer();
  const n = countTabs(windows);

  if (!fork && live && live.sig === sig && live.runId === rid && (await getSnapshot(live.id))) {
    return live.id;
  }

  const shrinkRatio = settings.shrinkForkPct / 100;
  const shrink = Boolean(live && live.runId === rid && (windows.length < live.w || n < live.n * shrinkRatio));
  const newSlot = !live || live.runId !== rid || now - live.created >= settings.autoSaveIntervalMin * 60_000;
  const existingLive = live ? await getSnapshot(live.id) : null;
  const id = fork || shrink || newSlot || !existingLive ? uid() : live!.id;
  const created = id === live?.id ? live.created : now;

  const firstActive = windows.flatMap((w) => w.tabs).find((t) => t.active) || windows[0]?.tabs[0];
  const autoName = settings.useTabTitleForAutoSave && firstActive ? firstActive.title.slice(0, 80) : "";

  const snap: SessionSnapshot = {
    id,
    t: now,
    updatedAt: now,
    kind: "auto",
    name: autoName,
    runId: rid,
    deviceName: settings.deviceName || undefined,
    windows,
    windowCount: windows.length,
    tabCount: n,
    sig,
  };

  await putSnapshot(snap);
  await setLivePointer({ id, sig, runId: rid, created, w: windows.length, n }, now);
  await pruneSnapshots();
  await syncTrackedCollections();
  await refreshLiveWindowCache();
  return id;
}

export async function handleWindowClosed(windowId: number): Promise<void> {
  const settings = await getSettings();
  let cached = liveWindowCache.get(windowId);
  if (!cached) {
    const stored = (await chrome.storage.session.get("liveWindowCache").catch(() => ({}))) as {
      liveWindowCache?: Record<string, SavedWindow>;
    };
    if (stored.liveWindowCache) {
      for (const [k, v] of Object.entries(stored.liveWindowCache)) {
        const id = Number(k);
        if (!Number.isNaN(id) && !liveWindowCache.has(id)) liveWindowCache.set(id, v);
      }
      cached = liveWindowCache.get(windowId);
    }
  }
  liveWindowCache.delete(windowId);
  const serialized: Record<string, SavedWindow> = {};
  for (const [id, win] of liveWindowCache.entries()) {
    serialized[String(id)] = win;
  }
  await chrome.storage.session.set({ liveWindowCache: serialized }).catch(() => {});
  if (!cached || !settings.autoSaveOnWindowClose) return;
  if (settings.purgeEmptyOnClose && !hasContent([cached])) return;
  if (settings.purgePinnedOnlyOnClose && cached.tabs.every((t) => t.pinned)) return;
  if (cached.tabs.length < settings.minTabsOnWindowClose) return;

  const rid = await getRunId();
  const now = Date.now();
  const firstTab = cached.tabs.find((t) => t.active) || cached.tabs[0];
  const snap: SessionSnapshot = {
    id: uid(),
    t: now,
    updatedAt: now,
    kind: "windowClose",
    name: settings.useTabTitleForAutoSave && firstTab ? firstTab.title.slice(0, 80) : "Closed window",
    runId: rid,
    deviceName: settings.deviceName || undefined,
    windows: [cached],
    windowCount: 1,
    tabCount: cached.tabs.length,
    sig: signature([cached]),
  };
  await putSnapshot(snap);
  await pruneSnapshots();
}

export async function pruneSnapshots(): Promise<void> {
  try {
    const settings = await getSettings();
    const limits = effectiveLimits(settings);
    const idx = await getMetaIndex();
    const live = await getLivePointer();
    const ids = pruneIds(idx, Date.now(), limits).filter((id) => !live || id !== live.id);
    await deleteSnapshots(ids);
  } catch (e) {
    console.warn("prune", e);
  }
}

async function syncTrackedCollections(): Promise<void> {
  const cols = await getAllCollections();
  const tracked = cols.filter((c) => c.trackingWindowId != null);
  if (!tracked.length) return;
  const settings = await getSettings();
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const ownPrefix = chrome.runtime.getURL("");
  const now = Date.now();

  for (const col of tracked) {
    const win = wins.find((w) => w.id === col.trackingWindowId);
    if (!win) {
      col.trackingWindowId = null;
      await putCollection(col);
      continue;
    }
    const tabs = (win.tabs || [])
      .filter((t) => {
        const u = t.pendingUrl || t.url || "";
        return u && !u.startsWith(ownPrefix) && !shouldIgnoreUrl(u, settings);
      })
      .sort((a, b) => a.index - b.index);

    const existingQueues = new Map<string, CollectionItem[]>();
    const archivedItems: CollectionItem[] = [];
    for (const item of col.items) {
      if (item.archived) {
        archivedItems.push(item);
        continue;
      }
      const list = existingQueues.get(item.url) || [];
      list.push(item);
      existingQueues.set(item.url, list);
    }

    const nextActive: CollectionItem[] = tabs.map((t) => {
      const url = t.pendingUrl || t.url || "";
      const prev = existingQueues.get(url)?.shift();
      const title = t.title || url;
      if (prev) {
        return {
          ...prev,
          title,
          favIconUrl: t.favIconUrl ?? prev.favIconUrl,
          pinned: t.pinned,
        };
      }
      return {
        id: uid(),
        url,
        title,
        favIconUrl: t.favIconUrl,
        pinned: t.pinned,
        addedAt: now,
      };
    });

    const nextItems = [...nextActive, ...archivedItems];
    const unchanged =
      nextItems.length === col.items.length &&
      nextItems.every(
        (it, idx) =>
          it.id === col.items[idx].id &&
          it.url === col.items[idx].url &&
          it.title === col.items[idx].title &&
          Boolean(it.pinned) === Boolean(col.items[idx].pinned)
      );
    if (unchanged) continue;

    col.items = nextItems;
    col.updatedAt = now;
    await putCollection(col);
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let scheduleSeq = 0;

export function scheduleSave(customDelayMs?: number): void {
  const seq = ++scheduleSeq;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  void getSettings()
    .then((s) => {
      if (seq !== scheduleSeq) return;
      const delay = customDelayMs ?? s.debounceMs;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void autosave();
      }, delay);
    })
    .catch((e) => console.warn("scheduleSave", e));
}

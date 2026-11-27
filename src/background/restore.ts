import { isRestorable, windowOverlapRatio } from "../shared/core.ts";
import { getSettings, putCollection } from "../shared/db.ts";
import type {
  CollectionRecord,
  SavedTab,
  SavedTabGroup,
  SavedWindow,
  SessionSnapshot,
  Settings,
} from "../shared/types.ts";

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function lazyDiscard(tabId: number, url: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t) return;
    if (t.url && t.url !== "about:blank") break;
    await pause(100);
  }
  const d = await chrome.tabs.discard(tabId).catch(() => null);
  const t = await chrome.tabs.get(d?.id ?? tabId).catch(() => null);
  if (t && !t.url && !t.pendingUrl && url) {
    await chrome.tabs.update(t.id!, { url }).catch(() => {});
  }
}

function resolveTabOpenUrl(tab: SavedTab, settings: Settings): string {
  if (settings.restoreLoadMode === "suspendPage") {
    const hash = new URLSearchParams({ url: tab.url, title: tab.title || tab.url });
    return chrome.runtime.getURL(`suspend.html#${hash.toString()}`);
  }
  return tab.url;
}

export interface RestoreOptions {
  windowIndex?: number | null;
  skipOpen?: boolean;
  smartMatch?: boolean;
  allowDuplicates?: boolean;
  modeOverride?: Settings["defaultOpenMode"] | "asTabGroups";
}

export async function restoreSnapshot(
  snap: SessionSnapshot,
  opts: RestoreOptions = {}
): Promise<{ opened: number; skipped: number; windows: number; alreadyOpen: number; focusedExisting: number }> {
  const settings = await getSettings();
  const wins: SavedWindow[] =
    opts.windowIndex != null ? [snap.windows[opts.windowIndex]].filter(Boolean) : snap.windows;

  const smartMatch = opts.smartMatch !== false && !opts.allowDuplicates;
  const shouldSkipOpen = opts.allowDuplicates ? false : (opts.skipOpen ?? smartMatch);

  const mode = opts.modeOverride || settings.defaultOpenMode;
  const curWinForMode =
    mode === "currentWindow" || mode === "addToCurrent"
      ? await chrome.windows.getLastFocused({ populate: true }).catch(() => null)
      : null;

  const openWins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }).catch(() => []);
  const buildOpenUrlSet = (excludeNonPinnedInWindowId?: number): Set<string> => {
    if (!shouldSkipOpen) return new Set<string>();
    const urls = new Set<string>();
    for (const ow of openWins) {
      for (const t of ow.tabs || []) {
        if (
          excludeNonPinnedInWindowId != null &&
          ow.id === excludeNonPinnedInWindowId &&
          !(settings.keepPinnedInCurrentWindow && t.pinned)
        ) {
          continue;
        }
        const u = t.pendingUrl || t.url || "";
        if (u) urls.add(u);
      }
    }
    return urls;
  };
  const globalOpenUrls = buildOpenUrlSet();
  const currentWindowOpenUrls =
    mode === "currentWindow" && curWinForMode?.id != null
      ? buildOpenUrlSet(curWinForMode.id)
      : globalOpenUrls;

  let opened = 0;
  let skipped = 0;
  let windowsOpened = 0;
  let alreadyOpen = 0;
  let focusedExisting = 0;

  // Determine whether lazy discard applies
  const totalRestorable = wins.reduce((sum, w, wi) => {
    const skipSet = mode === "currentWindow" && wi === 0 ? currentWindowOpenUrls : globalOpenUrls;
    return sum + w.tabs.filter((t) => isRestorable(t.url) && !skipSet.has(t.url)).length;
  }, 0);
  const shouldDiscardAll =
    settings.restoreLoadMode === "lazyDiscard" ||
    (settings.restoreLoadMode !== "alwaysLoad" &&
      settings.restoreLoadMode !== "suspendPage" &&
      totalRestorable > settings.optimizedOpenThreshold);

  for (let wi = 0; wi < wins.length; wi++) {
    const w = wins[wi];
    const openUrls = mode === "currentWindow" && wi === 0 ? currentWindowOpenUrls : globalOpenUrls;
    const ok = w.tabs.filter((t) => isRestorable(t.url));
    skipped += w.tabs.length - ok.length;
    const tabs = ok.filter((t) => !openUrls.has(t.url));
    alreadyOpen += ok.length - tabs.length;

    let targetWinId: number | undefined;
    const createdTabs: Array<{ id: number; url: string; origTab: SavedTab }> = [];
    let activeTabId: number | null = null;

    // Smart Window Matching: if a window with >=75% of these URLs is already open, focus it and only add missing tabs
    if (smartMatch && mode === "newWindow") {
      const okUrls = ok.map((t) => t.url);
      const matched = openWins.find((ow) => {
        const owUrls = (ow.tabs || []).map((t) => t.pendingUrl || t.url || "");
        return windowOverlapRatio(okUrls, owUrls) >= 0.75;
      });
      if (matched?.id != null) {
        targetWinId = matched.id;
        focusedExisting++;
        await chrome.windows.update(targetWinId, { focused: true }).catch(() => {});
        for (const t of tabs) {
          try {
            const nt = await chrome.tabs.create({
              windowId: targetWinId,
              url: resolveTabOpenUrl(t, settings),
              pinned: Boolean(t.pinned),
              active: false,
            });
            if (nt.id != null) {
              createdTabs.push({ id: nt.id, url: t.url, origTab: t });
              opened++;
            }
          } catch {
            skipped++;
          }
        }
        continue;
      }
    }

    if (!tabs.length) continue;

    if ((mode === "currentWindow" || mode === "addToCurrent") && wi === 0) {
      const curWin = curWinForMode;
      if (curWin?.id != null) {
        targetWinId = curWin.id;
        const oldTabIds =
          mode === "currentWindow"
            ? (curWin.tabs || [])
                .filter((t) => !(settings.keepPinnedInCurrentWindow && t.pinned))
                .map((t) => t.id)
                .filter((id): id is number => id != null)
            : [];

        const activeTab = (curWin.tabs || []).find((t) => t.active);
        const baseInsertIdx =
          mode === "addToCurrent" && settings.openNextToActive && typeof activeTab?.index === "number"
            ? activeTab.index + 1
            : null;
        let insertOffset = 0;

        for (const t of tabs) {
          try {
            const createProps: chrome.tabs.CreateProperties = {
              windowId: targetWinId,
              url: resolveTabOpenUrl(t, settings),
              pinned: Boolean(t.pinned),
              active: false,
            };
            if (baseInsertIdx != null && !t.pinned) {
              createProps.index = baseInsertIdx + insertOffset++;
            }
            const nt = await chrome.tabs.create(createProps);
            if (nt.id != null) {
              createdTabs.push({ id: nt.id, url: t.url, origTab: t });
              opened++;
              if (t.active) activeTabId = nt.id;
            }
          } catch {
            skipped++;
          }
        }
        if (oldTabIds.length && createdTabs.length) {
          await chrome.tabs.remove(oldTabIds).catch(() => {});
        }
        windowsOpened++;
      }
    }

    if (targetWinId == null) {
      const createOpt: chrome.windows.CreateData = {
        url: resolveTabOpenUrl(tabs[0], settings),
        focused: true,
      };
      if (
        settings.restoreWindowBounds &&
        w.state === "normal" &&
        w.width &&
        w.width > 200 &&
        w.height &&
        w.height > 200
      ) {
        Object.assign(createOpt, { left: w.left, top: w.top, width: w.width, height: w.height });
      }
      let win: chrome.windows.Window | undefined;
      try {
        win = await chrome.windows.create(createOpt);
      } catch {
        win = await chrome.windows.create({ url: resolveTabOpenUrl(tabs[0], settings), focused: true });
      }
      if (!win) continue;
      targetWinId = win.id;
      windowsOpened++;
      opened++;
      const first = win.tabs?.[0];
      if (first?.id != null) {
        if (tabs[0].pinned) await chrome.tabs.update(first.id, { pinned: true }).catch(() => {});
        if (tabs[0].active) activeTabId = first.id;
        createdTabs.push({ id: first.id, url: tabs[0].url, origTab: tabs[0] });
      }

      for (const t of tabs.slice(1)) {
        try {
          const nt = await chrome.tabs.create({
            windowId: targetWinId,
            url: resolveTabOpenUrl(t, settings),
            pinned: Boolean(t.pinned),
            active: false,
          });
          if (nt.id != null) {
            createdTabs.push({ id: nt.id, url: t.url, origTab: t });
            opened++;
            if (t.active) activeTabId = nt.id;
          }
        } catch {
          skipped++;
        }
      }

      if (w.state === "maximized" || w.state === "fullscreen") {
        if (targetWinId != null) {
          await chrome.windows.update(targetWinId, { state: w.state }).catch(() => {});
        }
      }
    }

    // Reconstruct Chrome Tab Groups (defensive against Chromium-derivative API quirks)
    if (settings.restoreTabGroups && typeof chrome?.tabs?.group === "function" && targetWinId != null) {
      const groupBuckets = new Map<number, number[]>();
      for (const entry of createdTabs) {
        if (entry.origTab.groupKey != null && !entry.origTab.pinned) {
          const list = groupBuckets.get(entry.origTab.groupKey) || [];
          list.push(entry.id);
          groupBuckets.set(entry.origTab.groupKey, list);
        }
      }
      for (const [gKey, tabIds] of groupBuckets.entries()) {
        if (!tabIds.length) continue;
        try {
          const newGid = await chrome.tabs.group({
            tabIds: tabIds as [number, ...number[]],
            createProperties: { windowId: targetWinId },
          });
          const gMeta = w.groups?.find((g) => g.id === gKey);
          if (gMeta && typeof chrome?.tabGroups?.update === "function" && typeof newGid === "number") {
            await chrome.tabGroups
              .update(newGid, {
                title: gMeta.title,
                color: gMeta.color,
                collapsed: gMeta.collapsed,
              })
              .catch(() => {});
          }
        } catch {
          /* graceful fallback on Chromium forks with partial Tab Groups support */
        }
      }
    }

    if (activeTabId != null && settings.switchToOpenedTab) {
      await chrome.tabs.update(activeTabId, { active: true }).catch(() => {});
    }

    const targets = createdTabs.filter(
      (entry) =>
        entry.id !== activeTabId &&
        (shouldDiscardAll || (settings.restoreLoadMode === "lastState" && Boolean(entry.origTab.discarded)))
    );
    if (targets.length > 0) {
      const BATCH_SIZE = 6;
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        await Promise.all(
          targets.slice(i, i + BATCH_SIZE).map((entry) => lazyDiscard(entry.id, entry.url))
        );
      }
    }
  }

  return { opened, skipped, windows: windowsOpened, alreadyOpen, focusedExisting };
}

export async function restoreCollection(
  col: CollectionRecord,
  opts: {
    actionOverride?: Settings["restoreListAction"];
    modeOverride?: Settings["defaultOpenMode"];
    skipOpen?: boolean;
    allowDuplicates?: boolean;
  } = {}
): Promise<{ opened: number; skipped: number; windows: number; alreadyOpen: number; focusedExisting: number }> {
  const settings = await getSettings();
  const activeItems = col.items.filter((i) => !i.archived && isRestorable(i.url));
  const groups: SavedTabGroup[] = [];
  const groupKeys = new Map<string, number>();
  let nextGroupId = 1;
  const tabs: SavedTab[] = activeItems.map((i) => {
    let groupKey: number | undefined;
    if (i.groupTitle || i.groupColor) {
      const gName = i.groupTitle || "";
      const gColor = i.groupColor || "grey";
      const mapKey = `${gName}::${gColor}`;
      let gid = groupKeys.get(mapKey);
      if (gid == null) {
        gid = nextGroupId++;
        groupKeys.set(mapKey, gid);
        groups.push({ id: gid, title: gName, color: gColor, collapsed: false });
      }
      groupKey = gid;
    }
    return {
      url: i.url,
      title: i.title,
      pinned: i.pinned,
      favIconUrl: i.favIconUrl,
      groupKey,
    };
  });

  const syntheticSnap: SessionSnapshot = {
    id: col.id,
    t: col.updatedAt,
    updatedAt: col.updatedAt,
    kind: "named",
    name: col.title,
    runId: "",
    windows: [
      {
        title: col.title,
        groups: groups.length ? groups : undefined,
        tabs,
      },
    ],
    windowCount: 1,
    tabCount: activeItems.length,
    sig: "",
  };

  const res = await restoreSnapshot(syntheticSnap, {
    modeOverride: opts.modeOverride,
    skipOpen: opts.skipOpen,
    allowDuplicates: opts.allowDuplicates,
  });

  const action = opts.actionOverride || settings.restoreListAction;
  if (!col.locked && action !== "keep") {
    if (action === "remove") {
      col.items = col.items.filter((i) => i.archived);
    } else if (action === "archive") {
      col.items = col.items.map((i) => ({ ...i, archived: true }));
    }
    col.updatedAt = Date.now();
    await putCollection(col);
  }
  return res;
}

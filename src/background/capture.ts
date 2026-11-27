import {
  cleanTab,
  cleanWindow,
  isRestorable,
  normalizeGroupColor,
  shouldIgnoreUrl,
  uid,
} from "../shared/core.ts";
import { getAllCollections, putCollection } from "../shared/db.ts";
import type {
  CollectionItem,
  CollectionRecord,
  CollapseScope,
  SavedTab,
  SavedTabGroup,
  SavedWindow,
  Settings,
} from "../shared/types.ts";

const OWN_PREFIX = chrome.runtime.getURL("");

export async function captureWindows(
  settings: Settings,
  includeWindowId = false,
  forDisplayOnly = false
): Promise<SavedWindow[]> {
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const includeIncognito =
    settings.incognitoPolicy === "include" ||
    (forDisplayOnly && settings.incognitoPolicy === "secureNoSave");
  const result: SavedWindow[] = [];

  for (const w of wins) {
    if (w.incognito && !includeIncognito) continue;
    let groups: SavedTabGroup[] = [];
    if (settings.includeTabGroupsOnCapture && chrome.tabGroups && w.id != null) {
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

    const rawTabs = (w.tabs || [])
      .filter((t) => {
        const u = t.pendingUrl || t.url || "";
        return u && !u.startsWith(OWN_PREFIX);
      })
      .sort((a, b) => a.index - b.index)
      .map((t) => ({
        id: t.id,
        url: t.pendingUrl || t.url || "",
        title: t.title || t.pendingUrl || t.url || "",
        favIconUrl: t.favIconUrl,
        pinned: t.pinned,
        active: t.active,
        discarded: t.discarded,
        groupKey: typeof t.groupId === "number" && t.groupId >= 0 ? t.groupId : undefined,
      }));

    const cleaned = cleanWindow(
      {
        state: w.state,
        left: w.left,
        top: w.top,
        width: w.width,
        height: w.height,
        focused: w.focused,
        groups,
        tabs: rawTabs,
      },
      settings,
      includeWindowId
    );

    if (cleaned.tabs.length > 0) {
      if (includeWindowId && w.id != null) cleaned.id = w.id;
      result.push(cleaned);
    }
  }
  return result;
}

export async function collapseTabsToCollection(
  scope: CollapseScope,
  settings: Settings,
  targetCollectionId?: string,
  targetWindowId?: number
): Promise<{ collection: CollectionRecord; capturedCount: number; closedCount: number }> {
  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = activeTabs[0];
  const currentWinId = targetWindowId ?? activeTab?.windowId;

  let candidates: chrome.tabs.Tab[] = [];
  if (scope === "currentTab" && activeTab) {
    candidates = [activeTab];
  } else if (scope === "currentWindow" && currentWinId != null) {
    candidates = await chrome.tabs.query({ windowId: currentWinId });
  } else if (scope === "currentGroup" && activeTab && activeTab.groupId >= 0) {
    candidates = await chrome.tabs.query({ windowId: currentWinId, groupId: activeTab.groupId });
  } else if (scope === "exceptCurrent" && currentWinId != null && activeTab) {
    const all = await chrome.tabs.query({ windowId: currentWinId });
    candidates = all.filter((t) => t.id !== activeTab.id);
  } else if (scope === "leftTabs" && currentWinId != null && activeTab) {
    const all = await chrome.tabs.query({ windowId: currentWinId });
    candidates = all.filter((t) => t.index < activeTab.index);
  } else if (scope === "rightTabs" && currentWinId != null && activeTab) {
    const all = await chrome.tabs.query({ windowId: currentWinId });
    candidates = all.filter((t) => t.index > activeTab.index);
  } else if (scope === "allWindows" || scope === "nukeAll") {
    candidates = await chrome.tabs.query({ windowType: "normal" });
  }

  const includePinned = settings.capturePinnedPolicy === "allow" || scope === "currentTab";
  const filtered = candidates.filter((t) => {
    const u = t.pendingUrl || t.url || "";
    if (!u || u.startsWith(OWN_PREFIX)) return false;
    if (t.incognito && settings.incognitoPolicy !== "include") return false;
    if (!includePinned && t.pinned) return false;
    if (shouldIgnoreUrl(u, settings)) return false;
    return isRestorable(u);
  });

  if (!filtered.length) {
    throw new Error("No tabs matched your capture settings.");
  }

  // Group lookup for titles/colors
  const groupMap = new Map<number, { title: string; color: string }>();
  if (chrome.tabGroups) {
    try {
      const gs = await chrome.tabGroups.query({});
      for (const g of gs) groupMap.set(g.id, { title: g.title || "", color: g.color });
    } catch {
      /* ignore */
    }
  }

  const now = Date.now();
  const cols = await getAllCollections();
  let col = targetCollectionId ? cols.find((c) => c.id === targetCollectionId) || null : null;

  if (!col) {
    col = {
      id: uid(),
      parentFolderId: null,
      kind: "group",
      title: `Saved tabs · ${new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      color: "blue",
      createdAt: now,
      updatedAt: now,
      order: 0,
      tags: [],
      items: [],
    };
  }

  const existingByUrl = new Map<string, CollectionItem>();
  for (const item of col.items) existingByUrl.set(item.url, item);

  let capturedCount = 0;
  const newItems: CollectionItem[] = [...col.items];
  for (const t of filtered) {
    const cleaned: SavedTab = cleanTab({
      url: t.pendingUrl || t.url || "",
      title: t.title,
      favIconUrl: t.favIconUrl,
      pinned: t.pinned,
      groupId: t.groupId,
    });
    const existing = existingByUrl.get(cleaned.url);
    if (existing) {
      if (settings.duplicatePolicy === "reject" || settings.duplicatePolicy === "keepTitle") {
        continue;
      }
      if (settings.duplicatePolicy === "updateTitle") {
        existing.title = cleaned.title;
        capturedCount++;
        continue;
      }
    }
    const gInfo = typeof t.groupId === "number" && t.groupId >= 0 ? groupMap.get(t.groupId) : undefined;
    const item: CollectionItem = {
      id: uid(),
      url: cleaned.url,
      title: cleaned.title,
      favIconUrl: cleaned.favIconUrl,
      pinned: cleaned.pinned,
      groupTitle: gInfo?.title,
      groupColor: gInfo ? normalizeGroupColor(gInfo.color) : undefined,
      addedAt: now,
    };
    newItems.push(item);
    existingByUrl.set(cleaned.url, item);
    capturedCount++;
  }

  col.items = newItems;
  col.updatedAt = now;
  await putCollection(col);

  let closedCount = 0;
  if (settings.closeTabsAfterCapture || scope === "nukeAll") {
    if (scope === "nukeAll") {
      await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    } else if (currentWinId != null) {
      const winTabs = await chrome.tabs.query({ windowId: currentWinId });
      const closingAllInWin = winTabs.every((wt) => filtered.some((ft) => ft.id === wt.id));
      if (closingAllInWin) {
        await chrome.tabs.create({ windowId: currentWinId, url: chrome.runtime.getURL("dashboard.html") });
      }
    }
    const ids = filtered.map((t) => t.id).filter((id): id is number => id != null);
    if (ids.length) {
      const removed = await chrome.tabs
        .remove(ids)
        .then(() => true)
        .catch(() => false);
      if (removed) closedCount = ids.length;
    }
  }

  return { collection: col, capturedCount, closedCount };
}

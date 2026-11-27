import {
  countTabs,
  deduplicateWindows,
  extractDomain,
  findDuplicateOpenTabIds,
  findMatchingSavedSession,
  hasContent,
  isRestorable,
  metaOf,
  signature,
  uid,
} from "../shared/core.ts";
import {
  deleteCollection,
  deleteSnapshots,
  getAllCollections,
  getAllSnapshots,
  getBootMetrics,
  getCollection,
  getMetaIndex,
  getRecovery,
  getSettings,
  getSnapshot,
  putCollection,
  putSnapshot,
  recordSyncTombstones,
  saveSettings,
} from "../shared/db.ts";
import {
  collectionToSnapshot,
  exportAsBookmarksHtml,
  exportAsCsv,
  exportAsJson,
  exportAsMarkdown,
  exportAsOneTabText,
} from "../shared/import-export.ts";
import { checkForUpdates } from "./updates.ts";
import type { RpcHandlerMap } from "../shared/rpc.ts";
import type {
  AppStateSummary,
  CollectionRecord,
  SearchHit,
  SessionSnapshot,
  Settings,
} from "../shared/types.ts";
import { getRunId, pruneSnapshots } from "./autosave.ts";
import {
  deleteDriveBackup,
  deleteLocalBackup,
  downloadDriveBackup,
  driveSignIn,
  driveSignOut,
  driveSyncNow,
  getDriveBackupInfo,
  hasSessionDrivePassword,
  importFromRawText,
  listLocalBackups,
  listPinnedBookmarks,
  maybeAutoSyncDrive,
  pinToBookmarksBar,
  setSessionDrivePassword,
  showLocalBackup,
  syncCollectionsToBookmarks,
  unpinFromBookmarksBar,
  writeLocalBackup,
} from "./backups-sync.ts";
import { captureWindows, collapseTabsToCollection } from "./capture.ts";
import { clearRecovery, startupCheck, updateBadge } from "./recovery.ts";
import { restoreCollection, restoreSnapshot } from "./restore.ts";
import { checkIdleTabs } from "./suspender.ts";

export interface HandlerDeps {
  setupSidePanelBehavior: (settings: Settings) => Promise<void>;
  setupAlarms: () => Promise<void>;
  setupContextMenus: () => Promise<void>;
}

export function createRpcHandlers(deps: HandlerDeps): RpcHandlerMap {
  const { setupSidePanelBehavior, setupAlarms, setupContextMenus } = deps;

  return {
    async state(): Promise<AppStateSummary> {
      const [settings, metrics, recovery, idx, cols, tabs, wins, scriptingGranted] = await Promise.all([
        getSettings(),
        getBootMetrics(),
        getRecovery(),
        getMetaIndex(),
        getAllCollections(),
        chrome.tabs.query({ windowType: "normal" }),
        chrome.windows.getAll({ windowTypes: ["normal"] }),
        chrome.permissions?.contains?.({ permissions: ["scripting"] }).catch(() => false) ?? Promise.resolve(false),
      ]);
      const sleepingTabs = tabs.filter(
        (t) => t.discarded || (t.url || "").startsWith(chrome.runtime.getURL("suspend.html"))
      ).length;

      return {
        settings,
        lastSaveAt: (metrics.lastSaveAt as number) || null,
        lastBackupAt: (metrics.lastBackupAt as number) || null,
        lastBackupError: (metrics.lastBackupError as string) || null,
        lastSyncAt: (metrics.lastSyncAt as number) || null,
        lastSyncError: (metrics.lastSyncError as string) || null,
        driveConnected: Boolean(metrics.driveToken),
        driveEmail: (metrics.driveEmail as string) || null,
        driveE2EUnlocked: settings.driveEncryptE2E ? await hasSessionDrivePassword() : true,
        scriptingPermissionGranted: Boolean(scriptingGranted),
        recovery,
        counts: {
          auto: idx.filter((m) => m.kind === "auto" || m.kind === "windowClose" || m.kind === "browserExit").length,
          named: idx.filter((m) => m.kind === "named" || m.kind === "imported").length,
          collections: cols.length,
          openWindows: wins.length,
          openTabs: tabs.length,
          sleepingTabs,
        },
      };
    },

    async listSnapshots() {
      return (await getMetaIndex()).sort((a, b) => b.t - a.t);
    },

    async getSnapshot({ id }) {
      return getSnapshot(id);
    },

    async getOpenWindows() {
      const settings = await getSettings();
      return captureWindows(settings, true, true);
    },

    async checkSaveMatch({ windowId } = {}) {
      const settings = await getSettings();
      let windows = await captureWindows(settings, true);
      if (windowId != null) {
        windows = windows.filter((w) => w.id === windowId);
      }
      const clean = windows.map(({ id: _id, ...rest }) => ({
        ...rest,
        tabs: rest.tabs.map(({ id: _tid, ...t }) => t),
      }));
      const all = await getAllSnapshots();
      const { exact, closest } = findMatchingSavedSession(clean, all);
      return {
        exact: exact ? metaOf(exact) : null,
        closest: closest ? { meta: metaOf(closest.snap), overlap: closest.overlap } : null,
      };
    },

    async saveNamed({ name, tags = [], startupRegistered = false, windowId, replaceId }) {
      const settings = await getSettings();
      let captured = await captureWindows(settings, true);
      if (windowId != null) {
        captured = captured.filter((w) => w.id === windowId);
      }
      const windows = captured.map(({ id: _id, ...rest }) => ({
        ...rest,
        tabs: rest.tabs.map(({ id: _tid, ...t }) => t),
      }));
      if (!windows.length) throw new Error("No open tabs to save.");
      const now = Date.now();

      if (replaceId) {
        const existing = await getSnapshot(replaceId);
        if (!existing) throw new Error("Session to update not found.");
        existing.windows = windows;
        existing.windowCount = windows.length;
        existing.tabCount = countTabs(windows);
        existing.sig = signature(windows);
        existing.updatedAt = now;
        if (name && name.trim()) existing.name = name.trim().slice(0, 120);
        const meta = await putSnapshot(existing);
        void maybeAutoSyncDrive(settings);
        return meta;
      }

      const snap: SessionSnapshot = {
        id: uid(),
        t: now,
        updatedAt: now,
        kind: "named",
        name: String(name || "").trim().slice(0, 120) || new Date(now).toLocaleString(),
        runId: "",
        deviceName: settings.deviceName || undefined,
        tags,
        startupRegistered,
        windows,
        windowCount: windows.length,
        tabCount: countTabs(windows),
        sig: signature(windows),
      };
      const meta = await putSnapshot(snap);
      void maybeAutoSyncDrive(settings);
      return meta;
    },

    async promoteSnapshot({ id, name }) {
      const s = await getSnapshot(id);
      if (!s) throw new Error("Session not found");
      s.kind = "named";
      s.name = String(name || s.name || "").trim().slice(0, 120) || new Date(s.t).toLocaleString();
      s.updatedAt = Date.now();
      return putSnapshot(s);
    },

    async updateSnapshot({ id, patch }) {
      const s = await getSnapshot(id);
      if (!s) throw new Error("Session not found");
      if (typeof patch?.name === "string") s.name = patch.name.trim().slice(0, 120);
      if (Array.isArray(patch?.tags)) {
        s.tags = patch.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean);
      }
      if (typeof patch?.startupRegistered === "boolean") s.startupRegistered = patch.startupRegistered;
      if (typeof patch?.lastOpenedAt === "number" && Number.isFinite(patch.lastOpenedAt)) {
        s.lastOpenedAt = patch.lastOpenedAt;
      }
      if (Array.isArray(patch?.windows)) {
        s.windows = patch.windows;
        s.windowCount = patch.windows.length;
        s.tabCount = countTabs(patch.windows);
        s.sig = signature(patch.windows);
      }
      s.updatedAt = Date.now();
      return putSnapshot(s);
    },

    async deduplicateSnapshot({ id }) {
      const s = await getSnapshot(id);
      if (!s) throw new Error("Session not found");
      const { windows, removed } = deduplicateWindows(s.windows);
      s.windows = windows;
      s.windowCount = windows.length;
      s.tabCount = countTabs(windows);
      s.sig = signature(windows);
      s.updatedAt = Date.now();
      await putSnapshot(s);
      return { removed, tabCount: s.tabCount };
    },

    async deleteSnapshots({ ids }) {
      await deleteSnapshots(ids);
      await recordSyncTombstones(ids);
      for (const id of ids) {
        void unpinFromBookmarksBar({ type: "session", id }).catch(() => {});
      }
      const settings = await getSettings();
      void maybeAutoSyncDrive(settings);
      return true;
    },

    async mergeSnapshots({ ids, name }) {
      if (!Array.isArray(ids) || ids.length < 2) {
        throw new Error("Select at least 2 sessions to merge.");
      }
      const loaded: SessionSnapshot[] = [];
      for (const id of ids) {
        const s = await getSnapshot(id);
        if (s) loaded.push(s);
      }
      if (loaded.length < 2) throw new Error("Selected sessions could not be found.");
      const windows = loaded.flatMap((s) => s.windows).filter((w) => w.tabs.length > 0);
      const now = Date.now();
      const merged: SessionSnapshot = {
        id: uid(),
        t: now,
        updatedAt: now,
        kind: "named",
        name: (name || "").trim() || `Merged (${loaded.map((s) => s.name || "Session").slice(0, 2).join(" + ")})`.slice(0, 80),
        runId: await getRunId(),
        windows,
        windowCount: windows.length,
        tabCount: countTabs(windows),
        sig: signature(windows),
        tags: Array.from(new Set(loaded.flatMap((s) => s.tags || []))),
      };
      return putSnapshot(merged);
    },

    async restoreSnapshot({ id, windowIndex = null, skipOpen, allowDuplicates = false, modeOverride }) {
      const snap = await getSnapshot(id);
      if (!snap) throw new Error("Session not found");
      const rec = await getRecovery();
      if (rec && rec.id === id) await clearRecovery();
      const res = await restoreSnapshot(snap, { windowIndex, skipOpen, allowDuplicates, modeOverride });
      snap.lastOpenedAt = Date.now();
      await putSnapshot(snap).catch(() => {});
      return res;
    },

    async dedupeOpenTabs() {
      const wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
      const ids = findDuplicateOpenTabIds(wins.map((w) => ({ tabs: w.tabs || [] })));
      if (ids.length > 0) {
        await chrome.tabs.remove(ids).catch(() => {});
      }
      return { closed: ids.length };
    },

    async groupWindowByDomain({ windowId } = {}) {
      if (typeof chrome?.tabs?.group !== "function") {
        throw new Error("Tab groups API is not available in this browser.");
      }
      const targetWinId = windowId ?? (await chrome.windows.getLastFocused()).id;
      if (targetWinId == null) return { grouped: 0, groupCount: 0 };
      const suspendPrefix = chrome.runtime.getURL("suspend.html");
      const tabs = await chrome.tabs.query({ windowId: targetWinId });
      const existingGroupedIds = tabs
        .filter((t) => t.id != null && !t.pinned && typeof t.groupId === "number" && t.groupId >= 0)
        .map((t) => t.id as number);
      if (existingGroupedIds.length > 0 && typeof chrome?.tabs?.ungroup === "function") {
        await chrome.tabs.ungroup(existingGroupedIds as [number, ...number[]]);
        return { grouped: 0, groupCount: 0, ungrouped: existingGroupedIds.length };
      }
      const byDomain = new Map<string, number[]>();
      for (const t of tabs) {
        if (t.id == null || t.pinned) continue;
        let u = t.pendingUrl || t.url || "";
        if (u.startsWith(suspendPrefix)) {
          const hashIdx = u.indexOf("#");
          if (hashIdx >= 0) {
            const orig = new URLSearchParams(u.slice(hashIdx + 1)).get("url");
            if (orig) u = orig;
          }
        }
        if (!isRestorable(u)) continue;
        const d = extractDomain(u);
        const list = byDomain.get(d) || [];
        list.push(t.id);
        byDomain.set(d, list);
      }
      let grouped = 0;
      let groupCount = 0;
      let lastError: unknown = null;
      for (const [domain, ids] of byDomain.entries()) {
        if (ids.length < 2) continue;
        try {
          const gid = await chrome.tabs.group({
            tabIds: ids as [number, ...number[]],
          });
          if (typeof chrome?.tabGroups?.update === "function" && typeof gid === "number") {
            await chrome.tabGroups.update(gid, { title: domain }).catch(() => {});
          }
          grouped += ids.length;
          groupCount += 1;
        } catch (err) {
          lastError = err;
        }
      }
      if (grouped === 0 && lastError) {
        throw lastError instanceof Error ? lastError : new Error(String(lastError));
      }
      return { grouped, groupCount };
    },

    async focusOpenTab({ windowId, url, tabId }) {
      if (tabId != null) {
        const target = await chrome.tabs.get(tabId).catch(() => null);
        if (target?.id != null) {
          if (target.windowId != null) await chrome.windows.update(target.windowId, { focused: true }).catch(() => {});
          await chrome.tabs.update(target.id, { active: true }).catch(() => {});
          return true;
        }
      }
      const tabs = await chrome.tabs.query(windowId != null ? { windowId } : { windowType: "normal" });
      const match = tabs.find((t) => (t.pendingUrl || t.url) === url);
      if (match?.id != null) {
        if (match.windowId != null) await chrome.windows.update(match.windowId, { focused: true }).catch(() => {});
        await chrome.tabs.update(match.id, { active: true }).catch(() => {});
        return true;
      }
      await chrome.tabs.create({ url });
      return true;
    },

    async closeOpenTab({ windowId, url, tabId }) {
      if (tabId != null) {
        const removed = await chrome.tabs.remove(tabId).then(() => true).catch(() => false);
        if (removed) return true;
      }
      const tabs = await chrome.tabs.query(windowId != null ? { windowId } : { windowType: "normal" });
      const match = tabs.find((t) => (t.pendingUrl || t.url) === url);
      if (match?.id != null) {
        await chrome.tabs.remove(match.id).catch(() => {});
        return true;
      }
      return false;
    },

    async pinToBookmarksBar({ type, id, title }) {
      return pinToBookmarksBar({ type, id, title });
    },

    async unpinFromBookmarksBar({ type, id }) {
      return unpinFromBookmarksBar({ type, id });
    },

    async listPinnedBookmarks() {
      return listPinnedBookmarks();
    },

    async dismissRecovery() {
      await clearRecovery();
      return true;
    },

    async checkRecoveryNow() {
      return startupCheck(true);
    },

    async collapse({ scope, targetCollectionId, windowId, closeTabs }) {
      const s = await getSettings();
      const effectiveSettings = typeof closeTabs === "boolean" ? { ...s, closeTabsAfterCapture: closeTabs } : s;
      const res = await collapseTabsToCollection(scope, effectiveSettings, targetCollectionId, windowId);
      void syncCollectionsToBookmarks().catch(() => {});
      void setupContextMenus();
      void maybeAutoSyncDrive(s);
      return res;
    },

    async listCollections() {
      return getAllCollections();
    },

    async saveCollection({ col }) {
      const saved = await putCollection({ ...col, updatedAt: Date.now() });
      void syncCollectionsToBookmarks().catch(() => {});
      void setupContextMenus();
      const settings = await getSettings();
      void maybeAutoSyncDrive(settings);
      return saved;
    },

    async createCollection({ title, kind = "group", parentFolderId = null, color = "blue" }) {
      const now = Date.now();
      const col: CollectionRecord = {
        id: uid(),
        parentFolderId: parentFolderId ?? null,
        kind: kind || "group",
        title: String(title || "New Collection").trim().slice(0, 120),
        color: color || "blue",
        createdAt: now,
        updatedAt: now,
        order: 0,
        tags: [],
        items: [],
      };
      const saved = await putCollection(col);
      void setupContextMenus();
      return saved;
    },

    async addTabsToCollection({ collectionId, title, tabs }) {
      const now = Date.now();
      const valid = (tabs || []).filter((t) => t.url && isRestorable(t.url));
      if (!valid.length) throw new Error("No restorable tabs selected.");

      let col: CollectionRecord | null = collectionId ? await getCollection(collectionId) : null;
      if (!col) {
        col = {
          id: uid(),
          parentFolderId: null,
          kind: "group",
          title: String(title || "").trim().slice(0, 120) || `Selected Tabs · ${new Date(now).toLocaleTimeString()}`,
          color: "#0B87C9",
          createdAt: now,
          updatedAt: now,
          order: 0,
          tags: [],
          items: [],
        };
      }

      const existingUrls = new Set(col.items.map((i) => i.url));
      let added = 0;
      for (const t of valid) {
        if (existingUrls.has(t.url)) continue;
        existingUrls.add(t.url);
        col.items.push({
          id: uid(),
          url: t.url,
          title: String(t.title || t.url).slice(0, 500),
          favIconUrl: t.favIconUrl,
          pinned: t.pinned,
          addedAt: now,
        });
        added++;
      }
      col.updatedAt = now;
      const saved = await putCollection(col);
      void syncCollectionsToBookmarks().catch(() => {});
      void setupContextMenus();
      const settings = await getSettings();
      void maybeAutoSyncDrive(settings);
      return { collection: saved, added };
    },

    async deleteCollection({ id }) {
      await deleteCollection(id);
      await recordSyncTombstones([id]);
      void unpinFromBookmarksBar({ type: "collection", id }).catch(() => {});
      void syncCollectionsToBookmarks().catch(() => {});
      void setupContextMenus();
      const settings = await getSettings();
      void maybeAutoSyncDrive(settings);
      return true;
    },

    async restoreCollection({ id, actionOverride, modeOverride }) {
      const col = await getCollection(id);
      if (!col) throw new Error("Collection not found");
      const res = await restoreCollection(col, { actionOverride, modeOverride });
      const refreshed = await getCollection(id);
      if (refreshed) {
        refreshed.lastOpenedAt = Date.now();
        await putCollection(refreshed).catch(() => {});
      }
      return res;
    },

    async saveWindowAsSpace({ title, windowId } = {}) {
      const settings = await getSettings();
      const curWin = windowId != null
        ? await chrome.windows.get(windowId, { populate: true }).catch(() => null)
        : await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
      if (!curWin?.id) throw new Error("No active window found.");
      const tabs = (curWin.tabs || [])
        .filter((t) => {
          const u = t.pendingUrl || t.url || "";
          return isRestorable(u) && !u.startsWith(chrome.runtime.getURL(""));
        })
        .map((t) => ({
          id: uid(),
          url: t.pendingUrl || t.url || "",
          title: t.title || t.url || "",
          favIconUrl: t.favIconUrl,
          pinned: t.pinned,
          addedAt: Date.now(),
        }));
      if (!tabs.length) throw new Error("No restorable tabs in this window.");
      const now = Date.now();
      const col: CollectionRecord = {
        id: uid(),
        parentFolderId: null,
        kind: "group",
        title: String(title || "").trim().slice(0, 120) || `Collection · ${new Date(now).toLocaleTimeString()}`,
        color: settings.autoTabGroupColor === "random" ? "#0B87C9" : settings.autoTabGroupColor,
        trackingWindowId: curWin.id,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
        order: 0,
        tags: [],
        items: tabs,
      };
      const saved = await putCollection(col);
      void syncCollectionsToBookmarks().catch(() => {});
      return saved;
    },

    async switchSpace({ collectionId }) {
      const target = await getCollection(collectionId);
      if (!target) throw new Error("Collection not found");
      const curWin = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
      if (!curWin?.id) throw new Error("No active window found.");

      const settings = await getSettings();
      const ownPrefix = chrome.runtime.getURL("");
      const allCols = await getAllCollections();
      const activeSpace = allCols.find((c) => c.trackingWindowId === curWin.id);
      const restorableCurTabs = (curWin.tabs || []).filter((t) => {
        const u = t.pendingUrl || t.url || "";
        return isRestorable(u) && !u.startsWith(ownPrefix);
      });

      if (activeSpace && activeSpace.id !== target.id) {
        const existingQueues = new Map<string, CollectionRecord["items"]>();
        const archivedItems: CollectionRecord["items"] = [];
        for (const item of activeSpace.items) {
          if (item.archived) {
            archivedItems.push(item);
            continue;
          }
          const list = existingQueues.get(item.url) || [];
          list.push(item);
          existingQueues.set(item.url, list);
        }
        const nextActive = restorableCurTabs.map((t) => {
          const url = t.pendingUrl || t.url || "";
          const prev = existingQueues.get(url)?.shift();
          const title = t.title || url;
          if (prev) {
            return { ...prev, title, favIconUrl: t.favIconUrl ?? prev.favIconUrl, pinned: t.pinned };
          }
          return {
            id: uid(),
            url,
            title,
            favIconUrl: t.favIconUrl,
            pinned: t.pinned,
            addedAt: Date.now(),
          };
        });
        if (nextActive.length) activeSpace.items = [...nextActive, ...archivedItems];
        activeSpace.trackingWindowId = null;
        activeSpace.updatedAt = Date.now();
        await putCollection(activeSpace);
      } else if (!activeSpace && restorableCurTabs.length > 0) {
        const captured = (await captureWindows(settings, true)).filter((w) => w.id === curWin.id);
        const cleanWins = captured.map(({ id: _id, ...rest }) => ({
          ...rest,
          tabs: rest.tabs.map(({ id: _tid, ...t }) => t),
        }));
        if (cleanWins.length && hasContent(cleanWins)) {
          const now = Date.now();
          await putSnapshot({
            id: uid(),
            t: now,
            updatedAt: now,
            kind: "windowClose",
            name: `Before switching to ${target.title}`.slice(0, 120),
            runId: await getRunId(),
            deviceName: settings.deviceName || undefined,
            windows: cleanWins,
            windowCount: cleanWins.length,
            tabCount: countTabs(cleanWins),
            sig: signature(cleanWins),
          });
        }
      }

      target.trackingWindowId = curWin.id;
      target.lastOpenedAt = Date.now();
      await putCollection(target);

      const res = await restoreCollection(target, {
        actionOverride: "keep",
        modeOverride: "currentWindow",
        skipOpen: false,
      });
      void syncCollectionsToBookmarks().catch(() => {});
      return res;
    },

    async searchAll({ q }): Promise<SearchHit[]> {
      const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      const hits: SearchHit[] = [];
      const seen = new Set<string>();

      const settings = await getSettings();
      const openWins = await captureWindows(settings, true, true);
      openWins.forEach((w, wi) => {
        for (const t of w.tabs) {
          const hay = `${t.title} ${t.url} window ${wi + 1}`.toLowerCase();
          if (terms.every((term) => hay.includes(term)) && !seen.has(t.url)) {
            seen.add(t.url);
            hits.push({
              source: "open",
              id: String(w.id ?? wi),
              parentTitle: `Open · Window ${wi + 1}`,
              t: Date.now(),
              kind: "open",
              windowIndex: wi,
              tab: t,
            });
          }
        }
      });

      const snaps = (await getAllSnapshots()).sort((a, b) => b.t - a.t);
      for (const s of snaps) {
        s.windows.forEach((w, wi) => {
          for (const t of w.tabs) {
            const hay = `${t.title} ${t.url} ${s.name} ${(s.tags || []).join(" ")}`.toLowerCase();
            if (terms.every((term) => hay.includes(term)) && !seen.has(t.url)) {
              seen.add(t.url);
              hits.push({
                source: "snapshot",
                id: s.id,
                parentTitle: s.name || new Date(s.t).toLocaleString(),
                t: s.t,
                kind: s.kind,
                windowIndex: wi,
                tab: t,
              });
            }
          }
        });
        if (hits.length >= 250) break;
      }

      const cols = await getAllCollections();
      for (const c of cols) {
        for (const item of c.items) {
          if (item.archived) continue;
          const hay = `${item.title} ${item.url} ${item.notes || ""} ${c.title} ${c.tags.join(" ")}`.toLowerCase();
          if (terms.every((term) => hay.includes(term))) {
            hits.push({
              source: "collection",
              id: c.id,
              parentTitle: c.title,
              t: c.updatedAt,
              kind: "collection",
              tab: { url: item.url, title: item.title, favIconUrl: item.favIconUrl, pinned: item.pinned },
            });
          }
        }
      }
      return hits.slice(0, 300);
    },

    async sleepIdleNow() {
      const count = await checkIdleTabs(true);
      return { count };
    },

    async openUrl({ url, active }) {
      if (!isRestorable(url)) throw new Error("This address is restricted by the browser and can't be opened here.");
      const s = await getSettings();
      const shouldActivate =
        active !== undefined
          ? active
          : s.urlClickInClosedSession === "focused"
            ? true
            : s.urlClickInClosedSession === "closed"
              ? false
              : s.switchToOpenedTab;
      const createOpts: chrome.tabs.CreateProperties = { url, active: shouldActivate };
      if (s.openNextToActive) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
        if (activeTab && typeof activeTab.index === "number") {
          createOpts.index = activeTab.index + 1;
          createOpts.windowId = activeTab.windowId;
        }
      }
      await chrome.tabs.create(createOpts);
      return true;
    },

    async exportData({ format, ids, collectionIds }) {
      const [all, allCols] = await Promise.all([getAllSnapshots(), getAllCollections()]);
      if (collectionIds?.length) {
        const pickedCols = allCols.filter((c) => collectionIds.includes(c.id));
        if (format === "json") return exportAsJson([], pickedCols);
        const colSnaps = pickedCols.map(collectionToSnapshot);
        if (format === "html") return exportAsBookmarksHtml(colSnaps);
        if (format === "csv") return exportAsCsv(colSnaps);
        if (format === "markdown") return exportAsMarkdown(colSnaps);
        return exportAsOneTabText(colSnaps);
      }

      const selected = ids?.length ? all.filter((s) => ids.includes(s.id)) : all;
      const includeCols = !ids?.length;
      if (format === "json") return exportAsJson(selected, includeCols ? allCols : undefined);

      const exportSnaps = includeCols
        ? [...selected, ...allCols.filter((c) => c.kind === "group" && !c.archived && c.items.length > 0).map(collectionToSnapshot)]
        : selected;
      if (format === "html") return exportAsBookmarksHtml(exportSnaps);
      if (format === "csv") return exportAsCsv(exportSnaps);
      if (format === "markdown") return exportAsMarkdown(exportSnaps);
      return exportAsOneTabText(exportSnaps);
    },

    async importData({ text, password }) {
      const res = await importFromRawText(text, password);
      void syncCollectionsToBookmarks().catch(() => {});
      void setupContextMenus();
      const settings = await getSettings();
      void maybeAutoSyncDrive(settings);
      return res;
    },

    async setSettings({ patch }) {
      const next = await saveSettings(patch);
      if (patch && "driveEncryptE2E" in patch && !next.driveEncryptE2E) {
        await setSessionDrivePassword(null);
      }
      const keys = Object.keys(patch || {});
      if (keys.includes("toolbarClickAction")) {
        await setupSidePanelBehavior(next);
      }
      const alarmKeys = [
        "autoSaveEnabled",
        "autoSaveIntervalMin",
        "localBackupSchedule",
        "dailySleepEnabled",
        "dailySleepTime",
        "driveSyncEnabled",
        "driveAutoSync",
        "driveEncryptE2E",
      ];
      if (keys.length === 0 || keys.some((k) => alarmKeys.includes(k))) {
        await setupAlarms();
      }
      const retentionKeys = [
        "historyDays",
        "maxAutoSnapshots",
        "thinAfter2hHourly",
        "thinAfter48hDaily",
        "maxWindowCloseSaves",
        "maxBrowserExitSaves",
        "purgeUnnamedClosedDays",
      ];
      if (keys.length === 0 || keys.some((k) => retentionKeys.includes(k))) {
        await pruneSnapshots();
      }
      if (keys.length === 0 || keys.includes("showBadgeAlert") || keys.includes("showTabCountBadge")) {
        await updateBadge();
      }
      return next;
    },

    async backupNow() {
      return writeLocalBackup();
    },

    async listLocalBackups() {
      return listLocalBackups();
    },

    async showLocalBackup({ id }) {
      await showLocalBackup(id);
      return true;
    },

    async deleteLocalBackup({ id }) {
      await deleteLocalBackup(id);
      return true;
    },

    async driveSignIn({ clientId, clientSecret }) {
      const res = await driveSignIn(clientId, clientSecret);
      await saveSettings({
        driveClientId: clientId.trim(),
        ...(clientSecret !== undefined ? { driveClientSecret: clientSecret.trim() } : {}),
        driveSyncEnabled: true,
      });
      return res;
    },

    async driveSignOut() {
      await driveSignOut();
      await saveSettings({ driveSyncEnabled: false });
      return true;
    },

    async driveSyncNow({ password } = {}) {
      return driveSyncNow(password);
    },

    async getDriveBackupInfo() {
      return getDriveBackupInfo();
    },

    async downloadDriveBackup() {
      return downloadDriveBackup();
    },

    async deleteDriveBackup() {
      return deleteDriveBackup();
    },

    async openSidePanel() {
      const win = await chrome.windows.getLastFocused();
      if (win.id != null && chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ windowId: win.id });
      }
      return true;
    },

    async storageStats() {
      const bytes = (await chrome.storage.local.getBytesInUse?.(null).catch(() => null)) ?? null;
      const est = await navigator.storage?.estimate?.().catch(() => null);
      return { extensionLocalBytes: bytes, indexedDbBytes: est?.usage ?? null };
    },

    async compressAllFavicons() {
      const snaps = await getAllSnapshots();
      let updatedSnapshots = 0;
      for (const snap of snaps) {
        let changed = false;
        const nextWins = snap.windows.map((w) => ({
          ...w,
          tabs: w.tabs.map((t) => {
            if (t.favIconUrl && t.favIconUrl.startsWith("data:") && t.favIconUrl.length > 512) {
              changed = true;
              const copy = { ...t };
              delete copy.favIconUrl;
              return copy;
            }
            return t;
          }),
        }));
        if (changed) {
          await putSnapshot({ ...snap, windows: nextWins, updatedAt: Date.now() });
          updatedSnapshots += 1;
        }
      }

      const cols = await getAllCollections();
      let updatedCollections = 0;
      for (const col of cols) {
        let changed = false;
        const nextItems = col.items.map((it) => {
          if (it.favIconUrl && it.favIconUrl.startsWith("data:") && it.favIconUrl.length > 512) {
            changed = true;
            const copy = { ...it };
            delete copy.favIconUrl;
            return copy;
          }
          return it;
        });
        if (changed) {
          await putCollection({ ...col, items: nextItems, updatedAt: Date.now() });
          updatedCollections += 1;
        }
      }
      return { updatedSnapshots, updatedCollections };
    },

    async importReadingList() {
      const rl = (chrome as unknown as { readingList?: { query: (q: Record<string, unknown>) => Promise<Array<{ url: string; title: string; creationTime?: number }>> } }).readingList;
      if (!rl?.query) {
        throw new Error("Allow Reading List permission in Chrome to import Reading List items.");
      }
      const entries = await rl.query({});
      const valid = entries.filter((e) => isRestorable(e.url));
      if (valid.length === 0) {
        return { imported: 0, collectionId: null };
      }
      const now = Date.now();
      const existingCols = await getAllCollections();
      const existing = existingCols.find((c) => c.kind === "group" && c.title === "Chrome Reading List");
      if (existing) {
        const seenUrls = new Set(existing.items.map((i) => i.url));
        const additions = valid
          .filter((e) => !seenUrls.has(e.url))
          .map((e) => ({
            id: uid(),
            url: e.url,
            title: e.title || e.url,
            addedAt: e.creationTime || now,
          }));
        if (additions.length === 0) {
          return { imported: 0, collectionId: existing.id };
        }
        await putCollection({
          ...existing,
          updatedAt: now,
          items: [...existing.items, ...additions],
        });
        return { imported: additions.length, collectionId: existing.id };
      }
      const col: CollectionRecord = {
        id: uid(),
        parentFolderId: null,
        kind: "group",
        title: "Chrome Reading List",
        color: "#0EA5E9",
        createdAt: now,
        updatedAt: now,
        order: 0,
        tags: ["reading-list"],
        items: valid.map((e) => ({
          id: uid(),
          url: e.url,
          title: e.title || e.url,
          addedAt: e.creationTime || now,
        })),
      };
      await putCollection(col);
      return { imported: col.items.length, collectionId: col.id };
    },

    async checkForUpdates() {
      return await checkForUpdates();
    },

    async applyPendingUpdate() {
      chrome.runtime.reload();
      return { ok: true };
    },
  };
}

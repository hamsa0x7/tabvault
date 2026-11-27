import { countTabs, extractDomain, isRestorable, signature, uid } from "../shared/core.ts";
import { getAllCollections, getSettings, putSnapshot } from "../shared/db.ts";
import { openOrFocusDashboard } from "../shared/format.ts";
import type { SearchHit, Settings } from "../shared/types.ts";
import {
  autosave,
  getRunId,
  handleWindowClosed,
  refreshLiveWindowCache,
  registerStartupCheckHook,
  scheduleSave,
} from "./autosave.ts";
import {
  attachOffscreenDownloadListener,
  cleanupOffscreenDownloads,
  driveSyncNow,
  hasSessionDrivePassword,
  writeLocalBackup,
} from "./backups-sync.ts";
import { captureWindows, collapseTabsToCollection } from "./capture.ts";
import {
  runStartupPolicies,
  scheduleStartupCheck,
  startupCheck,
  updateBadge,
} from "./recovery.ts";
import { checkIdleTabs, markTabActive, removeTabActivity, unsuspendIfPlaceholder } from "./suspender.ts";
import { checkForUpdates, recordPendingUpdate } from "./updates.ts";

registerStartupCheckHook(() => {
  void scheduleStartupCheck();
});

async function setupAlarms(): Promise<void> {
  const s = await getSettings();
  await chrome.alarms.clear("autosave");
  if (s.autoSaveEnabled) {
    await chrome.alarms.create("autosave", { periodInMinutes: Math.max(0.5, s.autoSaveIntervalMin) });
  }
  await chrome.alarms.create("beat", { periodInMinutes: 1 });
  await chrome.alarms.create("suspender", { periodInMinutes: 1 });

  await chrome.alarms.clear("backup");
  if (s.localBackupSchedule === "hourly") {
    await chrome.alarms.create("backup", { periodInMinutes: 60 });
  } else if (s.localBackupSchedule === "daily") {
    await chrome.alarms.create("backup", { periodInMinutes: 1440 });
  } else if (s.localBackupSchedule === "weekly") {
    await chrome.alarms.create("backup", { periodInMinutes: 7 * 1440 });
  }

  await chrome.alarms.clear("dailySleep");
  if (s.dailySleepEnabled && /^\d{2}:\d{2}$/.test(s.dailySleepTime)) {
    const [hh, mm] = s.dailySleepTime.split(":").map(Number);
    const now = new Date();
    const next = new Date(now);
    next.setHours(hh, mm, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    await chrome.alarms.create("dailySleep", { when: next.getTime(), periodInMinutes: 1440 });
  }

  await chrome.alarms.clear("driveSync");
  if (s.driveSyncEnabled && s.driveAutoSync) {
    await chrome.alarms.create("driveSync", { periodInMinutes: 15 });
  }
}

let contextMenuQueue: Promise<void> = Promise.resolve();

function setupContextMenus(): Promise<void> {
  contextMenuQueue = contextMenuQueue
    .then(async () => {
      if (!chrome.contextMenus) return;
      await chrome.contextMenus.removeAll().catch(() => {});

      const recentCols = (await getAllCollections().catch(() => []))
        .filter((c) => !c.archived && c.kind !== "folder")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 10);

      const createItem = (opts: chrome.contextMenus.CreateProperties) => {
        chrome.contextMenus.create(opts, () => {
          void chrome.runtime.lastError;
        });
      };

      createItem({ id: "st-save-snapshot", title: "Save all open windows as session", contexts: ["page", "action"] });
      createItem({ id: "st-send-tab", title: "Move this tab to a new collection", contexts: ["page", "action"] });
      createItem({ id: "st-send-window", title: "Move this window to a new collection", contexts: ["page", "action"] });

      createItem({ id: "st-send-tab-prev", title: "Move this tab to previous collection", contexts: ["page", "action"] });
      createItem({ id: "st-send-win-prev", title: "Move this window to previous collection", contexts: ["page", "action"] });

      if (recentCols.length === 0) {
        createItem({
          id: "st-send-tab-none",
          parentId: "st-send-tab-prev",
          title: "No collections yet",
          enabled: false,
          contexts: ["page", "action"],
        });
        createItem({
          id: "st-send-win-none",
          parentId: "st-send-win-prev",
          title: "No collections yet",
          enabled: false,
          contexts: ["page", "action"],
        });
      } else {
        for (const col of recentCols) {
          const label = (col.title || "Untitled collection").replace(/&/g, "&&");
          createItem({
            id: `st-send-tab-col:${col.id}`,
            parentId: "st-send-tab-prev",
            title: label,
            contexts: ["page", "action"],
          });
          createItem({
            id: `st-send-win-col:${col.id}`,
            parentId: "st-send-win-prev",
            title: label,
            contexts: ["page", "action"],
          });
        }
      }

      createItem({ id: "st-open-dashboard", title: "Open Dashboard", contexts: ["page", "action"] });
    })
    .catch(() => {});
  return contextMenuQueue;
}

async function runDailySleep(): Promise<void> {
  const s = await getSettings();
  if (!s.dailySleepEnabled) return;
  if (s.dailySleepCloseTabs) {
    await collapseTabsToCollection("nukeAll", s).catch(() => {});
  } else {
    const windows = await captureWindows(s);
    if (!windows.length) return;
    const now = Date.now();
    await putSnapshot({
      id: uid(),
      t: now,
      updatedAt: now,
      kind: "named",
      name: `Daily save · ${new Date(now).toLocaleDateString()}`,
      runId: await getRunId(),
      windows,
      windowCount: windows.length,
      tabCount: countTabs(windows),
      sig: signature(windows),
    });
  }
}

// ============================================================================
// Chrome Event Listeners
// ============================================================================
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "autosave") void autosave();
  else if (alarm.name === "beat") void getRunId().then((rid) => chrome.storage.local.set({ beat: { runId: rid, t: Date.now() } }));
  else if (alarm.name === "startupCheck") void startupCheck(false);
  else if (alarm.name === "suspender") void checkIdleTabs(false);
  else if (alarm.name === "backup") {
    void writeLocalBackup().catch((e) =>
      chrome.storage.local.set({ lastBackupError: String((e as Error)?.message || e) })
    );
  } else if (alarm.name === "dailySleep") void runDailySleep();
  else if (alarm.name === "offscreenCleanup") void cleanupOffscreenDownloads(true);
  else if (alarm.name === "driveSync") {
    void (async () => {
      const s = await getSettings();
      if (!s.driveSyncEnabled || !s.driveAutoSync) return;
      if (s.driveEncryptE2E && !(await hasSessionDrivePassword())) return;
      await driveSyncNow();
    })().catch((e) =>
      chrome.storage.local.set({ lastSyncError: String((e as Error)?.message || e) })
    );
  }
});

attachOffscreenDownloadListener();
chrome.permissions?.onAdded?.addListener((perms) => {
  if (perms.permissions?.includes("downloads")) {
    attachOffscreenDownloadListener();
  }
});

async function setupSidePanelBehavior(settingsArg?: Settings): Promise<void> {
  const s = settingsArg ?? (await getSettings().catch(() => null));
  const action = s?.toolbarClickAction ?? "openSidePanel";
  const openPanelOnClick = action === "openSidePanel";
  await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: openPanelOnClick }).catch(() => {});
  if (chrome.action?.setPopup) {
    await chrome.action.setPopup({ popup: action === "openPopup" ? "popup.html" : "" }).catch(() => {});
  }
}

void setupSidePanelBehavior();

chrome.action?.onClicked?.addListener(async () => {
  const s = await getSettings();
  if (s.toolbarClickAction === "openDashboard") {
    await openOrFocusDashboard();
  } else if (s.toolbarClickAction === "sendCurrentWindow") {
    const win = await chrome.windows.getLastFocused().catch(() => null);
    await saveAllWindowsAsSession(s, win?.id).catch(() => {});
  } else if (s.toolbarClickAction === "sendCurrentTab") {
    await collapseTabsToCollection("currentTab", { ...s, closeTabsAfterCapture: false }).catch(() => {});
    void setupContextMenus();
  } else if (s.toolbarClickAction === "sendAllWindows") {
    await saveAllWindowsAsSession(s).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.remove("pendingUpdateVersion").catch(() => {});
  await setupSidePanelBehavior();
  await setupAlarms();
  await setupContextMenus();
  await refreshLiveWindowCache();
  scheduleSave(500);
});

chrome.runtime.onUpdateAvailable.addListener(async (details) => {
  await recordPendingUpdate(details.version);
  const s = await getSettings();
  if (s.autoApplyUpdates) {
    chrome.runtime.reload();
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await setupSidePanelBehavior();
  await getRunId();
  await setupAlarms();
  await setupContextMenus();
  await refreshLiveWindowCache();
  await runStartupPolicies();
  const s = await getSettings();
  if (s.checkUpdatesOnStartup) {
    void checkForUpdates().catch(() => {});
  }
  if (s.localBackupSchedule === "startup") {
    void writeLocalBackup().catch((e) =>
      chrome.storage.local.set({ lastBackupError: String((e as Error)?.message || e) })
    );
  }
  if (s.driveSyncEnabled && s.driveAutoSync && (!s.driveEncryptE2E || (await hasSessionDrivePassword()))) {
    void driveSyncNow().catch((e) =>
      chrome.storage.local.set({ lastSyncError: String((e as Error)?.message || e) })
    );
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id != null) void markTabActive(tab.id);
  scheduleSave();
  void updateBadge();
});

chrome.tabs.onUpdated.addListener((_id, ch, tab) => {
  if (ch.url || ch.status === "complete" || ch.pinned !== undefined || ch.groupId !== undefined) {
    scheduleSave();
  }
  if ((ch.url || ch.status === "complete") && tab?.windowId != null) {
    void maybeLiveAutoGroup(tab.windowId);
  }
});

chrome.tabs.onRemoved.addListener((tabId, info) => {
  void removeTabActivity(tabId);
  if (!info.isWindowClosing) {
    scheduleSave();
    void maybeLiveAutoUngroup(info.windowId);
  }
  void updateBadge();
});

async function maybeLiveAutoGroup(windowId: number): Promise<void> {
  if (typeof chrome?.tabs?.group !== "function") return;
  const s = await getSettings();
  if (!s.autoTabGroupByDomain) return;
  const win = await chrome.windows.get(windowId).catch(() => null);
  if (!win || win.type !== "normal") return;
  const tabs = await chrome.tabs.query({ windowId });
  const byDomain = new Map<string, chrome.tabs.Tab[]>();
  for (const t of tabs) {
    if (t.id == null || t.pinned) continue;
    const u = t.pendingUrl || t.url || "";
    if (!isRestorable(u)) continue;
    const d = extractDomain(u);
    const list = byDomain.get(d) || [];
    list.push(t);
    byDomain.set(d, list);
  }
  for (const [domain, groupTabs] of byDomain.entries()) {
    if (groupTabs.length < 2) continue;
    const groupIds = new Set(groupTabs.map((t) => t.groupId ?? -1));
    if (groupIds.size === 1 && !groupIds.has(-1)) continue;
    const existingGroupId = groupTabs.find((t) => typeof t.groupId === "number" && t.groupId >= 0)?.groupId;
    const ids = groupTabs.map((t) => t.id!).filter((id) => typeof id === "number");
    try {
      const gid = await chrome.tabs.group(
        existingGroupId != null && existingGroupId >= 0
          ? { tabIds: ids as [number, ...number[]], groupId: existingGroupId }
          : { tabIds: ids as [number, ...number[]] }
      );
      if (typeof chrome?.tabGroups?.update === "function" && typeof gid === "number" && existingGroupId == null) {
        const updateProps: chrome.tabGroups.UpdateProperties = { title: domain };
        if (s.autoTabGroupColor !== "random") updateProps.color = s.autoTabGroupColor;
        await chrome.tabGroups.update(gid, updateProps).catch(() => {});
      }
    } catch {
      /* ignore Chromium fork quirks */
    }
  }
}

async function maybeLiveAutoUngroup(windowId: number): Promise<void> {
  if (typeof chrome?.tabs?.ungroup !== "function") return;
  const s = await getSettings();
  if (!s.autoTabUngroupSingle) return;
  const tabs = await chrome.tabs.query({ windowId });
  const counts = new Map<number, number[]>();
  for (const t of tabs) {
    if (t.id != null && typeof t.groupId === "number" && t.groupId >= 0) {
      const list = counts.get(t.groupId) || [];
      list.push(t.id);
      counts.set(t.groupId, list);
    }
  }
  for (const ids of counts.values()) {
    if (ids.length === 1) {
      await chrome.tabs.ungroup(ids[0]).catch(() => {});
    }
  }
}

chrome.tabs.onActivated.addListener((info) => {
  void markTabActive(info.tabId);
  void unsuspendIfPlaceholder(info.tabId);
});

chrome.tabs.onMoved.addListener(() => scheduleSave());
chrome.tabs.onAttached.addListener(() => scheduleSave());

chrome.windows.onCreated.addListener(() => {
  scheduleSave();
  void refreshLiveWindowCache();
});

chrome.windows.onRemoved.addListener((windowId) => {
  void handleWindowClosed(windowId);
  scheduleSave(4000);
});

if (chrome.tabGroups) {
  chrome.tabGroups.onUpdated.addListener(() => scheduleSave());
}

async function saveAllWindowsAsSession(s: Settings, windowId?: number): Promise<void> {
  let captured = await captureWindows(s, windowId != null);
  if (windowId != null) {
    captured = captured.filter((w) => w.id === windowId);
  }
  const windows = captured.map(({ id: _id, ...rest }) => ({
    ...rest,
    tabs: rest.tabs.map(({ id: _tid, ...t }) => t),
  }));
  if (!windows.length) return;
  const now = Date.now();
  await putSnapshot({
    id: uid(),
    t: now,
    updatedAt: now,
    kind: "named",
    name: `Quick save · ${new Date(now).toLocaleString()}`,
    runId: await getRunId(),
    windows,
    windowCount: windows.length,
    tabCount: countTabs(windows),
    sig: signature(windows),
  });
}

chrome.contextMenus?.onClicked.addListener(async (info) => {
  const s = await getSettings();
  const id = String(info.menuItemId || "");
  if (id === "st-save-snapshot") {
    await saveAllWindowsAsSession(s).catch(() => {});
  } else if (id === "st-send-tab") {
    await collapseTabsToCollection("currentTab", s).catch(() => {});
    void setupContextMenus();
  } else if (id === "st-send-window") {
    await collapseTabsToCollection("currentWindow", s).catch(() => {});
    void setupContextMenus();
  } else if (id.startsWith("st-send-tab-col:")) {
    await collapseTabsToCollection("currentTab", s, id.slice("st-send-tab-col:".length)).catch(() => {});
    void setupContextMenus();
  } else if (id.startsWith("st-send-win-col:")) {
    await collapseTabsToCollection("currentWindow", s, id.slice("st-send-win-col:".length)).catch(() => {});
    void setupContextMenus();
  } else if (id === "st-open-dashboard") {
    await openOrFocusDashboard();
  }
});

chrome.commands?.onCommand.addListener(async (cmd) => {
  const s = await getSettings();
  if (cmd === "open-dashboard") {
    await openOrFocusDashboard();
  } else if (cmd === "save-all-windows") {
    await saveAllWindowsAsSession(s);
  } else if (cmd === "collapse-current-window") {
    await collapseTabsToCollection("currentWindow", s).catch(() => {});
  } else if (cmd === "nuke-all-windows") {
    await collapseTabsToCollection("nukeAll", s).catch(() => {});
  }
});

function escapeOmniboxXml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

chrome.omnibox?.onInputChanged?.addListener((text, suggest) => {
  const q = text.trim();
  if (!q) {
    suggest([]);
    return;
  }
  void handlers
    .searchAll({ q })
    .then((hits) => {
      const results = (hits as SearchHit[]).slice(0, 6).map((hit) => {
        const title = escapeOmniboxXml((hit.tab.title || hit.tab.url).slice(0, 80));
        const parent = escapeOmniboxXml(hit.parentTitle.slice(0, 40));
        const domain = escapeOmniboxXml(extractDomain(hit.tab.url));
        const badge = hit.source === "open" ? "Open" : hit.source === "collection" ? "Collection" : "Saved";
        const content =
          hit.source === "open" && hit.tab.id != null
            ? `st-focus:${hit.tab.id}:${hit.tab.url}`
            : hit.tab.url;
        return {
          content,
          description: `<match>${title}</match> <dim>— ${badge} · ${parent} (${domain})</dim>`,
        };
      });
      suggest(results);
    })
    .catch(() => suggest([]));
});

chrome.omnibox?.onInputEntered.addListener(async (text) => {
  const trimmed = text.trim();
  if (trimmed.startsWith("st-focus:")) {
    const rest = trimmed.slice("st-focus:".length);
    const sepIdx = rest.indexOf(":");
    const tabId = sepIdx > 0 ? Number(rest.slice(0, sepIdx)) : undefined;
    const url = sepIdx >= 0 ? rest.slice(sepIdx + 1) : "";
    if (url) {
      await handlers.focusOpenTab({ tabId: Number.isNaN(tabId) ? undefined : tabId, url });
      return;
    }
  }
  if (isRestorable(trimmed)) {
    await handlers.openUrl({ url: trimmed, active: true });
    return;
  }
  const q = encodeURIComponent(trimmed);
  await openOrFocusDashboard(`dashboard.html${q ? `?q=${q}` : ""}`);
});

import { createRpcHandlers } from "./handlers.ts";
import type { RpcHandlerMap } from "../shared/rpc.ts";

const handlers: RpcHandlerMap = createRpcHandlers({
  setupSidePanelBehavior,
  setupAlarms,
  setupContextMenus,
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg?.target === "offscreen") return false;
  (async () => {
    const cmd = typeof msg?.cmd === "string" ? msg.cmd : "";
    if (!Object.hasOwn(handlers, cmd)) throw new Error(`Unknown command: ${cmd}`);
    const fn = handlers[cmd as keyof RpcHandlerMap] as (m: unknown) => Promise<unknown>;
    return fn(msg);
  })().then(
    (r) => reply({ ok: true, r }),
    (e) => reply({ ok: false, error: String((e as Error)?.message || e) })
  );
  return true;
});

// Initialize runId immediately when the service worker wakes
void getRunId();
void updateBadge();

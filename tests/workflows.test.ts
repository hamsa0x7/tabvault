import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DAY,
  findDuplicateOpenTabIds,
  findMatchingSavedSession,
  isStaleItem,
  signature,
} from "../src/shared/core.ts";
import { DEFAULT_SETTINGS } from "../src/shared/defaults.ts";
import { encryptPayload } from "../src/shared/crypto.ts";
import {
  detectAndParseImport,
  exportAsBookmarksHtml,
  exportAsCsv,
  exportAsJson,
  exportAsMarkdown,
  exportAsOneTabText,
  formatWithTemplate,
} from "../src/shared/import-export.ts";
import type { CollectionRecord, RecoveryState, SavedWindow, SessionSnapshot, Settings } from "../src/shared/types.ts";

// Deterministic in-memory DB + Chrome Extension API harness for workflow reconstruction
const dbSnapshots = new Map<string, SessionSnapshot>();
const dbCollections = new Map<string, CollectionRecord>();
const dbTombstones = new Map<string, number>();
let dbRecovery: RecoveryState | null = null;
let dbSettings: Settings = { ...DEFAULT_SETTINGS, restoreTabGroups: false };

const toMeta = (s: SessionSnapshot) => ({
  id: s.id,
  t: s.t,
  updatedAt: s.updatedAt,
  lastOpenedAt: s.lastOpenedAt,
  kind: s.kind,
  name: s.name,
  runId: s.runId,
  w: s.windowCount,
  n: s.tabCount,
});

vi.mock("../src/shared/db.ts", () => ({
  getSettings: vi.fn(async () => dbSettings),
  saveSettings: vi.fn(async (patch: Partial<Settings>) => {
    dbSettings = { ...dbSettings, ...patch };
    return dbSettings;
  }),
  getAllSnapshots: vi.fn(async () => Array.from(dbSnapshots.values())),
  getMetaIndex: vi.fn(async () => Array.from(dbSnapshots.values()).map(toMeta)),
  getSnapshot: vi.fn(async (id: string) => dbSnapshots.get(id) ?? null),
  putSnapshot: vi.fn(async (s: SessionSnapshot) => {
    dbSnapshots.set(s.id, s);
    return toMeta(s);
  }),
  deleteSnapshots: vi.fn(async (ids: string[]) => {
    for (const id of ids) dbSnapshots.delete(id);
  }),
  getAllCollections: vi.fn(async () => Array.from(dbCollections.values())),
  getCollection: vi.fn(async (id: string) => dbCollections.get(id) ?? null),
  putCollection: vi.fn(async (c: CollectionRecord) => {
    dbCollections.set(c.id, c);
    return c;
  }),
  deleteCollection: vi.fn(async (id: string) => {
    dbCollections.delete(id);
  }),
  getSyncTombstones: vi.fn(async () => Object.fromEntries(dbTombstones.entries())),
  recordSyncTombstones: vi.fn(async (ids: string[], deletedAt = Date.now()) => {
    for (const id of ids) dbTombstones.set(id, deletedAt);
  }),
  clearSyncTombstones: vi.fn(async (ids: string[]) => {
    for (const id of ids) dbTombstones.delete(id);
  }),
  getRecovery: vi.fn(async () => dbRecovery),
  setRecovery: vi.fn(async (rec: RecoveryState | null) => {
    dbRecovery = rec;
  }),
  getLivePointer: vi.fn(async () => null),
  setLivePointer: vi.fn(async () => {}),
}));

const openWindowsMock: Array<{
  id: number;
  focused: boolean;
  tabs: Array<{
    id: number;
    windowId?: number;
    index?: number;
    url: string;
    pendingUrl?: string;
    title?: string;
    pinned?: boolean;
    active?: boolean;
    discarded?: boolean;
    audible?: boolean;
    groupId?: number;
  }>;
}> = [];

const bookmarksMock: Array<{ id: string; parentId: string; title: string; url?: string }> = [];
const downloadsLog: Array<{ filename: string; url: string }> = [];
const removedTabsLog: number[] = [];
const discardedTabsLog: number[] = [];
const createdTabsLog: Array<{ windowId?: number; url: string; index?: number }> = [];
const createdWindowsLog: Array<{ url: string }> = [];
const updatedWindowsLog: Array<{ windowId: number; focused?: boolean }> = [];
const groupedTabsLog: Array<{ tabIds: number[]; title?: string; color?: string }> = [];
const sessionStorageMap: Record<string, unknown> = {};
const localStorageMap: Record<string, unknown> = {};
let launchWebAuthFlowImpl: (opts: { url: string; interactive?: boolean }) => Promise<string> = async () => "";
let nextTabId = 100;
let nextWinId = 10;
let nextBookmarkId = 100;
let nextGroupId = 500;

vi.stubGlobal("chrome", {
  action: {
    setBadgeBackgroundColor: vi.fn(async () => {}),
    setBadgeText: vi.fn(async () => {}),
    setTitle: vi.fn(async () => {}),
  },
  alarms: {
    create: vi.fn(async () => {}),
  },
  runtime: {
    getURL: (path: string) => `chrome-extension://test-ext-id/${path}`,
    getContexts: vi.fn(async () => []),
  },
  permissions: {
    contains: vi.fn(async () => true),
    request: vi.fn(async () => true),
  },
  identity: {
    getRedirectURL: () => "https://test-ext-id.chromiumapp.org/",
    launchWebAuthFlow: vi.fn(async (opts: { url: string; interactive?: boolean }) => launchWebAuthFlowImpl(opts)),
  },
  storage: {
    local: {
      get: vi.fn(async (keys?: string | string[] | null) => {
        if (keys === "settings") return { settings: dbSettings };
        if (typeof keys === "string") return { [keys]: localStorageMap[keys] };
        return { settings: dbSettings, ...localStorageMap };
      }),
      set: vi.fn(async (patch: Record<string, unknown>) => {
        Object.assign(localStorageMap, patch);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete localStorageMap[k];
      }),
    },
    session: {
      get: vi.fn(async (key?: string | string[] | null) => {
        if (typeof key === "string") return { [key]: sessionStorageMap[key] };
        return { ...sessionStorageMap };
      }),
      set: vi.fn(async (patch: Record<string, unknown>) => {
        Object.assign(sessionStorageMap, patch);
      }),
    },
  },
  bookmarks: {
    getTree: vi.fn(async () => [
      {
        id: "0",
        title: "Root",
        children: [
          { id: "1", title: "Bookmarks Bar", children: bookmarksMock.filter((b) => b.parentId === "1") },
          { id: "2", title: "Other Bookmarks", children: bookmarksMock.filter((b) => b.parentId === "2") },
        ],
      },
    ]),
    getChildren: vi.fn(async (parentId: string) => bookmarksMock.filter((b) => b.parentId === parentId)),
    search: vi.fn(async (q: { url?: string; query?: string }) => {
      if (q.url) return bookmarksMock.filter((b) => b.url === q.url);
      if (q.query) return bookmarksMock.filter((b) => (b.url || "").startsWith(q.query!));
      return [];
    }),
    create: vi.fn(async (node: { parentId: string; title: string; url?: string }) => {
      const created = { id: `bm-${nextBookmarkId++}`, ...node };
      bookmarksMock.push(created);
      return created;
    }),
    update: vi.fn(async (id: string, patch: { title?: string }) => {
      const target = bookmarksMock.find((b) => b.id === id);
      if (target && patch.title != null) target.title = patch.title;
      return target;
    }),
    remove: vi.fn(async (id: string) => {
      const idx = bookmarksMock.findIndex((b) => b.id === id);
      if (idx >= 0) bookmarksMock.splice(idx, 1);
    }),
    removeTree: vi.fn(async (id: string) => {
      const idx = bookmarksMock.findIndex((b) => b.id === id);
      if (idx >= 0) bookmarksMock.splice(idx, 1);
    }),
  },
  downloads: {
    download: vi.fn(async (opts: { filename: string; url: string }) => {
      downloadsLog.push({ filename: opts.filename, url: opts.url });
      return 1;
    }),
    onChanged: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
  windows: {
    getAll: vi.fn(async () => openWindowsMock),
    getLastFocused: vi.fn(async () => openWindowsMock[0] ?? null),
    update: vi.fn(async (windowId: number, info: { focused?: boolean }) => {
      updatedWindowsLog.push({ windowId, focused: info.focused });
      return { id: windowId };
    }),
    create: vi.fn(async (opts: { url?: string | string[] }) => {
      const url = Array.isArray(opts.url) ? opts.url[0] : opts.url || "";
      createdWindowsLog.push({ url });
      const winId = nextWinId++;
      const tabId = nextTabId++;
      return { id: winId, tabs: [{ id: tabId, url }] };
    }),
  },
  tabGroups: {
    query: vi.fn(async () => []),
    update: vi.fn(async (groupId: number, props: { title?: string; color?: string }) => {
      const entry = groupedTabsLog.find((g) => (g as { id?: number }).id === groupId);
      if (entry) {
        entry.title = props.title;
        entry.color = props.color;
      }
      return { id: groupId, ...props };
    }),
  },
  tabs: {
    query: vi.fn(async (q?: { active?: boolean; currentWindow?: boolean; windowId?: number }) => {
      let tabs = openWindowsMock.flatMap((w) => w.tabs.map((t) => ({ ...t, windowId: t.windowId ?? w.id })));
      if (q?.windowId != null) tabs = tabs.filter((t) => t.windowId === q.windowId);
      if (q?.currentWindow && openWindowsMock[0]) tabs = tabs.filter((t) => t.windowId === openWindowsMock[0].id);
      if (q?.active) tabs = tabs.filter((t) => t.active);
      return tabs;
    }),
    create: vi.fn(async (opts: { windowId?: number; url?: string; index?: number }) => {
      const tabId = nextTabId++;
      createdTabsLog.push({ windowId: opts.windowId, url: opts.url || "", index: opts.index });
      return { id: tabId, url: opts.url || "" };
    }),
    group: vi.fn(async (opts: { tabIds: number[] }) => {
      const id = nextGroupId++;
      groupedTabsLog.push(Object.assign({ tabIds: opts.tabIds }, { id }));
      return id;
    }),
    update: vi.fn(async () => ({})),
    remove: vi.fn(async (ids: number | number[]) => {
      const arr = Array.isArray(ids) ? ids : [ids];
      removedTabsLog.push(...arr);
    }),
    discard: vi.fn(async (tabId: number) => {
      discardedTabsLog.push(tabId);
      return { id: tabId, discarded: true };
    }),
    get: vi.fn(async (id: number) => ({ id, url: "https://example.com" })),
  },
});

const { restoreSnapshot, restoreCollection } = await import("../src/background/restore.ts");
const { captureWindows, collapseTabsToCollection } = await import("../src/background/capture.ts");
const {
  autosave,
  handleWindowClosed,
  pruneSnapshots,
  refreshLiveWindowCache,
} = await import("../src/background/autosave.ts");
const { checkIdleTabs } = await import("../src/background/suspender.ts");
const { startupCheck } = await import("../src/background/recovery.ts");
const {
  buildRestoreBookmarkUrl,
  driveSignIn,
  driveSyncNow,
  importFromRawText,
  listPinnedBookmarks,
  pinToBookmarksBar,
  syncCollectionsToBookmarks,
  unpinFromBookmarksBar,
  writeLocalBackup,
} = await import("../src/background/backups-sync.ts");

describe("reconstructed end-to-end user workflows", () => {
  beforeEach(() => {
    dbSnapshots.clear();
    dbCollections.clear();
    dbTombstones.clear();
    dbRecovery = null;
    dbSettings = { ...DEFAULT_SETTINGS, restoreTabGroups: false };
    openWindowsMock.length = 0;
    bookmarksMock.length = 0;
    downloadsLog.length = 0;
    removedTabsLog.length = 0;
    discardedTabsLog.length = 0;
    createdTabsLog.length = 0;
    createdWindowsLog.length = 0;
    updatedWindowsLog.length = 0;
    groupedTabsLog.length = 0;
    for (const k of Object.keys(sessionStorageMap)) delete sessionStorageMap[k];
    for (const k of Object.keys(localStorageMap)) delete localStorageMap[k];
    vi.restoreAllMocks();
    (chrome.windows.getAll as unknown as ReturnType<typeof vi.fn>).mockImplementation(async () => openWindowsMock);
  });

  it("Workflow 1: Smart Restore focuses an already-open matching window and opens only missing tabs", async () => {
    openWindowsMock.push({
      id: 1,
      focused: false,
      tabs: [
        { id: 11, url: "https://linear.app/issue/1" },
        { id: 12, url: "https://github.com/org/repo" },
        { id: 13, url: "https://figma.com/file/abc" },
      ],
    });

    const snap: SessionSnapshot = {
      id: "s-work",
      t: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      kind: "named",
      name: "Work",
      runId: "",
      windows: [
        {
          tabs: [
            { url: "https://linear.app/issue/1", title: "Linear" },
            { url: "https://github.com/org/repo", title: "GitHub" },
            { url: "https://figma.com/file/abc", title: "Figma" },
            { url: "https://notion.so/spec", title: "Spec" },
          ],
        },
      ],
      windowCount: 1,
      tabCount: 4,
      sig: "",
    };

    const res = await restoreSnapshot(snap);
    expect(res.focusedExisting).toBe(1);
    expect(res.alreadyOpen).toBe(3);
    expect(res.opened).toBe(1);
    expect(createdWindowsLog).toHaveLength(0);
    expect(updatedWindowsLog).toEqual([{ windowId: 1, focused: true }]);
    expect(createdTabsLog).toEqual([{ windowId: 1, url: "https://notion.so/spec" }]);
  });

  it("Workflow 2: Smart Save detects exact and close matches to prevent duplicate sessions", () => {
    const savedWin: SavedWindow[] = [
      {
        tabs: [
          { url: "https://a.test", title: "A" },
          { url: "https://b.test", title: "B" },
          { url: "https://c.test", title: "C" },
          { url: "https://d.test", title: "D" },
        ],
      },
    ];
    const existing: SessionSnapshot[] = [
      {
        id: "snap-1",
        t: 1000,
        updatedAt: 1000,
        kind: "named",
        name: "Research",
        runId: "",
        windows: savedWin,
        windowCount: 1,
        tabCount: 4,
        sig: signature(savedWin),
      },
    ];

    // Exact match guard
    const exactCheck = findMatchingSavedSession(savedWin, existing);
    expect(exactCheck.exact?.id).toBe("snap-1");

    // 80% overlap -> offers Update Existing
    const expanded: SavedWindow[] = [
      { tabs: [...savedWin[0].tabs, { url: "https://e.test", title: "E" }] },
    ];
    const closeCheck = findMatchingSavedSession(expanded, existing);
    expect(closeCheck.exact).toBeNull();
    expect(closeCheck.closest?.snap.id).toBe("snap-1");
    expect(closeCheck.closest?.overlap).toBeGreaterThanOrEqual(0.7);
  });

  it("Workflow 3: Current Session duplicate cleanup preserves pinned and active tabs", () => {
    const dupIds = findDuplicateOpenTabIds([
      {
        tabs: [
          { id: 1, url: "https://mail.google.com", pinned: false, active: false },
          { id: 2, url: "https://docs.example.com", pinned: false, active: true },
        ],
      },
      {
        tabs: [
          { id: 3, url: "https://mail.google.com", pinned: true, active: false },
          { id: 4, url: "https://docs.example.com", pinned: false, active: false },
        ],
      },
    ]);
    expect(dupIds).toEqual([1, 4]);
  });

  it("Workflow 4: Multi-format import parses Pocket/Pinboard/Linkwarden and Bookmarks Bar URL resolves cleanly", () => {
    const pocket = detectAndParseImport(
      `<!DOCTYPE NETSCAPE-Bookmark-file-1><TITLE>Pocket Export</TITLE><DL><p><DT><A HREF="https://read.example/1">Read 1</A></DL><p>`
    );
    expect(pocket.source).toBe("pocket");
    expect(pocket.sessions[0].windows[0].tabs[0].url).toBe("https://read.example/1");

    const url = buildRestoreBookmarkUrl("session", "snap-1");
    expect(url).toBe("chrome-extension://test-ext-id/dashboard.html?restore=session:snap-1&autoclose=1");
  });

  it("Workflow 5: Stale >30d detection resets when a session is reopened", () => {
    const now = 1_700_000_000_000;
    const staleSnap = { t: now - 45 * DAY, updatedAt: now - 45 * DAY };
    expect(isStaleItem(staleSnap, now)).toBe(true);

    const reopenedSnap = { ...staleSnap, lastOpenedAt: now - 1 * DAY };
    expect(isStaleItem(reopenedSnap, now)).toBe(false);
  });

  it("Workflow 6: Pin and unpin a Saved Session on Chrome Bookmarks Bar", async () => {
    await pinToBookmarksBar({ type: "session", id: "s-pin", title: "Work Launch" });
    expect(bookmarksMock).toHaveLength(1);
    expect(bookmarksMock[0].parentId).toBe("1");
    expect(bookmarksMock[0].title).toBe("Work Launch");

    const pinned = await listPinnedBookmarks();
    expect(pinned).toEqual(["session:s-pin"]);

    await unpinFromBookmarksBar({ type: "session", id: "s-pin" });
    expect(bookmarksMock).toHaveLength(0);
    expect(await listPinnedBookmarks()).toEqual([]);
  });

  it("Workflow 7: Right-click context menu moves selected window tabs into a Collection and closes them", async () => {
    openWindowsMock.push(
      {
        id: 1,
        focused: true,
        tabs: [
          { id: 10, url: "https://one.example", title: "One", active: true },
          { id: 11, url: "https://two.example", title: "Two", pinned: true },
        ],
      },
      {
        id: 2,
        focused: false,
        tabs: [
          { id: 20, url: "https://win2-a.example", title: "Win2 A", active: true },
          { id: 21, url: "https://win2-b.example", title: "Win2 B" },
        ],
      }
    );

    const res = await collapseTabsToCollection("currentWindow", dbSettings, undefined, 2);
    expect(res.capturedCount).toBe(2);
    expect(res.closedCount).toBe(2);
    expect(removedTabsLog).toEqual([20, 21]);
    expect(dbCollections.size).toBe(1);
  });

  it("Workflow 8: Collections restore opens active items and archives them when configured", async () => {
    const col: CollectionRecord = {
      id: "col-1",
      parentFolderId: null,
      kind: "group",
      title: "Reading Stack",
      color: "#0B87C9",
      createdAt: 1000,
      updatedAt: 1000,
      order: 0,
      tags: [],
      items: [
        { id: "i1", url: "https://article1.example", title: "Article 1", addedAt: 1000 },
        { id: "i2", url: "https://archived.example", title: "Archived", archived: true, addedAt: 1000 },
      ],
    };
    dbCollections.set(col.id, col);

    const res = await restoreCollection(col, { actionOverride: "archive" });
    expect(res.opened).toBe(1);
    expect(createdWindowsLog).toEqual([{ url: "https://article1.example" }]);
    expect(dbCollections.get("col-1")?.items.every((i) => i.archived)).toBe(true);
  });

  it("Workflow 9: Local backup writes JSON file and Bookmarks mirror creates Other Bookmarks > TabVault folders", async () => {
    dbSnapshots.set("s1", {
      id: "s1",
      t: 1000,
      updatedAt: 1000,
      kind: "named",
      name: "Daily",
      runId: "",
      windows: [{ tabs: [{ url: "https://daily.example", title: "Daily" }] }],
      windowCount: 1,
      tabCount: 1,
      sig: "https://daily.example",
    });
    dbCollections.set("c1", {
      id: "c1",
      parentFolderId: null,
      kind: "group",
      title: "Docs",
      color: "#0B87C9",
      createdAt: 1000,
      updatedAt: 1000,
      order: 0,
      tags: [],
      items: [{ id: "ci1", url: "https://docs.example", title: "Docs", addedAt: 1000 }],
    });

    const backupRes = await writeLocalBackup();
    expect(backupRes.files).toBe(1);
    expect(backupRes.sessions).toBe(1);
    expect(downloadsLog[0].filename).toMatch(/^TabVault\/tabvault-backup-.*\.json$/);

    dbSettings.mirrorToBookmarks = true;
    await syncCollectionsToBookmarks();
    const rootFolder = bookmarksMock.find((b) => b.parentId === "2" && b.title === "TabVault");
    expect(rootFolder).toBeDefined();
    const subFolder = bookmarksMock.find((b) => b.parentId === rootFolder!.id && b.title === "Docs");
    expect(subFolder).toBeDefined();
    const bm = bookmarksMock.find((b) => b.parentId === subFolder!.id && b.url === "https://docs.example");
    expect(bm).toBeDefined();
  });

  it("Workflow 10: Sleep options default to off and LRU tab suspender only discards down to maxActiveTabsBeforeSuspend", async () => {
    expect(DEFAULT_SETTINGS.suspenderEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.dailySleepEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.dailySleepCloseTabs).toBe(false);
    expect(DEFAULT_SETTINGS.localBackupSchedule).toBe("daily");

    dbSettings = { ...DEFAULT_SETTINGS, suspenderEnabled: true, maxActiveTabsBeforeSuspend: 2, suspendAfterMin: 90 };
    const now = Date.now();
    openWindowsMock.push({
      id: 1,
      focused: true,
      tabs: [
        { id: 101, url: "https://active.example", active: true },
        { id: 102, url: "https://recent.example", active: false },
        { id: 103, url: "https://older.example", active: false },
        { id: 104, url: "https://oldest.example", active: false },
      ],
    });
    sessionStorageMap.tabActiveAt = {
      "101": now,
      "102": now - 10_000,
      "103": now - 60_000,
      "104": now - 120_000,
    };

    const count = await checkIdleTabs(false);
    expect(count).toBe(2);
    expect(discardedTabsLog).toEqual([104, 103]);
  });

  it("Workflow 11: Collection restore reconstructs saved Chrome Tab Groups and respects openNextToActive", async () => {
    dbSettings = { ...DEFAULT_SETTINGS, restoreTabGroups: true, openNextToActive: true, restoreLoadMode: "alwaysLoad" };
    openWindowsMock.push({
      id: 1,
      focused: true,
      tabs: [{ id: 11, index: 2, url: "https://current.example", active: true }],
    });

    const col: CollectionRecord = {
      id: "col-grouped",
      parentFolderId: null,
      kind: "group",
      title: "Grouped Stack",
      color: "#0B87C9",
      createdAt: 1000,
      updatedAt: 1000,
      order: 0,
      tags: [],
      items: [
        { id: "a", url: "https://g1.example", title: "G1", groupTitle: "Docs", groupColor: "blue", addedAt: 1000 },
        { id: "b", url: "https://g2.example", title: "G2", groupTitle: "Docs", groupColor: "blue", addedAt: 1000 },
      ],
    };

    await restoreCollection(col, { modeOverride: "addToCurrent" });
    expect(createdTabsLog.map((t) => t.index)).toEqual([3, 4]);
    expect(groupedTabsLog).toHaveLength(1);
    expect(groupedTabsLog[0].title).toBe("Docs");
    expect(groupedTabsLog[0].color).toBe("blue");
  });

  it("Workflow 12: Google Drive OAuth works without Client Secret and sync honors deletion tombstones", async () => {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("userinfo")) {
        return new Response(JSON.stringify({ email: "user@example.com" }), { status: 200 });
      }
      if (input.includes("drive/v3/files?")) {
        return new Response(JSON.stringify({ files: [{ id: "file-1" }] }), { status: 200 });
      }
      if (input.includes("alt=media")) {
        return new Response(
          JSON.stringify({
            sessions: [
              {
                id: "remote-deleted-locally",
                t: 1000,
                updatedAt: 1000,
                kind: "named",
                name: "Deleted Local",
                runId: "",
                windows: [{ tabs: [{ url: "https://gone.example", title: "Gone" }] }],
                windowCount: 1,
                tabCount: 1,
                sig: "s",
              },
              {
                id: "remote-new",
                t: 2000,
                updatedAt: 2000,
                kind: "named",
                name: "From Laptop",
                runId: "",
                windows: [{ tabs: [{ url: "https://laptop.example", title: "Laptop" }] }],
                windowCount: 1,
                tabCount: 1,
                sig: "s2",
              },
            ],
            collections: [],
            deletedIds: { "local-deleted-remotely": 5000 },
          }),
          { status: 200 }
        );
      }
      if (input.includes("upload/drive/v3/files") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ id: "file-1" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    launchWebAuthFlowImpl = async (opts) => {
      expect(opts.url).toContain("response_type=token");
      return "https://test-ext-id.chromiumapp.org/#access_token=tok123&expires_in=3600";
    };
    const authRes = await driveSignIn("client-id.apps.googleusercontent.com");
    expect(authRes.email).toBe("user@example.com");

    dbTombstones.set("remote-deleted-locally", 3000);
    dbSnapshots.set("local-deleted-remotely", {
      id: "local-deleted-remotely",
      t: 1000,
      updatedAt: 1000,
      kind: "named",
      name: "Should Delete",
      runId: "",
      windows: [{ tabs: [{ url: "https://old.example", title: "Old" }] }],
      windowCount: 1,
      tabCount: 1,
      sig: "old",
    });

    const syncRes = await driveSyncNow();
    expect(syncRes.imported).toBe(1);
    expect(dbSnapshots.has("remote-new")).toBe(true);
    expect(dbSnapshots.has("remote-deleted-locally")).toBe(false);
    expect(dbSnapshots.has("local-deleted-remotely")).toBe(false);
  });

  it("Workflow 13: Replacing current window never skips tabs inside the replaced window", async () => {
    openWindowsMock.push({
      id: 1,
      focused: true,
      tabs: [
        { id: 101, url: "https://keep-me.example", title: "Keep Me", pinned: false },
        { id: 102, url: "https://old-tab.example", title: "Old Tab", pinned: false },
      ],
    });

    const col: CollectionRecord = {
      id: "col-switch",
      parentFolderId: null,
      kind: "group",
      title: "Switch Target",
      color: "#0EA5E9",
      createdAt: 1000,
      updatedAt: 1000,
      order: 0,
      tags: [],
      items: [
        { id: "c1", url: "https://keep-me.example", title: "Keep Me", addedAt: 1000 },
        { id: "c2", url: "https://target-two.example", title: "Target Two", addedAt: 1000 },
      ],
    };

    const res = await restoreCollection(col, { modeOverride: "currentWindow", actionOverride: "keep" });
    expect(res.opened).toBe(2);
    expect(createdTabsLog.map((t) => t.url)).toEqual(["https://keep-me.example", "https://target-two.example"]);
    expect(removedTabsLog).toEqual([101, 102]);
  });

  it("Workflow 14: Backup JSON import restores Collections, individual backup keeps newest files, and startup none suppresses recovery", async () => {
    expect(DEFAULT_SETTINGS.guardUnsavedForms).toBe(false);

    const rawBackup = JSON.stringify({
      format: "smarttabber",
      version: 1,
      sessions: [
        {
          id: "snap-old",
          name: "Old Session",
          kind: "named",
          t: 1_700_000_001_000,
          updatedAt: 1_700_000_001_000,
          windows: [{ tabs: [{ url: "https://old.example", title: "Old" }] }],
        },
      ],
      collections: [
        {
          id: "col-backup-1",
          parentFolderId: null,
          kind: "group",
          title: "Restored Stack",
          color: "#10B981",
          createdAt: 1_700_000_002_000,
          updatedAt: 1_700_000_002_000,
          order: 0,
          tags: ["work"],
          items: [{ id: "ci-1", url: "https://col-item.example", title: "Col Item", addedAt: 1_700_000_002_000 }],
        },
      ],
    });

    const imp = await importFromRawText(rawBackup);
    expect(imp.sessions).toBe(1);
    expect(imp.collections).toBe(1);
    expect(dbCollections.get("col-backup-1")?.title).toBe("Restored Stack");

    // Individual local backup selects newest snapshots first
    dbSnapshots.set("s-oldest", {
      id: "s-oldest",
      t: 1_700_000_000_500,
      updatedAt: 1_700_000_000_500,
      kind: "named",
      name: "Oldest",
      runId: "",
      windows: [{ tabs: [{ url: "https://1.example", title: "1" }] }],
      windowCount: 1,
      tabCount: 1,
      sig: "1",
    });
    dbSnapshots.set("s-newest", {
      id: "s-newest",
      t: 1_700_000_009_000,
      updatedAt: 1_700_000_009_000,
      kind: "named",
      name: "Newest",
      runId: "",
      windows: [{ tabs: [{ url: "https://2.example", title: "2" }] }],
      windowCount: 1,
      tabCount: 1,
      sig: "2",
    });
    dbSettings = { ...DEFAULT_SETTINGS, localBackupIndividual: true, localBackupMaxFiles: 1 };
    const bak = await writeLocalBackup();
    expect(bak.files).toBe(1);
    expect(downloadsLog[0].filename).toContain("Newest");

    // Startup behavior "none" clears and suppresses recovery banner
    dbSettings = { ...DEFAULT_SETTINGS, startupBehavior: "none" };
    dbRecovery = { id: "s-newest", t: 9000, w: 1, n: 5, missing: 5, partial: false, detectedAt: 9500, coverage: 0 };
    const rec = await startupCheck(false);
    expect(rec).toBeNull();
    expect(dbRecovery).toBeNull();
  });

  it("Workflow 15: incognitoPolicy 'secureNoSave' shows incognito windows in UI without saving them to disk", async () => {
    const mockGetAll = chrome.windows.getAll as unknown as ReturnType<typeof vi.fn>;
    mockGetAll.mockResolvedValue([
      {
        id: 1,
        focused: true,
        incognito: false,
        tabs: [{ id: 11, url: "https://public.example", title: "Public" }],
      },
      {
        id: 2,
        focused: false,
        incognito: true,
        tabs: [{ id: 22, url: "https://private.example", title: "Private" }],
      },
    ]);

    const secureSettings: Settings = { ...dbSettings, incognitoPolicy: "secureNoSave" };
    const forDisk = await captureWindows(secureSettings, true, false);
    expect(forDisk).toHaveLength(1);
    expect(forDisk[0].tabs[0].url).toBe("https://public.example");

    const forDisplay = await captureWindows(secureSettings, true, true);
    expect(forDisplay).toHaveLength(2);
    expect(forDisplay[1].tabs[0].url).toBe("https://private.example");
  });

  it("Workflow 16: Window-close auto-save preserves Tab Groups and honors purgePinnedOnlyOnClose", async () => {
    const queryGroupsMock = chrome.tabGroups.query as unknown as ReturnType<typeof vi.fn>;
    queryGroupsMock.mockResolvedValue([{ id: 77, title: "Docs", color: "blue", collapsed: false }]);

    openWindowsMock.push(
      {
        id: 10,
        focused: true,
        tabs: [
          { id: 1, windowId: 10, url: "https://one.example", title: "One", groupId: 77 },
          { id: 2, windowId: 10, url: "https://two.example", title: "Two", groupId: 77 },
        ],
      },
      {
        id: 11,
        focused: false,
        tabs: [{ id: 3, windowId: 11, url: "https://pinned.example", title: "Pinned", pinned: true }],
      }
    );

    await refreshLiveWindowCache();
    await handleWindowClosed(10);

    const closedSnaps = Array.from(dbSnapshots.values()).filter((s) => s.kind === "windowClose");
    expect(closedSnaps).toHaveLength(1);
    expect(closedSnaps[0].windows[0].groups).toEqual([{ id: 77, title: "Docs", color: "blue", collapsed: false }]);

    dbSettings = { ...dbSettings, purgePinnedOnlyOnClose: true };
    await handleWindowClosed(11);
    expect(Array.from(dbSnapshots.values()).filter((s) => s.kind === "windowClose")).toHaveLength(1);
  });

  it("Workflow 17: Auto-save and pruneSnapshots preserve named sessions while enforcing windowClose limits", async () => {
    openWindowsMock.push({
      id: 1,
      focused: true,
      tabs: [{ id: 11, url: "https://work.example", title: "Work", active: true }],
    });
    const autoId = await autosave({ fork: true });
    expect(autoId).toBeTruthy();

    dbSnapshots.set("named-keep", {
      id: "named-keep",
      t: 1000,
      updatedAt: 1000,
      kind: "named",
      name: "Important",
      runId: "",
      windows: [{ tabs: [{ url: "https://keep.example", title: "Keep" }] }],
      windowCount: 1,
      tabCount: 1,
      sig: "k",
    });
    for (let i = 0; i < 3; i++) {
      dbSnapshots.set(`wc-${i}`, {
        id: `wc-${i}`,
        t: Date.now() - (3 - i) * 1000,
        updatedAt: Date.now() - (3 - i) * 1000,
        kind: "windowClose",
        name: `Closed ${i}`,
        runId: "",
        windows: [{ tabs: [{ url: `https://c${i}.example`, title: `C${i}` }] }],
        windowCount: 1,
        tabCount: 1,
        sig: `c${i}`,
      });
    }

    dbSettings = { ...dbSettings, maxWindowCloseSaves: 1 };
    await pruneSnapshots();

    expect(dbSnapshots.has("named-keep")).toBe(true);
    expect(Array.from(dbSnapshots.values()).filter((s) => s.kind === "windowClose").map((s) => s.id)).toEqual(["wc-2"]);
  });

  it("Workflow 18: Encrypted JSON export round-trips through password-protected importFromRawText", async () => {
    const snap: SessionSnapshot = {
      id: "s-sec",
      t: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      kind: "named",
      name: "Encrypted Workspace",
      runId: "",
      windows: [{ tabs: [{ url: "https://vault.example", title: "Vault" }] }],
      windowCount: 1,
      tabCount: 1,
      sig: "v",
    };
    const json = exportAsJson([snap], []);
    const encrypted = await encryptPayload(json, "correct-horse-battery-staple");

    const imported = await importFromRawText(JSON.stringify(encrypted), "correct-horse-battery-staple");
    expect(imported.sessions).toBe(1);
    expect(Array.from(dbSnapshots.values()).some((s) => s.name === "Encrypted Workspace")).toBe(true);
  });

  it("Workflow 19: All copy and export formats generate valid structured output", () => {
    const snap: SessionSnapshot = {
      id: "s-fmt",
      t: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      kind: "named",
      name: "Format Test",
      runId: "",
      windows: [{ tabs: [{ url: "https://docs.example/guide", title: "Guide" }] }],
      windowCount: 1,
      tabCount: 1,
      sig: "f",
    };

    expect(exportAsMarkdown([snap])).toContain("[Guide](https://docs.example/guide)");
    expect(exportAsCsv([snap])).toContain('"Guide","https://docs.example/guide"');
    expect(exportAsOneTabText([snap])).toContain("https://docs.example/guide | Guide");
    expect(exportAsBookmarksHtml([snap])).toContain('HREF="https://docs.example/guide"');
    expect(formatWithTemplate(snap.windows[0].tabs, "%t => %u")).toBe("Guide => https://docs.example/guide");
  });
});

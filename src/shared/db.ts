import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DEFAULT_SETTINGS } from "./defaults.ts";
import { metaOf } from "./core.ts";
import type {
  CollectionRecord,
  RecoveryState,
  SessionSnapshot,
  Settings,
  SnapshotMeta,
} from "./types.ts";

interface TabVaultDB extends DBSchema {
  snapshots: {
    key: string;
    value: SessionSnapshot;
    indexes: { "by-t": number; "by-kind": string; "by-runId": string };
  };
  collections: {
    key: string;
    value: CollectionRecord;
    indexes: { "by-parent": string; "by-updated": number };
  };
  syncMeta: {
    key: string;
    value: {
      id: string;
      localId: string;
      driveFileId?: string;
      remoteUpdatedAt?: number;
      deletedAt?: number;
      dirty?: boolean;
    };
  };
  suspendedTabs: {
    key: number;
    value: { tabId: number; url: string; title: string; favIconUrl?: string; suspendedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<TabVaultDB>> | null = null;
let shadowDbPromise: Promise<IDBPDatabase<TabVaultDB>> | null = null;

function openTabVaultStore(name: string): Promise<IDBPDatabase<TabVaultDB>> {
  return openDB<TabVaultDB>(name, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("snapshots")) {
        const snapStore = db.createObjectStore("snapshots", { keyPath: "id" });
        snapStore.createIndex("by-t", "t");
        snapStore.createIndex("by-kind", "kind");
        snapStore.createIndex("by-runId", "runId");
      }
      if (!db.objectStoreNames.contains("collections")) {
        const colStore = db.createObjectStore("collections", { keyPath: "id" });
        colStore.createIndex("by-parent", "parentFolderId");
        colStore.createIndex("by-updated", "updatedAt");
      }
      if (!db.objectStoreNames.contains("syncMeta")) {
        db.createObjectStore("syncMeta", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("suspendedTabs")) {
        db.createObjectStore("suspendedTabs", { keyPath: "tabId" });
      }
    },
  });
}

export function getDB(): Promise<IDBPDatabase<TabVaultDB>> {
  if (!dbPromise) {
    dbPromise = openTabVaultStore("tabvault");
  }
  return dbPromise;
}

function getShadowDB(): Promise<IDBPDatabase<TabVaultDB>> {
  if (!shadowDbPromise) {
    shadowDbPromise = openTabVaultStore("tabvault_shadow");
  }
  return shadowDbPromise;
}

async function mirrorToShadow(fn: (db: IDBPDatabase<TabVaultDB>) => Promise<void>): Promise<void> {
  try {
    const shadow = await getShadowDB();
    await fn(shadow);
  } catch {
    /* shadow mirror is best-effort */
  }
}

// Fast-boot chrome.storage.local helpers
const S = () => chrome.storage.local;

export interface LivePointer {
  id: string;
  sig: string;
  runId: string;
  created: number;
  w: number;
  n: number;
}

const ALLOWED_HISTORY_DAYS = new Set(["30", "90", "365", "forever"]);
const ALLOWED_STARTUP = new Set([
  "recoveryBanner",
  "restorePrevious",
  "openStartupSessions",
  "openDashboard",
  "ask",
  "none",
]);
const ALLOWED_OPEN_MODE = new Set(["newWindow", "currentWindow", "addToCurrent"]);
const ALLOWED_RESTORE_LIST_ACTION = new Set(["keep", "remove", "archive"]);
const ALLOWED_URL_CLICK = new Set(["ask", "closed", "focused"]);
const ALLOWED_LOAD_MODE = new Set(["lazyDiscard", "alwaysLoad", "suspendPage", "lastState"]);
const ALLOWED_SUSPEND_BACKEND = new Set(["nativeDiscard", "suspendPage"]);
const ALLOWED_TOOLBAR_ACTION = new Set([
  "openSidePanel",
  "openDashboard",
  "openPopup",
  "sendCurrentWindow",
  "sendCurrentTab",
  "sendAllWindows",
]);
const ALLOWED_PINNED_POLICY = new Set(["ignore", "allow"]);
const ALLOWED_DUPLICATE_POLICY = new Set(["allow", "reject", "keepTitle", "updateTitle"]);
const ALLOWED_GROUP_COLORS = new Set([
  "random",
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);
const ALLOWED_INCOGNITO = new Set(["exclude", "include", "secureNoSave"]);
const ALLOWED_THEMES = new Set(["system", "light", "dark"]);
const ALLOWED_UI_DENSITY = new Set(["dense", "compact", "normal", "expanded"]);
const ALLOWED_URL_DISPLAY = new Set(["domain", "abbreviated", "full", "none"]);
const ALLOWED_TIMESTAMP_MODE = new Set(["relative", "absolute"]);
const ALLOWED_COPY_FORMATS = new Set(["titleAndUrl", "markdown", "json", "csv", "html", "onetab"]);
const ALLOWED_BACKUP_SCHEDULE = new Set(["off", "startup", "hourly", "daily", "weekly"]);

const ENUM_SETS: Partial<Record<keyof Settings, Set<string>>> = {
  historyDays: ALLOWED_HISTORY_DAYS,
  startupBehavior: ALLOWED_STARTUP,
  defaultOpenMode: ALLOWED_OPEN_MODE,
  restoreListAction: ALLOWED_RESTORE_LIST_ACTION,
  urlClickInClosedSession: ALLOWED_URL_CLICK,
  restoreLoadMode: ALLOWED_LOAD_MODE,
  suspendBackend: ALLOWED_SUSPEND_BACKEND,
  toolbarClickAction: ALLOWED_TOOLBAR_ACTION,
  capturePinnedPolicy: ALLOWED_PINNED_POLICY,
  duplicatePolicy: ALLOWED_DUPLICATE_POLICY,
  autoTabGroupColor: ALLOWED_GROUP_COLORS,
  incognitoPolicy: ALLOWED_INCOGNITO,
  theme: ALLOWED_THEMES,
  uiDensity: ALLOWED_UI_DENSITY,
  urlDisplayMode: ALLOWED_URL_DISPLAY,
  timestampMode: ALLOWED_TIMESTAMP_MODE,
  localBackupSchedule: ALLOWED_BACKUP_SCHEDULE,
};

/** Validates and strips unknown keys or malformed value types from a Settings patch. */
export function sanitizeSettingsPatch(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: Partial<Settings> = {};
  const mutable = out as Record<string, unknown>;

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    const val = input[key];
    const def = DEFAULT_SETTINGS[key];

    if (key === "maxAutoSnapshots") {
      if (val === null || val === 60 || val === 200 || val === 500 || val === 1000) {
        out.maxAutoSnapshots = val;
      }
      continue;
    }

    if (key === "ignoreUrlPatterns" || key === "suspendWhitelist") {
      if (Array.isArray(val)) {
        mutable[key] = val.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
      }
      continue;
    }

    if (key === "enabledCopyFormats") {
      if (Array.isArray(val)) {
        out.enabledCopyFormats = val.filter(
          (x): x is Settings["enabledCopyFormats"][number] =>
            typeof x === "string" && ALLOWED_COPY_FORMATS.has(x)
        );
      }
      continue;
    }

    if (key === "customCopyTemplates") {
      if (Array.isArray(val)) {
        out.customCopyTemplates = val
          .filter(
            (x): x is { name: string; format: string } =>
              Boolean(x) &&
              typeof x === "object" &&
              typeof (x as { name?: unknown }).name === "string" &&
              typeof (x as { format?: unknown }).format === "string"
          )
          .map((x) => ({ name: x.name.slice(0, 80), format: x.format.slice(0, 240) }));
      }
      continue;
    }

    if (key === "bypassConfirm") {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const bp = val as Record<string, unknown>;
        const cleanBp: Partial<Settings["bypassConfirm"]> = {};
        for (const k of Object.keys(DEFAULT_SETTINGS.bypassConfirm) as Array<keyof Settings["bypassConfirm"]>) {
          if (Object.prototype.hasOwnProperty.call(bp, k) && typeof bp[k] === "boolean") {
            cleanBp[k] = bp[k] as boolean;
          }
        }
        if (Object.keys(cleanBp).length > 0) {
          out.bypassConfirm = cleanBp as Settings["bypassConfirm"];
        }
      }
      continue;
    }

    const enumSet = ENUM_SETS[key];
    if (enumSet) {
      if (typeof val === "string" && enumSet.has(val)) {
        mutable[key] = val;
      }
      continue;
    }

    if (typeof def === "boolean" && typeof val === "boolean") {
      mutable[key] = val;
    } else if (typeof def === "number" && typeof val === "number" && Number.isFinite(val)) {
      mutable[key] = val;
    } else if (typeof def === "string" && typeof val === "string") {
      mutable[key] = val;
    }
  }

  return out;
}

export async function getSettings(): Promise<Settings> {
  const res = await S().get("settings");
  const stored = sanitizeSettingsPatch(res.settings);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    bypassConfirm: { ...DEFAULT_SETTINGS.bypassConfirm, ...(stored.bypassConfirm || {}) },
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const cleanPatch = sanitizeSettingsPatch(patch);
  const next: Settings = {
    ...current,
    ...cleanPatch,
    bypassConfirm: { ...current.bypassConfirm, ...(cleanPatch.bypassConfirm || {}) },
  };
  next.autoSaveIntervalMin = Math.min(60, Math.max(0.5, Number(next.autoSaveIntervalMin) || 5));
  next.shrinkForkPct = Math.min(95, Math.max(0, Number(next.shrinkForkPct) || 0));
  next.startupCheckSec = Math.min(60, Math.max(3, Number(next.startupCheckSec) || 15));
  next.popupWidth = Math.min(800, Math.max(340, Number(next.popupWidth) || 400));
  next.popupHeight = Math.min(650, Math.max(400, Number(next.popupHeight) || 560));
  await S().set({ settings: next });
  return next;
}

let idxChain: Promise<unknown> = Promise.resolve();
function withIdxLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = idxChain.then(fn, fn);
  idxChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function getMetaIndex(): Promise<SnapshotMeta[]> {
  const res = await S().get("idx");
  if (Array.isArray(res.idx)) return res.idx as SnapshotMeta[];
  const all = await getAllSnapshots();
  const metas = all.map(metaOf);
  await S().set({ idx: metas });
  return metas;
}

export async function setMetaIndex(idx: SnapshotMeta[]): Promise<void> {
  await S().set({ idx });
}

function emitUiUpdated(): void {
  if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
    void chrome.runtime.sendMessage({ type: "tabvault:updated" }).catch(() => {});
  }
}

export async function putSnapshot(snap: SessionSnapshot): Promise<SnapshotMeta> {
  const db = await getDB();
  await db.put("snapshots", snap);
  void mirrorToShadow(async (s) => {
    await s.put("snapshots", snap);
  });
  const meta = metaOf(snap);
  await withIdxLock(async () => {
    const idx = (await getMetaIndex()).filter((m) => m.id !== snap.id);
    idx.push(meta);
    await setMetaIndex(idx);
  });
  emitUiUpdated();
  return meta;
}

export async function getSnapshot(id: string): Promise<SessionSnapshot | null> {
  try {
    const db = await getDB();
    return (await db.get("snapshots", id)) || null;
  } catch {
    try {
      const shadow = await getShadowDB();
      return (await shadow.get("snapshots", id)) || null;
    } catch {
      return null;
    }
  }
}

export async function getAllSnapshots(): Promise<SessionSnapshot[]> {
  try {
    const db = await getDB();
    return await db.getAll("snapshots");
  } catch {
    try {
      const shadow = await getShadowDB();
      return await shadow.getAll("snapshots");
    } catch {
      return [];
    }
  }
}

export async function deleteSnapshots(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDB();
  const tx = db.transaction("snapshots", "readwrite");
  for (const id of ids) {
    await tx.store.delete(id);
  }
  await tx.done;
  void mirrorToShadow(async (s) => {
    const stx = s.transaction("snapshots", "readwrite");
    for (const id of ids) await stx.store.delete(id);
    await stx.done;
  });
  const drop = new Set(ids);
  await withIdxLock(async () => {
    const idx = (await getMetaIndex()).filter((m) => !drop.has(m.id));
    await setMetaIndex(idx);
  });
  emitUiUpdated();
}

// Collections CRUD
export async function getAllCollections(): Promise<CollectionRecord[]> {
  let all: CollectionRecord[] = [];
  try {
    const db = await getDB();
    all = await db.getAll("collections");
  } catch {
    try {
      const shadow = await getShadowDB();
      all = await shadow.getAll("collections");
    } catch {
      all = [];
    }
  }
  return all.sort((a, b) => a.order - b.order || b.updatedAt - a.updatedAt);
}

export async function getCollection(id: string): Promise<CollectionRecord | null> {
  try {
    const db = await getDB();
    return (await db.get("collections", id)) || null;
  } catch {
    try {
      const shadow = await getShadowDB();
      return (await shadow.get("collections", id)) || null;
    } catch {
      return null;
    }
  }
}

export async function putCollection(col: CollectionRecord): Promise<CollectionRecord> {
  const db = await getDB();
  await db.put("collections", col);
  void mirrorToShadow(async (s) => {
    await s.put("collections", col);
  });
  emitUiUpdated();
  return col;
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("collections", id);
  void mirrorToShadow(async (s) => {
    await s.delete("collections", id);
  });
  emitUiUpdated();
}

export async function getSyncTombstones(): Promise<Record<string, number>> {
  try {
    const db = await getDB();
    const all = await db.getAll("syncMeta");
    const out: Record<string, number> = {};
    for (const row of all) {
      if (row.deletedAt) out[row.localId] = row.deletedAt;
    }
    return out;
  } catch {
    return {};
  }
}

export async function recordSyncTombstones(ids: string[], deletedAt = Date.now()): Promise<void> {
  if (!ids.length) return;
  try {
    const db = await getDB();
    const tx = db.transaction("syncMeta", "readwrite");
    for (const id of ids) {
      await tx.store.put({ id, localId: id, deletedAt, dirty: true });
    }
    await tx.done;
  } catch {
    /* sync tombstone recording is best-effort */
  }
}

export async function clearSyncTombstones(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const db = await getDB();
    const tx = db.transaction("syncMeta", "readwrite");
    for (const id of ids) {
      await tx.store.delete(id);
    }
    await tx.done;
  } catch {
    /* best-effort */
  }
}

// Recovery & fast state
export async function getRecovery(): Promise<RecoveryState | null> {
  return ((await S().get("recovery")).recovery as RecoveryState | undefined) || null;
}

export async function setRecovery(recovery: RecoveryState | null): Promise<void> {
  if (!recovery) await S().remove("recovery");
  else await S().set({ recovery });
}

export async function getLivePointer(): Promise<LivePointer | null> {
  return ((await S().get("live")).live as LivePointer | undefined) || null;
}

export async function setLivePointer(live: LivePointer, lastSaveAt: number): Promise<void> {
  await S().set({ live, lastSaveAt });
}

export async function getBootMetrics() {
  return S().get([
    "lastSaveAt",
    "lastBackupAt",
    "lastBackupError",
    "lastSyncAt",
    "lastSyncError",
    "driveToken",
    "driveEmail",
  ]);
}

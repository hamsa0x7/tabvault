import type {
  AppStateSummary,
  CollapseScope,
  CollectionRecord,
  RecoveryState,
  SavedWindow,
  SearchHit,
  SessionSnapshot,
  Settings,
  SnapshotMeta,
} from "./types.ts";

export interface RpcMap {
  state: { req: undefined; res: AppStateSummary };
  listSnapshots: { req: undefined; res: SnapshotMeta[] };
  getSnapshot: { req: { id: string }; res: SessionSnapshot | null };
  getOpenWindows: { req: undefined; res: SavedWindow[] };
  checkSaveMatch: {
    req?: { windowId?: number };
    res: { exact: SnapshotMeta | null; closest: { meta: SnapshotMeta; overlap: number } | null };
  };
  saveNamed: {
    req: { name?: string; tags?: string[]; startupRegistered?: boolean; windowId?: number; replaceId?: string };
    res: SnapshotMeta;
  };
  promoteSnapshot: { req: { id: string; name?: string }; res: SnapshotMeta };
  updateSnapshot: { req: { id: string; patch: Partial<SessionSnapshot> }; res: SessionSnapshot };
  deduplicateSnapshot: { req: { id: string }; res: { removed: number; tabCount: number } };
  deleteSnapshots: { req: { ids: string[] }; res: boolean };
  mergeSnapshots: { req: { ids: string[]; name?: string }; res: SnapshotMeta };
  restoreSnapshot: {
    req: {
      id: string;
      windowIndex?: number | null;
      skipOpen?: boolean;
      allowDuplicates?: boolean;
      modeOverride?: Settings["defaultOpenMode"];
    };
    res: { opened: number; windows: number; alreadyOpen: number; focusedExisting?: number };
  };
  dedupeOpenTabs: { req: undefined; res: { closed: number } };
  groupWindowByDomain: { req?: { windowId?: number }; res: { grouped: number; groupCount: number; ungrouped?: number } };
  focusOpenTab: { req: { windowId?: number; url: string; tabId?: number }; res: boolean };
  closeOpenTab: { req: { windowId?: number; url: string; tabId?: number }; res: boolean };
  pinToBookmarksBar: { req: { type: "session" | "collection"; id: string; title: string }; res: unknown };
  unpinFromBookmarksBar: { req: { type: "session" | "collection"; id: string }; res: unknown };
  listPinnedBookmarks: { req: undefined; res: unknown };
  dismissRecovery: { req: undefined; res: boolean };
  checkRecoveryNow: { req: undefined; res: RecoveryState | null };
  collapse: {
    req: { scope: CollapseScope; targetCollectionId?: string; windowId?: number; closeTabs?: boolean };
    res: { capturedCount: number; closedCount: number; collectionId?: string };
  };
  listCollections: { req: undefined; res: CollectionRecord[] };
  saveCollection: { req: { col: CollectionRecord }; res: CollectionRecord };
  createCollection: { req: Partial<CollectionRecord>; res: CollectionRecord };
  addTabsToCollection: {
    req: {
      collectionId?: string;
      title?: string;
      tabs: Array<{ url: string; title?: string; favIconUrl?: string; pinned?: boolean }>;
    };
    res: { collection: CollectionRecord; added: number };
  };
  deleteCollection: { req: { id: string }; res: boolean };
  restoreCollection: {
    req: { id: string; actionOverride?: Settings["restoreListAction"]; modeOverride?: Settings["defaultOpenMode"] };
    res: { opened: number };
  };
  saveWindowAsSpace: { req?: { title?: string; windowId?: number }; res: CollectionRecord };
  switchSpace: { req: { collectionId: string }; res: { opened: number } };
  searchAll: { req: { q: string }; res: SearchHit[] };
  sleepIdleNow: { req: undefined; res: { count: number } };
  openUrl: { req: { url: string; active?: boolean }; res: boolean };
  exportData: {
    req: { format: "json" | "html" | "csv" | "markdown" | "onetab"; ids?: string[]; collectionIds?: string[] };
    res: string;
  };
  importData: { req: { text: string; password?: string }; res: unknown };
  setSettings: { req: { patch: Partial<Settings> }; res: Settings };
  backupNow: { req: undefined; res: { files: number; sessions: number } };
  listLocalBackups: {
    req: undefined;
    res: {
      granted: boolean;
      files: Array<{ id: number; filename: string; shortName: string; fileSize: number; startTime: string }>;
    };
  };
  showLocalBackup: { req: { id: number }; res: boolean };
  deleteLocalBackup: { req: { id: number }; res: boolean };
  driveSignIn: { req: { clientId: string; clientSecret?: string }; res: { email: string } };
  driveSignOut: { req: undefined; res: boolean };
  driveSyncNow: { req?: { password?: string }; res: { uploaded: number; imported: number } };
  checkForUpdates: { req?: undefined; res: import("./types").UpdateCheckResult };
  applyPendingUpdate: { req?: undefined; res: { ok: boolean } };
  getDriveBackupInfo: {
    req: undefined;
    res: { exists: boolean; id?: string; name?: string; size?: number; modifiedTime?: string };
  };
  downloadDriveBackup: { req: undefined; res: string };
  deleteDriveBackup: { req: undefined; res: boolean };
  openSidePanel: { req: undefined; res: boolean };
  storageStats: { req: undefined; res: { extensionLocalBytes: number | null; indexedDbBytes: number | null } };
  compressAllFavicons: { req: undefined; res: { updatedSnapshots: number; updatedCollections: number } };
  importReadingList: { req: undefined; res: { imported: number; collectionId: string | null } };
  listRecentlyClosed: {
    req: undefined;
    res: {
      granted: boolean;
      items: Array<{
        sessionId: string;
        lastModified: number;
        isWindow: boolean;
        title: string;
        url: string;
        tabCount: number;
      }>;
    };
  };
  restoreRecentlyClosed: { req: { sessionId: string }; res: { ok: boolean } };
}

export type RpcHandlerMap = {
  [K in keyof RpcMap]: RpcMap[K]["req"] extends undefined
    ? () => Promise<RpcMap[K]["res"]>
    : undefined extends RpcMap[K]["req"]
      ? (msg?: NonNullable<RpcMap[K]["req"]>) => Promise<RpcMap[K]["res"]>
      : (msg: RpcMap[K]["req"]) => Promise<RpcMap[K]["res"]>;
};

export function sendBg<K extends keyof RpcMap>(
  cmd: K,
  ...args: RpcMap[K]["req"] extends undefined
    ? [payload?: Record<string, never>]
    : undefined extends RpcMap[K]["req"]
      ? [payload?: NonNullable<RpcMap[K]["req"]>]
      : [payload: RpcMap[K]["req"]]
): Promise<RpcMap[K]["res"]>;
export function sendBg<T>(cmd: keyof RpcMap, payload?: Record<string, unknown>): Promise<T>;
export async function sendBg<T = unknown>(cmd: keyof RpcMap, payload: Record<string, unknown> = {}): Promise<T> {
  const res = (await chrome.runtime.sendMessage({ cmd, ...payload })) as
    | { ok: true; r: T }
    | { ok: false; error: string }
    | undefined;
  if (!res) throw new Error("TabVault's background service didn't respond. Try again or reload the extension.");
  if (!res.ok) throw new Error(res.error || "Something went wrong. Please try again.");
  return res.r;
}

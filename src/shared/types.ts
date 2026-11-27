export type TabGroupColor =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan"
  | "orange";

export interface SavedTabGroup {
  id: number;
  title: string;
  color: TabGroupColor;
  collapsed: boolean;
}

export interface SavedTab {
  id?: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned?: boolean;
  active?: boolean;
  groupKey?: number;
  discarded?: boolean;
}

export interface SavedWindow {
  id?: number;
  state?: "normal" | "minimized" | "maximized" | "fullscreen" | "locked-fullscreen";
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  focused?: boolean;
  title?: string;
  groups?: SavedTabGroup[];
  tabs: SavedTab[];
}

export type SnapshotKind = "auto" | "windowClose" | "browserExit" | "named" | "imported";

export interface SessionSnapshot {
  id: string;
  t: number;
  updatedAt: number;
  lastOpenedAt?: number;
  kind: SnapshotKind;
  name: string;
  runId: string;
  src?: string;
  deviceName?: string;
  tags?: string[];
  startupRegistered?: boolean;
  windows: SavedWindow[];
  windowCount: number;
  tabCount: number;
  sig: string;
}

export interface SnapshotMeta {
  id: string;
  t: number;
  updatedAt: number;
  lastOpenedAt?: number;
  kind: SnapshotKind;
  name: string;
  runId: string;
  src?: string;
  deviceName?: string;
  tags?: string[];
  startupRegistered?: boolean;
  w: number;
  n: number;
}

export interface CollectionItem {
  id: string;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned?: boolean;
  groupTitle?: string;
  groupColor?: TabGroupColor;
  notes?: string;
  starred?: boolean;
  isTask?: boolean;
  taskDone?: boolean;
  archived?: boolean;
  addedAt: number;
}

export interface CollectionRecord {
  id: string;
  parentFolderId: string | null;
  kind: "folder" | "group";
  title: string;
  color: string;
  notes?: string;
  starred?: boolean;
  locked?: boolean;
  archived?: boolean;
  trackingWindowId?: number | null;
  startupRegistered?: boolean;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
  order: number;
  tags: string[];
  items: CollectionItem[];
}

export interface RecoveryState {
  id: string;
  t: number;
  w: number;
  n: number;
  missing: number;
  partial: boolean;
  detectedAt: number;
  coverage: number;
}

export interface CopyTemplate {
  name: string;
  format: string;
}

export type ContextMenuItemId =
  | "saveSnapshot"
  | "sendTab"
  | "sendExceptThis"
  | "sendLeft"
  | "sendRight"
  | "sendGroup"
  | "sendWindow"
  | "excludeDomain"
  | "sendTabPrev"
  | "sendWinPrev"
  | "openDashboard"
  | "openSidePanel"
  | "sendAllWindows"
  | "nukeAll"
  | "suspendTab"
  | "sleepIdle"
  | "groupByDomain"
  | "dedupeTabs"
  | "saveLink"
  | "openSettings";

export interface Settings {
  // Auto-Save & Triggers
  autoSaveEnabled: boolean;
  autoSaveIntervalMin: number;
  debounceMs: number;
  shrinkForkPct: number;
  autoSaveOnWindowClose: boolean;
  minTabsOnWindowClose: number;
  maxWindowCloseSaves: number;
  autoSaveOnBrowserExit: boolean;
  maxBrowserExitSaves: number;
  useTabTitleForAutoSave: boolean;

  // Retention & Pruning
  historyDays: "30" | "90" | "365" | "forever";
  maxAutoSnapshots: 60 | 200 | 500 | 1000 | null;
  thinAfter2hHourly: boolean;
  thinAfter48hDaily: boolean;
  purgeUnnamedClosedDays: number;
  purgeEmptyOnClose: boolean;
  purgePinnedOnlyOnClose: boolean;

  // Crash & Startup
  startupBehavior:
    | "recoveryBanner"
    | "restorePrevious"
    | "openStartupSessions"
    | "openDashboard"
    | "ask"
    | "none";
  startupCheckSec: number;
  recoveryCoverageThreshold: number;
  recoveryMissingMin: number;
  showBadgeAlert: boolean;

  // Restore & Tab Placement
  defaultOpenMode: "newWindow" | "currentWindow" | "addToCurrent";
  restoreWindowBounds: boolean;
  restoreTabGroups: boolean;
  keepPinnedInCurrentWindow: boolean;
  skipAlreadyOpenOnCrashRestore: boolean;
  warnOnOpenTabCount: number;
  openNextToActive: boolean;
  switchToOpenedTab: boolean;
  restoreListAction: "keep" | "remove" | "archive";
  urlClickInClosedSession: "ask" | "closed" | "focused";

  // Lazy Load & Suspender
  restoreLoadMode: "lazyDiscard" | "alwaysLoad" | "suspendPage" | "lastState";
  optimizedOpenThreshold: number;
  suspenderEnabled: boolean;
  suspendAfterMin: number;
  maxActiveTabsBeforeSuspend: number;
  autoReloadOnFocus: boolean;
  suspendBackend: "nativeDiscard" | "suspendPage";
  guardActiveTab: boolean;
  guardAudibleTabs: boolean;
  guardPinnedTabs: boolean;
  guardUnsavedForms: boolean;
  suspendWhitelist: string[];

  // Capture & Tab Groups
  toolbarClickAction: "openSidePanel" | "openDashboard" | "openPopup" | "sendCurrentWindow" | "sendCurrentTab" | "sendAllWindows";
  closeTabsAfterCapture: boolean;
  capturePinnedPolicy: "ignore" | "allow";
  duplicatePolicy: "allow" | "reject" | "keepTitle" | "updateTitle";
  includeTabGroupsOnCapture: boolean;
  autoTabGroupByDomain: boolean;
  autoTabUngroupSingle: boolean;
  autoTabGroupColor: "random" | TabGroupColor;
  dailySleepEnabled: boolean;
  dailySleepTime: string;
  dailySleepCloseTabs: boolean;
  trackNewWindowsInTrackedCollection: boolean;

  // Filtering & Privacy
  ignoreUrlPatterns: string[];
  ignoreNewTabs: boolean;
  ignoreBrowserFeatureTabs: boolean;
  incognitoPolicy: "exclude" | "include" | "secureNoSave";
  compressFavicons: boolean;

  // Interface & Confirmations
  theme: "system" | "light" | "dark";
  uiDensity: "dense" | "compact" | "normal" | "expanded";
  popupWidth: number;
  popupHeight: number;
  showTabCountBadge: boolean;
  urlDisplayMode: "domain" | "abbreviated" | "full" | "none";
  timestampMode: "relative" | "absolute";
  dateFormat: string;
  truncateTitles: boolean;
  enabledCopyFormats: Array<"titleAndUrl" | "markdown" | "json" | "csv" | "html" | "onetab">;
  customCopyTemplates: CopyTemplate[];
  bypassConfirm: {
    deleteSession: boolean;
    deleteItem: boolean;
    closeWindow: boolean;
    openLarge: boolean;
    sort: boolean;
    unify: boolean;
    replace: boolean;
  };

  // Backups & Cloud Sync
  localBackupSchedule: "off" | "startup" | "hourly" | "daily" | "weekly";
  localBackupIndividual: boolean;
  localBackupFolder: string;
  localBackupMaxFiles: number;
  mirrorToBookmarks: boolean;
  driveSyncEnabled: boolean;
  driveClientId: string;
  driveClientSecret: string;
  driveAutoSync: boolean;
  driveSyncAutoSaves: boolean;
  driveEncryptE2E: boolean;
  deviceName: string;

  // Updates
  autoApplyUpdates: boolean;
  checkUpdatesOnStartup: boolean;

  // Context Menu
  contextMenuEnabled: boolean;
  contextMenuItems: ContextMenuItemId[];
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  hasUpdate: boolean;
  pendingUpdateVersion: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  checkedAt: number;
}

export interface SearchHit {
  source: "snapshot" | "collection" | "open";
  id: string;
  parentTitle: string;
  t: number;
  kind: string;
  windowIndex?: number;
  tab: SavedTab;
  windowId?: number;
  tabId?: number;
}

export interface AppStateSummary {
  settings: Settings;
  lastSaveAt: number | null;
  lastBackupAt: number | null;
  lastBackupError: string | null;
  lastSyncAt: number | null;
  lastSyncError: string | null;
  driveConnected: boolean;
  driveEmail: string | null;
  driveE2EUnlocked?: boolean;
  scriptingPermissionGranted?: boolean;
  recovery: RecoveryState | null;
  counts: {
    auto: number;
    named: number;
    collections: number;
    openWindows: number;
    openTabs: number;
    sleepingTabs: number;
  };
}

export type CollapseScope =
  | "currentTab"
  | "currentWindow"
  | "currentGroup"
  | "exceptCurrent"
  | "leftTabs"
  | "rightTabs"
  | "allWindows"
  | "nukeAll";

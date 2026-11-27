# SmartTabber — Unified Tab & Session Manager Design Specification

**Date:** 2026-11-25  
**Product Name:** SmartTabber  
**Target Platform:** Chromium Manifest V3 (Brave, Google Chrome, Edge; `minimum_chrome_version: "120"`)  
**Tech Stack:** TypeScript, Vite (multi-entry build), React, Tailwind CSS, `shadcn/ui` + Watermelon registry components (`table-13`, `tabs-1`, `switch-1`, `alert-14`, `button-2`), Lucide SVG icons (`pickapicon-icons`), IndexedDB (`idb`)

### 1.1 UI Language & Component Sizing Standards
* **Zero Technical Jargon in User-Facing UI:** All labels, descriptions, tooltips, and status text use plain everyday browser terminology (e.g., *"Load tabs only when clicked"* instead of *"Lazy discard"*, *"Auto-save before closing"* instead of *"Shrink-fork"*, *"Save & close all windows"* instead of *"Nuke"*, *"Password-protect cloud backups"* instead of *"AES-256"*, *"Put idle tabs to sleep"* instead of *"Tab Nap"*). No implementation or architecture terms (`MV3`, `IndexedDB`, `PKCE`, `OAuth`) appear in the UI.
* **Consistent Component Sizing:**
  * Buttons, inputs, and selects share a uniform `32px` (`h-8`) height and `6px` (`rounded-md`) radius; icon-only buttons are `32×32px` (`h-8 w-8`).
  * Sidebar navigation items share a `36px` (`h-9`) height and `8px` (`rounded-lg`) radius.
  * Icons come from one consistent Lucide set (`16×16px` in toolbars/nav/buttons, `14×14px` inline/tiles, `18×18px` in `40×40px` summary tiles).
  * Toggle switches (`36×20px`) and checkboxes (`16×16px`) stay uniform across all surfaces.

---

## 1. Purpose & Design Goals

SmartTabber unifies the strongest capabilities of the 6 benchmarked Chrome tab and session managers into one cohesive, zero-conflict MV3 extension:
1. **Crash-Proof Background Safety (TabRetain):** Instant capture on install (`500 ms`), 2s debounced event-driven saving, 1-minute heartbeat (`beat`), 70% shrink-forking so sequential window closes never overwrite a full session, and richest-in-last-3-seconds crash recovery with post-commit `chrome.tabs.discard()` lazy loading.
2. **Granular Auto-Save Triggers & Sync (Tab Session Manager):** Independent triggers and retention caps for periodic, window-close (with min-tab threshold), and browser-exit saves; live window tracking; and Brave/Chrome-compatible Google Drive `drive.appfolder` sync via `chrome.identity.launchWebAuthFlow`.
3. **Structured History, Collections & Rich Export (Session Buddy):** Continuous searchable history alongside curated Collections, multi-select bulk actions, deduplication ("Unify"), 10 granular confirmation bypasses, and Copy/Export in JSON, CSV, HTML, Markdown, and OneTab text.
4. **Native Tab Groups & Multi-Surface Ergonomics (TabXpert):** First-class `chrome.tabGroups` save/restore and optional auto-grouping rules, Popup + Full-Tab Dashboard + Side Panel + Options surfaces, revision history diffing, and UI density controls.
5. **Idle Suspension & Daily Clean-Up (Tablerone):** Built-in idle Tab Suspender ("Tab Nap") with active/audible/pinned/unsaved-form guards and domain whitelist, optional daily scheduled clean-up ("Sleep"), and optional Chrome Bookmarks mirror.
6. **Instant Offload & Hierarchy (OneTab):** One-click capture variants (current tab, window, tab group, all except current, left/right, all windows, Nuke), duplicate policies, Folders → Groups → Tabs hierarchy with Notes, Stars, Tasks, Locks, and Archived states.

---

## 2. Architecture & Module Boundaries

### 2.1 Runtime Entrypoints
* **Service Worker (`src/background/index.ts`):** Pure TypeScript with zero React/DOM dependencies. Owns Chrome API listeners, `chrome.alarms`, crash detection, auto-save engine, idle tab suspender, backup writer, Google Drive sync client, and typed RPC message router (`chrome.runtime.onMessage`).
* **Four UI Entrypoints (React + Tailwind + `shadcn/ui`):**
  * `popup.html` (`src/pages/popup/`): Lightweight fast-opening chunk (~420×580px configurable).
  * `dashboard.html` (`src/pages/dashboard/`): Full-tab 3-pane workspace for organizing, bulk editing, revision diffs, and deep search.
  * `sidepanel.html` (`src/pages/sidepanel/`): Chrome Side Panel (`360px`+) for always-available live window + closed session switching.
  * `options.html` (`src/pages/options/`): Granular 8-section settings & diagnostics center.
* **Utility Pages:**
  * `offscreen.html` (`src/pages/offscreen/`): Created on demand only for large JSON/CSV/HTML Blob export URLs and optional opt-in cluster thumbnails.
  * `suspend.html` (`src/pages/suspend/`): Local extension page (zero external CDN dependency) used only when the user chooses `suspendPage` mode instead of native `chrome.tabs.discard()`.

### 2.2 Two-Tier Local Storage Design
* **Fast-Boot Layer (`chrome.storage.local` + `chrome.storage.session`):**
  * `chrome.storage.session`: `{ runId, runStartedAt, prevBeat, checkedRun }`
  * `chrome.storage.local`: `{ runId, beat: { runId, t }, live: { id, sig, runId, created, w, n }, recovery, settings, installedAt, lastSaveAt, lastBackupAt, lastBackupError }`
  * Keeping these small keys in `chrome.storage.local` guarantees instant startup crash checks and sub-millisecond popup badge updates without scanning IndexedDB.
* **Canonical Database (IndexedDB `smarttabber`, v1):**
  * `snapshots`: `{ id, t, updatedAt, kind ("auto" | "windowClose" | "browserExit" | "named" | "imported"), name, runId, src, deviceName, tags[], windows[], tabCount, windowCount, sig }` — indexed by `t`, `kind`, `runId`.
  * `collections`: `{ id, parentFolderId | null, kind ("folder" | "group"), title, color, notes, starred, locked, archived, trackingWindowId | null, startupRegistered, createdAt, updatedAt, order, tags[], items: CollectionItem[] }` — indexed by `parentFolderId`, `kind`, `updatedAt`.
  * `collectionItems` (embedded or normalized): `{ id, url, title, favIconUrl, pinned, groupId, notes, starred, isTask, taskDone, archived }`.
  * `syncMeta`: `{ id, localId, driveFileId, remoteUpdatedAt, deletedAt, dirty }`.
  * `suspendedTabs`: `{ tabId, url, title, favIconUrl, suspendedAt }`.

---

## 3. Core Engines & Algorithms

### 3.1 Auto-Save, Shrink-Forking & Retention (`src/background/autosave.ts` + `src/shared/core.ts`)
1. **Triggers:**
   * `onInstalled` schedules `autosave()` after `500 ms`.
   * Tab events (`onCreated`, `onUpdated` on URL/complete/pinned/groupId, `onRemoved` only when `!info.isWindowClosing`, `onMoved`, `onAttached`, `tabGroups.onUpdated`) debounce `autosave()` by `debounceMs` (default `2000 ms`).
   * `windows.onRemoved` debounces by `4000 ms` (plus optional `windowClose` single-window capture if `autoSaveWindowClose` is enabled and closed tab count `>= minTabsOnWindowClose`).
   * `chrome.alarms` `"autosave"` fires every `autoSaveIntervalMin` (`0.5–60`, default `5`).
   * `chrome.alarms` `"beat"` fires every `1` minute and updates `beat: { runId, t }`.
2. **Capture Filtering:** Excludes incognito windows (unless `saveIncognito === "include"`), SmartTabber's own `chrome-extension://<id>/` tabs, URLs matching `ignoreUrlPatterns` (wildcard `*`), New Tab / `about:blank` (if `ignoreNewTabs`), pinned tabs (if `ignorePinnedTabs`), and browser internal pages (if `ignoreBrowserFeatureTabs`).
3. **Shrink-Forking:** Within the same `runId` and `autoSaveIntervalMin` slot, unchanged signatures are skipped; changed signatures overwrite the current `live` snapshot **unless** `windows.length < live.w` OR `tabCount < live.n * (shrinkThresholdPct / 100)` (default `70%`), which forces a **new snapshot ID** so closing windows cannot overwrite the fuller snapshot.
4. **Retention Thinning (`pruneSnapshots`):** `named`, `imported`, and `startupRegistered` sessions are never auto-pruned. Auto-saves keep:
   * All snapshots `< 2 hours` old
   * Newest snapshot per hour for `2–48 hours`
   * Newest snapshot per day for `> 48 hours`
   * Bounded by `historyDays` (`30 | 90 | 365 | null`) and `maxAutoSnapshots` (`60 | 200 | 500 | null`). Separate FIFO limits apply to `windowClose` and `browserExit` auto-saves.

### 3.2 Crash Detection & Restore (`src/background/recovery.ts` + `src/background/restore.ts`)
1. On new browser `runId()`, `scheduleStartupCheck()` waits `startupCheckSec` (default `15s`, with a `chrome.alarms` fallback) so Brave/Chrome's native session restore finishes first.
2. `recoveryCandidate()` inspects previous-run `auto` snapshots active within `3000 ms` of `max(lastSnap.t, prevBeat.t)` and picks the snapshot with the maximum tab count (`m.n >= best.n`).
3. `shouldOffer(coverage, missing)` triggers when `coverage < 0.5` OR (`missing >= 5 && coverage < 0.9`). Sets amber `#d97706` `"!"` badge (or missing count) and persists `recovery` state.
4. **Restore (`restoreSession`):**
   * Supports `newWindow`, `currentWindowOverwrite`, `addToCurrentWindow`, `singleWindow(index)`, and `asTabGroups`.
   * Preserves window bounds (`left`, `top`, `width`, `height`, `state`), pinned tabs, and native Chrome Tab Groups (`chrome.tabs.group()` + `chrome.tabGroups.update({ title, color, collapsed })`).
   * **Post-commit lazy discard:** When `restoreMode === "lazyDiscard"` (or tab count exceeds `optimizedOpenThreshold`), polls each non-active created tab up to `5s` until `t.url !== "about:blank"` before calling `chrome.tabs.discard(id)`, re-navigating if discard ever clears a pending URL.

### 3.3 Built-In Idle Tab Suspender ("Tab Nap") (`src/background/suspender.ts`)
* Runs a 1-minute `chrome.alarms` `"suspender"` check when `suspenderEnabled === true`.
* Tracks per-tab last-active timestamps in memory/session storage.
* Suspends tabs idle longer than `suspendAfterMin` (default `90m`) or when active un-suspended tabs exceed `maxActiveTabs` (default `15`).
* **Guards:** Never suspends active tab, audible tabs (`tab.audible`), pinned tabs (`tab.pinned`), tabs matching `suspendWhitelist`, or (when `guardUnsavedForms` is on) tabs reporting dirty form inputs via an optional lightweight check.
* **Suspension Mechanism:** Uses `chrome.tabs.discard(tabId)` by default (native Chromium memory unloading, preserves exact URL/favicon/history), with an optional `suspend.html#url=...&title=...` local placeholder mode and optional `autoReloadSuspendedOnFocus`.

### 3.4 Capture, Collections, Live Tracking & Daily Sleep
* **One-Click Capture Actions:** Current tab, current window, current tab group, selected tabs, all except current, left/right tabs, all windows, Nuke (save & close all), and interactive cherry-pick popup.
* **Collections:** Hierarchical Folders & Groups supporting notes, stars, tasks (`isTask`/`taskDone`), locked groups, archived items, drag-and-drop reordering, deduplication ("Unify"), and 6 sort orders.
* **Live Window Tracking:** Pin any Collection to a `windowId` so tab opens/closes/moves/updates mirror automatically into that Collection (with optional `trackNewWindows`).
* **Daily Clean-Up ("Sleep"):** Optional daily alarm (`sleepHour`, e.g. `"06:00"`) that saves open windows into a dated session/collection and optionally closes tabs (`closeTabsAfterSleep`).

### 3.5 Backups, Import/Export & Google Drive Sync
* **Local Scheduled Backups:** `off | startup | hourly | daily | weekly` writing to `Downloads/SmartTabber/` (single bundle or per-session files, rotated to `maxLocalBackups`). Requires optional `downloads` permission requested on user gesture.
* **Optional Bookmarks Mirror:** Opt-in sync of named Collections into a `SmartTabber` folder under Chrome Bookmarks (`bookmarks` optional permission).
* **Export & Clipboard:** Canonical SmartTabber JSON v1, CSV, Netscape Bookmarks HTML, Markdown, OneTab `url | title` text, plus user-editable copy format templates (`%t`, `%u`, `%g`).
* **Cross-Extension Importer:** Auto-detects SmartTabber JSON, TabRetain JSON, Session Buddy (v3 & v4 JSON), Tab Session Manager JSON, OneTab plain text, Tablerone JSON, TabXpert JSON, Bookmarks HTML, and plain URL lists.
* **Google Drive Sync (`drive.appfolder`):** Uses `chrome.identity.launchWebAuthFlow` OAuth2 PKCE (compatible with both **Brave** and **Chrome**) with a user-supplied Google Cloud OAuth Client ID in Settings, `deviceName` tagging, `autoSync` toggle, `syncAutoSaves` toggle, and optional **WebCrypto AES-GCM-256** client-side encryption before upload.

---

## 4. Complete Granular Settings Schema (`Settings`)

| Category | Setting Keys & Types / Defaults |
|---|---|
| **Auto-Save & Triggers** | `autoSaveEnabled` (`true`), `autoSaveIntervalMin` (`5`, `0.5–60`), `debounceMs` (`2000`), `shrinkForkPct` (`70`, `10–95`), `autoSaveOnWindowClose` (`true`), `minTabsOnWindowClose` (`1`), `maxWindowCloseSaves` (`15`), `autoSaveOnBrowserExit` (`true`), `maxBrowserExitSaves` (`10`), `useTabTitleForAutoSave` (`true`) |
| **Retention & Pruning** | `historyDays` (`"30" \| "90" \| "365" \| "forever"`, default `"90"`), `maxAutoSnapshots` (`200 \| 500 \| 1000 \| null`, default `500`), `thinAfter2hHourly` (`true`), `thinAfter48hDaily` (`true`), `purgeUnnamedClosedDays` (`0` = off, or `N` days), `purgeEmptyOnClose` (`true`), `purgePinnedOnlyOnClose` (`false`) |
| **Crash & Startup** | `startupBehavior` (`"recoveryBanner" \| "restorePrevious" \| "openStartupSessions" \| "openDashboard" \| "ask" \| "none"`, default `"recoveryBanner"`), `startupCheckSec` (`15`, `5–60`), `recoveryCoverageThreshold` (`0.5`), `recoveryMissingMin` (`5`), `showBadgeAlert` (`true`) |
| **Restore & Tab Placement** | `defaultOpenMode` (`"newWindow" \| "currentWindow" \| "addToCurrent"`, default `"newWindow"`), `restoreWindowBounds` (`true`), `restoreTabGroups` (`true`), `keepPinnedInCurrentWindow` (`true`), `skipAlreadyOpenOnCrashRestore` (`true`), `warnOnOpenTabCount` (`25`), `openNextToActive` (`false`), `switchToOpenedTab` (`true`), `restoreListAction` (`"keep" \| "remove" \| "archive"`, default `"keep"`), `urlClickInClosedSession` (`"ask" \| "closed" \| "focused"`, default `"closed"`) |
| **Lazy Load & Suspender** | `restoreLoadMode` (`"lazyDiscard" \| "alwaysLoad" \| "suspendPage" \| "lastState"`, default `"lazyDiscard"`), `optimizedOpenThreshold` (`10`), `suspenderEnabled` (`false`), `suspendAfterMin` (`90`), `maxActiveTabsBeforeSuspend` (`15`), `autoReloadOnFocus` (`true`), `suspendBackend` (`"nativeDiscard" \| "suspendPage"`, default `"nativeDiscard"`), `guardActiveTab` (`true`), `guardAudibleTabs` (`true`), `guardPinnedTabs` (`true`), `guardUnsavedForms` (`true`), `suspendWhitelist` (`string[]`) |
| **Capture & Tab Groups** | `toolbarClickAction` (`"openPopup" \| "sendCurrentWindow" \| "sendCurrentTab" \| "sendAllWindows"`), `closeTabsAfterCapture` (`true`), `capturePinnedPolicy` (`"ignore" \| "allow"`, default `"ignore"`), `duplicatePolicy` (`"allow" \| "reject" \| "keepTitle" \| "updateTitle"`, default `"reject"`), `includeTabGroupsOnCapture` (`true`), `autoTabGroupByDomain` (`false`), `autoTabUngroupSingle` (`false`), `autoTabGroupColor` (`"random" \| chrome.tabGroups.Color`), `dailySleepEnabled` (`false`), `dailySleepTime` (`"06:00"`), `dailySleepCloseTabs` (`true`) |
| **Filtering & Privacy** | `ignoreUrlPatterns` (`string[]`), `ignoreNewTabs` (`true`), `ignoreBrowserFeatureTabs` (`false`), `incognitoPolicy` (`"exclude" \| "include" \| "secureNoSave"`, default `"exclude"`), `compressFavicons` (`true`) |
| **Interface & Confirmations** | `theme` (`"system" \| "light" \| "dark"`), `uiDensity` (`"dense" \| "compact" \| "normal" \| "expanded"`, default `"compact"`), `popupWidth` (`420`, `340–800`), `popupHeight` (`580`, `400–650`), `showTabCountBadge` (`false`), `urlDisplayMode` (`"domain" \| "abbreviated" \| "full" \| "none"`), `timestampMode` (`"relative" \| "absolute"`), `dateFormat` (`"YYYY-MM-DD HH:mm"`), `truncateTitles` (`true`), `enableThumbnails` (`false`), `enabledCopyFormats` (`["titleAndUrl", "markdown", "json", "csv", "html"]`), `customCopyTemplates` (`{ name, format }[]`), `bypassConfirm` (`{ deleteSession, deleteItem, closeWindow, openLarge, sort, unify, replace }`) |
| **Backups & Cloud Sync** | `localBackupSchedule` (`"off" \| "startup" \| "hourly" \| "daily" \| "weekly"`), `localBackupIndividual` (`false`), `localBackupFolder` (`"SmartTabber"`), `localBackupMaxFiles` (`30`), `mirrorToBookmarks` (`false`), `driveSyncEnabled` (`false`), `driveClientId` (`""`), `driveAutoSync` (`false`), `driveSyncAutoSaves` (`false`), `driveEncryptE2E` (`false`), `deviceName` (`""`) |

---

## 5. Permissions & Security Model
* **Required Manifest Permissions:** `tabs`, `tabGroups`, `storage`, `unlimitedStorage`, `alarms`, `sidePanel`, `contextMenus`, `favicon`, `offscreen`.
* **Optional Permissions (Requested Only on User Action):** `downloads` (for scheduled local backups), `bookmarks` (for Chrome Bookmarks import/mirror), `identity` (for Google Drive OAuth2), `scripting` (only if `guardUnsavedForms` is toggled on).
* **Zero Telemetry & Strict CSP:** `script-src 'self'; object-src 'self'`. Zero third-party analytics (no Mixpanel/Sentry), zero external CDN scripts (even `suspend.html` is 100% bundled locally).
* **Safety:** Only `http://`, `https://`, and `ftp://` URLs are restored (`file://` requires explicit browser extension permission; `javascript:`/`data:` are blocked).

---

## 6. Verification Plan (Post-Build)
1. **Unit & Integration Tests (Vitest):** `core.ts` (shrink-forking, 2h/48h/30d thinning, `recoveryCandidate`, `shouldOffer`, wildcard URL filtering, duplicate policies, all 8 import/export parsers, AES-GCM-256 round-trip).
2. **Type & Build Gate:** `tsc --noEmit` + `vite build` producing clean `dist/` unpacked extension with strict MV3 CSP compliance.
3. **Live Browser Verification:** Load unpacked `dist/` in Brave/Chrome, verify `onInstalled` 500 ms capture, multi-window shrink-forking across simulated shutdown, crash banner recovery with `tabs.discard()`, Side Panel, Dashboard drag/search/export, and Options persistence.

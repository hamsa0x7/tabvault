# Chrome Web Store Submission Kit — TabVault

Use this reference when filling out the **Chrome Developer Dashboard** for TabVault (`1.0.0`).

---

## 1. Store Listing Copy

- **Extension Name (32 / 45 chars):**
  `TabVault — Tab & Session Manager`
- **Summary (123 / 132 chars):**
  `Auto-save every window, tab, and tab group. Recover lost sessions in one click and organize tabs locally or with Google Drive.`
- **Single-Purpose Statement (for Privacy Practices Tab):**
  `Automatically saves, organizes, suspends, and restores browser tab and window sessions locally, with optional user-initiated backup.`
- **Support Email:**
  `support@94arts.com` *(set and verify in Chrome Developer Dashboard)*
- **Privacy Policy URL:**
  `https://github.com/hamsa0x7/tabvault/blob/main/PRIVACY.md`

### Full Store Description (Draft)

```text
TabVault keeps your browser organized and protects your open work from accidental window closes or crashes.

KEY FEATURES
• Automatic Session Backups: Periodically snapshots all open windows, tabs, and Chrome tab groups locally in your browser.
• One-Click Crash & Window Recovery: Quickly restore recently closed windows or full sessions.
• Popup, Side Panel & Full Dashboard: Manage open windows from the toolbar Side Panel or Popup (Alt+Shift+P), quick-save all windows (Alt+Shift+S), or open the full-screen Dashboard (Alt+Shift+D).
• Idle Tab Suspender: Automatically suspend inactive tabs to reduce memory usage, with domain whitelisting and optional unsaved-form protection.
• Flexible Import & Export: Export or import sessions as encrypted/plain JSON, Bookmarks HTML, CSV, Markdown, or OneTab-compatible text.
• Optional Google Drive & Bookmarks Sync: Back up your encrypted or plain session archive to your own Google Drive, or pin collections to Chrome Bookmarks.

PRIVACY FIRST
• 100% local processing by default — no analytics, no tracking, and no third-party servers.
• Optional permissions (Downloads, Bookmarks, Google Drive Identity, Scripting for unsaved-form checks, and Reading List import) are only requested if you enable those features.

DISCLAIMER
TabVault is an independent browser extension and is not affiliated with, endorsed by, or officially connected to Google LLC, Google Drive, Google Chrome, or any third-party session managers or bookmark services supported for user data import.
```

---

## 2. CWS Privacy Practices Tab

- **Data Usage Declaration:**
  - If Google Drive sync is optional and data is only stored in the user's own Drive: declare **Website content / Web history** only if applicable under CWS User Data FAQ for `tabs` + Google Drive sync, or confirm **"No user data collected by developer servers"** and link your hosted `PRIVACY.md` URL.
- **Certifications:**
  - Check all three CWS Limited Use / Data Handling certifications (no selling data, no unrelated use, no creditworthiness transfer).

---

## 3. Permission Justifications (Copy-Paste for Developer Console)

### Required Permissions

- **`tabs`**
  > *Required to read open tab URLs, titles, pinned states, and window/tab relationships so TabVault can auto-save sessions, detect duplicate tabs, suspend idle tabs, and restore closed windows on user request.*
- **`tabGroups`**
  > *Required to preserve Chrome tab group titles, colors, and collapsed states when saving and restoring multi-tab workflows.*
- **`storage`**
  > *Required to store user preferences, auto-save schedules, and temporary per-tab activity timestamps locally in `chrome.storage`.*
- **`unlimitedStorage`**
  > *Required so users with large numbers of saved tab snapshots and collections are not blocked by the default 10 MB storage quota.*
- **`alarms`**
  > *Required to run periodic local auto-save snapshots and idle-tab suspension checks in the Manifest V3 service worker.*
- **`sidePanel`**
  > *Required to provide the TabVault Side Panel view for browsing and restoring saved sessions alongside active tabs.*
- **`contextMenus`**
  > *Required to add quick-save and session actions to the browser right-click context menu.*
- **`favicon`**
  > *Required to display cached site favicons next to saved tabs inside the TabVault Popup, Side Panel, and Dashboard without making external requests.*
- **`offscreen`**
  > *Required to create temporary Blob object URLs in an offscreen document when exporting large session backup files.*

### Optional Permissions (Requested Only on User Action)

- **`downloads`**
  > *Requested only when the user enables or triggers local file exports, to save JSON, HTML, CSV, or Markdown session backups to their Downloads folder.*
- **`bookmarks`**
  > *Requested only when the user enables Bookmark Sync or Pin-to-Bookmarks-Bar in Settings.*
- **`identity`**
  > *Requested only when the user explicitly clicks Sign In with Google Drive in Options to back up or restore their own session archive.*
- **`scripting`**
  > *Requested only when the user enables unsaved-form protection for the idle tab suspender, to check whether an inactive tab has unsaved `<input>` or `<textarea>` content before suspending it.*
- **`readingList`**
  > *Requested only when the user explicitly clicks Import Reading List in Collections or Settings, to copy saved Chrome Reading List links into a local Collection.*
- **`optional_host_permissions` (`https://www.googleapis.com/*`, `https://accounts.google.com/*`, `https://oauth2.googleapis.com/*`)**
  > *Requested only when the user explicitly enables Google Drive backup sync, to authenticate via OAuth2, refresh tokens, and read/write TabVault backup files in the user's personal Google Drive `appDataFolder`.*

---

## 4. Packaging Checklist

1. Run `npm run build` to generate a fresh `dist/`.
2. Zip the **contents inside `dist/`** (so `manifest.json` is at the root of the `.zip`, not `dist/manifest.json`).
3. Do **not** zip the repository root (`node_modules/`, `_research_extensions/`, `.git/`, etc. must never be included).

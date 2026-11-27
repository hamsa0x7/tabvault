# Privacy Policy for TabVault

**Effective Date:** November 26, 2026  
**Extension Name:** TabVault  
**Contact:** `support@94arts.com`

## 1. Overview & Local-First Processing

TabVault is a local-first Chrome extension designed to auto-save open windows, tabs, and tab groups, recover lost sessions, suspend idle tabs, and organize collections.

All core tab management, session indexing, search, and optional client-side backup encryption occur **100% locally** inside your browser using Chrome Extension Storage (`chrome.storage`) and IndexedDB. TabVault does **not** operate any proprietary backend servers, does **not** collect telemetry or usage analytics, and does **not** sell, rent, or transfer your browsing data to third parties.

## 2. Data Accessed & How It Is Used

To provide its core functionality, TabVault accesses only the data strictly required for user-initiated or configured local features:

- **Open Tabs, Windows & Tab Groups (`tabs`, `tabGroups`, `favicon`):** Used locally to capture, display, search, deduplicate, suspend, and restore your browser sessions and collections.
- **Local Storage (`storage`, `unlimitedStorage`):** Used to persist your saved snapshots, collections, extension preferences, and temporary tab activity timestamps (`chrome.storage.session`) on your device.
- **Background Scheduling & Offscreen Processing (`alarms`, `offscreen`):** Used to run periodic local auto-save / idle-tab suspension checks and to generate local Blob download URLs for large session export files.
- **UI Surfaces (`sidePanel`, `contextMenus`):** Used to render the TabVault side panel and right-click context menu actions.

## 3. Optional Permissions (Disabled by Default)

TabVault requests the following permissions **only** when you explicitly enable the corresponding feature in Settings:

- **Local File Exports (`downloads`):** Used solely to save exported session backups (JSON, HTML, CSV, Markdown, or OneTab text) to your local Downloads folder when you click Export.
- **Bookmark Sync & Pinning (`bookmarks`):** Used solely to sync collections or pin sessions to your Chrome Bookmarks bar when you enable bookmark integration.
- **Unsaved Form Detection (`scripting`):** Used solely before suspending an idle tab to check whether the page contains unsaved `<input>` or `<textarea>` text so your work is not lost. No page content is stored or transmitted.
- **Chrome Reading List Import (`readingList`):** Used solely when you explicitly click **Import Reading List** in Settings or Collections to copy your saved Reading List links into a local TabVault Collection.
- **Google Drive Backup Sync (`identity`, `https://www.googleapis.com/*`, `https://accounts.google.com/*`, `https://oauth2.googleapis.com/*`, `https://tabvault-oauth.94artsdesignstudio-bd8.workers.dev/*`):** Used **only** if you explicitly sign in to Google Drive in Options to back up or restore your own TabVault backup files in your personal Google Drive account. Authentication is handled via Chrome's `chrome.identity.launchWebAuthFlow` OAuth2 flow with a stateless OAuth token-exchange worker (`tabvault-oauth.94artsdesignstudio-bd8.workers.dev`) that does not log or store your Drive contents or browsing data. TabVault's developers never receive your Google Drive contents.

## 4. Data Sharing, Tracking & Retention

- **No Tracking:** TabVault contains zero third-party analytics, advertising SDKs, or tracking pixels.
- **No Third-Party Sharing:** Your data is never sold or shared with advertisers, data brokers, or external services. External network communication occurs **only** when you explicitly initiate Google Drive sync with your own Google account, check for extension updates (`/releases/latest`), or submit voluntary in-app feedback (`/feedback`).
- **Retention & Deletion:** All local data remains on your device until you delete sessions/collections inside TabVault, clear extension storage, or uninstall the extension.

## 5. Third-Party Trademarks & Disclaimer

TabVault is an independent browser extension and is not affiliated with, endorsed by, or officially connected to Google LLC, Google Chrome, Google Drive, or any third-party bookmarking or session-management tools whose export formats are supported for user import (such as OneTab, Session Buddy, Tab Session Manager, Tablerone, TabXpert, Pocket, Pinboard, or Linkwarden). All product and company names are trademarks™ or registered® trademarks of their respective holders.

## 6. Changes to This Policy

If TabVault's data practices change, this Privacy Policy will be updated with a revised effective date prior to publishing the updated extension version.

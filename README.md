# TabVault

Auto-save every window, tab, and tab group. Recover lost sessions in one click and organize tabs locally or with optional Google Drive sync.

## Features

- **Automatic Session Snapshots & Crash Recovery:** Periodically saves open windows, tabs, and tab groups locally so closed or crashed windows can be restored in one click.
- **Tab Collections & Full-Window Dashboard:** Organize, search, deduplicate, and restore saved tab groups from the Side Panel / Popup (`Alt+Shift+P`), quick-save (`Alt+Shift+S`), or Full Dashboard (`Alt+Shift+D`).
- **Idle Tab Suspender:** Automatically suspends inactive tabs to free memory, with domain whitelisting and optional unsaved-form protection.
- **Import & Export:** Export and import sessions in JSON (with optional password encryption), Bookmarks HTML, CSV, Markdown, and OneTab text formats.
- **Optional Google Drive & Bookmarks Sync:** Keep backups in your personal Google Drive or sync collections to Chrome Bookmarks (disabled by default; requested via optional permissions).

## Development & Build

Requires **Node.js >= 20.11.0**.

```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Type-check
npm run typecheck

# Watch build (outputs to dist/)
npm run dev

# Production build (type-check + bundle into dist/)
npm run build
```

### Loading Unpacked in Chrome

1. Run `npm run build` to generate `dist/`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` directory.

## Permissions Overview

- **Core (`tabs`, `tabGroups`, `storage`, `unlimitedStorage`, `alarms`, `sidePanel`, `contextMenus`, `favicon`, `offscreen`):** Used locally to capture, display, search, auto-save, suspend, and restore tabs/windows.
- **Optional (`downloads`, `bookmarks`, `identity`, `scripting`, `readingList`):** Requested only at runtime when you enable file exports, bookmark sync, Google Drive backup, unsaved-form checks before tab suspension, or Reading List import.

See [PRIVACY.md](./PRIVACY.md) for full data handling details and [LICENSE](./LICENSE) for licensing.

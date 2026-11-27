import { getAllCollections, getAllSnapshots, getSettings } from "../shared/db.ts";
import { exportAsJson } from "../shared/import-export.ts";

let creatingOffscreen: Promise<void> | null = null;
let offscreenQueue: Promise<unknown> = Promise.resolve();
let downloadsListenerAttached = false;

const PENDING_OFFSCREEN_KEY = "pendingOffscreenDownloads";

interface PendingOffscreenDownload {
  url: string;
  createdAt: number;
}

function withOffscreenLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = offscreenQueue.then(fn, fn);
  offscreenQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function readPendingOffscreenDownloads(): Promise<Record<string, PendingOffscreenDownload>> {
  const res = (await chrome.storage?.session?.get(PENDING_OFFSCREEN_KEY).catch(() => ({}))) as
    | { pendingOffscreenDownloads?: Record<string, PendingOffscreenDownload> }
    | undefined;
  return { ...(res?.pendingOffscreenDownloads || {}) };
}

async function writePendingOffscreenDownloads(map: Record<string, PendingOffscreenDownload>): Promise<void> {
  if (Object.keys(map).length === 0) {
    await chrome.storage?.session?.remove?.(PENDING_OFFSCREEN_KEY).catch(() => {});
  } else {
    await chrome.storage?.session?.set?.({ [PENDING_OFFSCREEN_KEY]: map }).catch(() => {});
  }
}

async function closeOffscreenIfIdle(): Promise<void> {
  if (!chrome.offscreen) return;
  const remaining = await readPendingOffscreenDownloads();
  if (Object.keys(remaining).length > 0) return;
  const contexts = await chrome.runtime
    .getContexts?.({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] })
    .catch(() => []);
  if (contexts && contexts.length > 0) {
    await chrome.offscreen.closeDocument?.().catch(() => {});
  }
}

async function revokeAndCloseUrl(url: string): Promise<void> {
  await chrome.runtime.sendMessage({ target: "offscreen", cmd: "revokeObjectUrl", url }).catch(() => {});
  await closeOffscreenIfIdle();
}

export function cleanupOffscreenDownloads(expiredOnly = false): Promise<void> {
  return withOffscreenLock(async () => {
    const map = await readPendingOffscreenDownloads();
    const ids = Object.keys(map);
    if (ids.length === 0) {
      await closeOffscreenIfIdle();
      return;
    }
    const now = Date.now();
    const toRevoke: string[] = [];
    for (const idStr of ids) {
      const entry = map[idStr];
      if (!entry) continue;
      let done = !expiredOnly || now - entry.createdAt >= 55_000;
      if (!done && chrome.downloads?.search) {
        const found = await chrome.downloads.search({ id: Number(idStr) }).catch(() => []);
        if (!found.length || found[0].state === "complete" || found[0].state === "interrupted") {
          done = true;
        }
      }
      if (done) {
        toRevoke.push(entry.url);
        delete map[idStr];
      }
    }
    if (toRevoke.length > 0) {
      await writePendingOffscreenDownloads(map);
      for (const url of toRevoke) {
        await chrome.runtime.sendMessage({ target: "offscreen", cmd: "revokeObjectUrl", url }).catch(() => {});
      }
    }
    await closeOffscreenIfIdle();
  });
}

export function attachOffscreenDownloadListener(): void {
  if (downloadsListenerAttached || !chrome.downloads?.onChanged?.addListener) return;
  downloadsListenerAttached = true;
  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.state?.current !== "complete" && delta.state?.current !== "interrupted") return;
    void withOffscreenLock(async () => {
      const map = await readPendingOffscreenDownloads();
      const entry = map[String(delta.id)];
      if (!entry) return;
      delete map[String(delta.id)];
      await writePendingOffscreenDownloads(map);
      await revokeAndCloseUrl(entry.url);
    });
  });
}

async function ensureOffscreen(): Promise<void> {
  if (!chrome.offscreen) return;
  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts && contexts.length > 0) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen
      .createDocument({
        url: "offscreen.html",
        reasons: [chrome.offscreen.Reason.BLOBS],
        justification: "Create temporary Blob download URLs for large session backups",
      })
      .finally(() => {
        creatingOffscreen = null;
      });
  }
  await creatingOffscreen;
}

function toBase64Utf8(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export async function downloadTextFile(filename: string, content: string, mime = "application/json", saveAs = false): Promise<number> {
  if (!(await chrome.permissions.contains({ permissions: ["downloads"] }))) {
    throw new Error("Allow Downloads permission in Settings first.");
  }
  attachOffscreenDownloadListener();

  let url: string | null = null;
  let offscreenUrl = false;
  try {
    await ensureOffscreen();
    const res = (await chrome.runtime.sendMessage({
      target: "offscreen",
      cmd: "createObjectUrl",
      content,
      mime,
    })) as { url?: string } | undefined;
    if (res?.url) {
      url = res.url;
      offscreenUrl = true;
    }
  } catch {
    url = null;
  }

  if (!url) {
    url = `data:${mime};base64,${toBase64Utf8(content)}`;
  }

  try {
    const id = await chrome.downloads.download({
      url,
      filename,
      conflictAction: "uniquify",
      saveAs,
    });
    if (offscreenUrl && url) {
      await withOffscreenLock(async () => {
        const map = await readPendingOffscreenDownloads();
        map[String(id)] = { url: url!, createdAt: Date.now() };
        await writePendingOffscreenDownloads(map);
      });
      await chrome.alarms?.create?.("offscreenCleanup", { delayInMinutes: 1 });
    }
    return id;
  } catch (err) {
    if (offscreenUrl && url) {
      await withOffscreenLock(() => revokeAndCloseUrl(url!));
    }
    throw err;
  }
}

export async function writeLocalBackup(): Promise<{ files: number; sessions: number }> {
  try {
    const settings = await getSettings();
    const snaps = [...(await getAllSnapshots())].sort((a, b) => b.t - a.t);
    const cols = await getAllCollections();
    const folder = (settings.localBackupFolder || "TabVault").replace(/[\\/:*?"<>|]/g, "_");
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

    if (settings.localBackupIndividual) {
      let count = 0;
      for (const s of snaps.slice(0, settings.localBackupMaxFiles)) {
        const safeName = (s.name || s.id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        await downloadTextFile(`${folder}/${stamp}-${safeName}.json`, exportAsJson([s]));
        count++;
      }
      await chrome.storage.local.set({ lastBackupAt: Date.now(), lastBackupError: null });
      return { files: count, sessions: snaps.length };
    }

    const payload = JSON.stringify(
      {
        format: "tabvault",
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions: snaps,
        collections: cols,
      },
      null,
      2
    );
    await downloadTextFile(`${folder}/tabvault-backup-${stamp}.json`, payload);
    await chrome.storage.local.set({ lastBackupAt: Date.now(), lastBackupError: null });
    return { files: 1, sessions: snaps.length };
  } catch (err) {
    await chrome.storage.local
      .set({ lastBackupError: String((err as Error)?.message || err) })
      .catch(() => {});
    throw err;
  }
}

export interface LocalBackupFileInfo {
  id: number;
  filename: string;
  shortName: string;
  fileSize: number;
  startTime: string;
}

export async function listLocalBackups(): Promise<{ granted: boolean; files: LocalBackupFileInfo[] }> {
  const granted = (await chrome.permissions?.contains?.({ permissions: ["downloads"] }).catch(() => false)) ?? false;
  if (!granted || !chrome.downloads?.search) return { granted, files: [] };

  const settings = await getSettings();
  const folder = (settings.localBackupFolder || "TabVault").replace(/[\\/:*?"<>|]/g, "_").toLowerCase();
  const items = await chrome.downloads.search({ exists: true, orderBy: ["-startTime"], limit: 100 }).catch(() => []);
  const files: LocalBackupFileInfo[] = [];
  for (const item of items) {
    const rawName = item.filename || "";
    const lower = rawName.toLowerCase().replace(/\\/g, "/");
    if (!lower.endsWith(".json")) continue;
    if (
      !lower.includes("tabvault-backup-") &&
      !lower.includes("smarttabber-backup-") &&
      !lower.includes(`/${folder}/`)
    ) {
      continue;
    }
    const parts = rawName.replace(/\\/g, "/").split("/");
    files.push({
      id: item.id,
      filename: rawName,
      shortName: parts[parts.length - 1] || rawName,
      fileSize: item.fileSize || 0,
      startTime: item.startTime || "",
    });
    if (files.length >= 25) break;
  }
  return { granted: true, files };
}

export async function showLocalBackup(id: number): Promise<void> {
  chrome.downloads?.show?.(id);
}

export async function deleteLocalBackup(id: number): Promise<void> {
  await chrome.downloads?.removeFile?.(id).catch(() => {});
  await chrome.downloads?.erase?.({ id }).catch(() => {});
}

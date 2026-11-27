import { decryptPayload, encryptPayload, type EncryptedEnvelope } from "../shared/crypto.ts";
import {
  deleteCollection,
  deleteSnapshots,
  getAllCollections,
  getAllSnapshots,
  getSettings,
  getSyncTombstones,
  putCollection,
  putSnapshot,
  recordSyncTombstones,
  saveSettings,
} from "../shared/db.ts";
import { detectAndParseImport, exportAsJson } from "../shared/import-export.ts";
import { DAY, uid } from "../shared/core.ts";
import type { CollectionRecord, SessionSnapshot, Settings } from "../shared/types.ts";

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

export async function syncCollectionsToBookmarks(): Promise<void> {
  const settings = await getSettings();
  if (!settings.mirrorToBookmarks) return;
  if (!(await chrome.permissions.contains({ permissions: ["bookmarks"] }))) return;

  const cols = await getAllCollections();
  const tree = await chrome.bookmarks.getTree();
  const otherFolder = tree[0]?.children?.find((c) => c.id === "2") || tree[0]?.children?.[1] || tree[0];
  if (!otherFolder) return;

  const existing = (otherFolder.children || []).find((c) => c.title === "TabVault");
  let rootId: string;
  if (existing) {
    const children = await chrome.bookmarks.getChildren(existing.id);
    for (const child of children) {
      await chrome.bookmarks.removeTree(child.id).catch(() => {});
    }
    rootId = existing.id;
  } else {
    const created = await chrome.bookmarks.create({ parentId: otherFolder.id, title: "TabVault" });
    rootId = created.id;
  }

  for (const col of cols.filter((c) => !c.archived && c.items.length > 0)) {
    const folder = await chrome.bookmarks.create({ parentId: rootId, title: col.title || "Collection" });
    for (const item of col.items) {
      await chrome.bookmarks.create({ parentId: folder.id, title: item.title, url: item.url }).catch(() => {});
    }
  }
}

// ============================================================================
// Google Drive AppData Sync via OAuth2 PKCE (Brave + Chrome compatible)
// ============================================================================
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email";
const DRIVE_BACKUP_FILE = "tabvault-cloud-sync.json";

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      throw new Error("Google Drive request timed out. Check your connection and try again.");
    }
    throw new Error("Network error communicating with Google Drive. Check your internet connection.");
  } finally {
    clearTimeout(timer);
  }
}

function randomVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256B64Url(plain: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plain));
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Optional built-in OAuth config (populate once CWS extension ID & Google Cloud OAuth are finalized):
// - If manifest.json declares `oauth2.client_id`, Chrome uses `chrome.identity.getAuthToken` (zero server).
// - If `BUILTIN_DRIVE_CLIENT_ID` is set, Brave/non-Chrome browsers fall back to `launchWebAuthFlow`.
// - If `DRIVE_TOKEN_PROXY_URL` is also set, PKCE code/refresh exchanges run through your serverless proxy.
export const BUILTIN_DRIVE_CLIENT_ID = "601743842283-c2t16njvm0l78397jr7mpq19cpgmbok7.apps.googleusercontent.com";
export const DRIVE_TOKEN_PROXY_URL = "https://tabvault-oauth.94artsdesignstudio-bd8.workers.dev";

async function tryGetChromeAuthToken(interactive: boolean): Promise<string | null> {
  const manifestOAuth = chrome.runtime?.getManifest?.().oauth2;
  if (!manifestOAuth?.client_id || typeof chrome.identity?.getAuthToken !== "function") return null;
  try {
    const res = await chrome.identity.getAuthToken({ interactive });
    const token = typeof res === "string" ? res : res?.token;
    return token || null;
  } catch {
    return null;
  }
}

export async function driveSignIn(clientId = "", clientSecret = ""): Promise<{ email: string }> {
  const customId = clientId.trim();
  const cleanId = customId || BUILTIN_DRIVE_CLIENT_ID;
  const cleanSecret = clientSecret.trim();
  if (!(await chrome.permissions.contains({ permissions: ["identity"] }))) {
    throw new Error("Allow Google Sign-In permission first.");
  }

  let accessToken = "";
  let refreshToken: string | null = null;
  let expiresIn = 3600;
  let authMode: "chromeIdentity" | "webAuthFlow" = "webAuthFlow";

  // 1. Prefer native 1-click chrome.identity.getAuthToken on Chrome when using built-in OAuth (no custom Client ID)
  if (!customId) {
    const nativeToken = await tryGetChromeAuthToken(true);
    if (nativeToken) {
      accessToken = nativeToken;
      authMode = "chromeIdentity";
    }
  }

  if (!accessToken) {
    if (!cleanId) {
      throw new Error(
        "Built-in Google Sign-In is not configured yet. Open Custom Google OAuth App (Advanced) below to enter your Client ID."
      );
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", cleanId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", DRIVE_SCOPE);
    authUrl.searchParams.set("prompt", "consent");

    const useProxy = !customId && Boolean(DRIVE_TOKEN_PROXY_URL);
    if (cleanSecret || useProxy) {
      // Authorization Code + PKCE + offline refresh tokens
      const verifier = randomVerifier();
      const challenge = await sha256B64Url(verifier);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("access_type", "offline");

      const responseUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true,
      });
      if (!responseUrl) throw new Error("Sign-in cancelled");

      const parsed = new URL(responseUrl);
      const oauthErr = parsed.searchParams.get("error_description") || parsed.searchParams.get("error");
      if (oauthErr) throw new Error(`Google sign-in denied: ${oauthErr}`);

      const code = parsed.searchParams.get("code");
      if (!code) throw new Error("Google didn't return a sign-in code. Please try again.");

      const tokenRes = useProxy
        ? await fetchWithTimeout(DRIVE_TOKEN_PROXY_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              grant_type: "authorization_code",
              code,
              code_verifier: verifier,
              redirect_uri: redirectUri,
            }),
          })
        : await fetchWithTimeout("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: cleanId,
              client_secret: cleanSecret,
              code,
              code_verifier: verifier,
              grant_type: "authorization_code",
              redirect_uri: redirectUri,
            }),
          });
      if (!tokenRes.ok) {
        const errBody = await tokenRes.text().catch(() => "");
        throw new Error(
          errBody.includes("client_secret")
            ? "Google rejected the Client Secret. Verify both Client ID and Client Secret in Backups & Sync."
            : "Google sign-in couldn't be completed. Verify your Redirect URI and OAuth test-user access."
        );
      }
      const tokenJson = (await tokenRes.json()) as { access_token: string; refresh_token?: string; expires_in: number };
      accessToken = tokenJson.access_token;
      refreshToken = tokenJson.refresh_token || null;
      expiresIn = tokenJson.expires_in || 3600;
    } else {
      // Without a Client Secret or proxy, use implicit token flow (works on both Chrome and Brave)
      authUrl.searchParams.set("response_type", "token");
      const responseUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true,
      });
      if (!responseUrl) throw new Error("Sign-in cancelled");

      const parsed = new URL(responseUrl);
      const hashParams = new URLSearchParams(parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash);
      const oauthErr =
        hashParams.get("error_description") ||
        hashParams.get("error") ||
        parsed.searchParams.get("error_description") ||
        parsed.searchParams.get("error");
      if (oauthErr) throw new Error(`Google sign-in denied: ${oauthErr}`);

      const token = hashParams.get("access_token");
      if (!token) throw new Error("Google didn't return an access token. Check your Redirect URI in Google Cloud Console.");
      accessToken = token;
      expiresIn = Number(hashParams.get("expires_in")) || 3600;
    }
  }

  const userRes = await fetchWithTimeout("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const userJson = userRes.ok ? ((await userRes.json()) as { email?: string }) : {};
  const email = userJson.email || "Google Account";

  await chrome.storage.local.set({
    driveToken: {
      accessToken,
      refreshToken,
      authMode,
      expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    },
    driveEmail: email,
    lastSyncError: null,
  });
  await saveSettings({ driveSyncEnabled: true, driveAutoSync: true });
  return { email };
}

const DRIVE_E2E_SESSION_KEY = "driveE2EPassword";

export async function getSessionDrivePassword(): Promise<string | undefined> {
  const res = (await chrome.storage?.session?.get(DRIVE_E2E_SESSION_KEY).catch(() => ({}))) as
    | { driveE2EPassword?: string }
    | undefined;
  return res?.driveE2EPassword || undefined;
}

export async function setSessionDrivePassword(password: string | null): Promise<void> {
  if (!password) {
    await chrome.storage?.session?.remove?.(DRIVE_E2E_SESSION_KEY).catch(() => {});
  } else {
    await chrome.storage?.session?.set?.({ [DRIVE_E2E_SESSION_KEY]: password }).catch(() => {});
  }
}

export async function hasSessionDrivePassword(): Promise<boolean> {
  return Boolean(await getSessionDrivePassword());
}

export async function maybeAutoSyncDrive(settings: Settings): Promise<void> {
  if (!settings.driveSyncEnabled || !settings.driveAutoSync) return;
  if (settings.driveEncryptE2E && !(await hasSessionDrivePassword())) return;
  await driveSyncNow().catch(() => {});
}

export async function driveSignOut(): Promise<void> {
  const stored = (await chrome.storage.local.get("driveToken")).driveToken as
    | { accessToken?: string; authMode?: string }
    | undefined;
  if (stored?.authMode === "chromeIdentity" && stored.accessToken && chrome.identity?.removeCachedAuthToken) {
    await chrome.identity.removeCachedAuthToken({ token: stored.accessToken }).catch(() => {});
  }
  await setSessionDrivePassword(null);
  await chrome.storage.local.remove(["driveToken", "driveEmail"]);
}

export async function getDriveBackupInfo(): Promise<{
  exists: boolean;
  id?: string;
  name?: string;
  size?: number;
  modifiedTime?: string;
}> {
  const token = await getValidAccessToken();
  const res = await fetchWithTimeout(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${DRIVE_BACKUP_FILE}' and trashed=false`)}&fields=files(id,name,size,modifiedTime)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error("Couldn't inspect Google Drive backup.");
  const json = (await res.json()) as { files?: Array<{ id: string; name?: string; size?: string; modifiedTime?: string }> };
  const f = json.files?.[0];
  if (!f) return { exists: false };
  return {
    exists: true,
    id: f.id,
    name: f.name || DRIVE_BACKUP_FILE,
    size: f.size ? Number(f.size) : undefined,
    modifiedTime: f.modifiedTime,
  };
}

export async function downloadDriveBackup(): Promise<string> {
  const token = await getValidAccessToken();
  const info = await getDriveBackupInfo();
  if (!info.exists || !info.id) throw new Error("No cloud backup file found on Google Drive.");
  const dlRes = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${info.id}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!dlRes.ok) throw new Error("Couldn't download Google Drive backup.");
  return dlRes.text();
}

export async function deleteDriveBackup(): Promise<boolean> {
  const token = await getValidAccessToken();
  const info = await getDriveBackupInfo();
  if (!info.exists || !info.id) return false;
  const delRes = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${info.id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!delRes.ok) throw new Error("Couldn't delete Google Drive backup.");
  return true;
}

async function getValidAccessToken(): Promise<string> {
  const settings = await getSettings();
  const stored = (await chrome.storage.local.get("driveToken")).driveToken as
    | { accessToken: string; refreshToken?: string | null; authMode?: string; expiresAt: number }
    | undefined;
  if (!stored) throw new Error("Not signed in to Google Drive");

  if (stored.authMode === "chromeIdentity") {
    const fresh = await tryGetChromeAuthToken(false);
    if (fresh) return fresh;
    if (Date.now() < stored.expiresAt) return stored.accessToken;
    throw new Error("Google Drive session expired. Click Reconnect in Backups & Sync.");
  }

  if (Date.now() < stored.expiresAt) return stored.accessToken;

  const useProxy = !settings.driveClientId.trim() && Boolean(DRIVE_TOKEN_PROXY_URL);
  if (!stored.refreshToken || (!useProxy && (!settings.driveClientId || !settings.driveClientSecret))) {
    throw new Error("Google Drive session expired. Click Reconnect in Backups & Sync (add Client Secret for automatic refresh).");
  }
  const res = useProxy
    ? await fetchWithTimeout(DRIVE_TOKEN_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: stored.refreshToken,
        }),
      })
    : await fetchWithTimeout("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: settings.driveClientId.trim(),
          client_secret: settings.driveClientSecret.trim(),
          refresh_token: stored.refreshToken,
          grant_type: "refresh_token",
        }),
      });
  if (!res.ok) throw new Error("Failed to refresh Google Drive token. Please sign in again.");
  const json = (await res.json()) as { access_token: string; expires_in: number };
  await chrome.storage.local.set({
    driveToken: {
      accessToken: json.access_token,
      refreshToken: stored.refreshToken,
      authMode: stored.authMode,
      expiresAt: Date.now() + (json.expires_in - 60) * 1000,
    },
  });
  return json.access_token;
}

interface RemoteSyncPayload {
  sessions?: SessionSnapshot[];
  collections?: CollectionRecord[];
  deletedIds?: Record<string, number>;
}

export async function driveSyncNow(password?: string): Promise<{ uploaded: number; imported: number }> {
  try {
    const settings = await getSettings();
    const effectivePassword = password?.trim()
      ? password
      : settings.driveEncryptE2E
        ? await getSessionDrivePassword()
        : undefined;
    const token = await getValidAccessToken();
    const now = Date.now();
    const localTombstones = await getSyncTombstones();
    const mergedTombstones: Record<string, number> = { ...localTombstones };

    // 1. Find existing sync file in appDataFolder
    const listRes = await fetchWithTimeout(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${DRIVE_BACKUP_FILE}' and trashed=false`)}&fields=files(id,name,modifiedTime)`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) throw new Error("Couldn't access your Google Drive backup folder. Try signing in again.");
    const listJson = (await listRes.json()) as { files: Array<{ id: string }> };
    const existingFileId = listJson.files?.[0]?.id;

    let imported = 0;
    if (existingFileId) {
      const dlRes = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${existingFileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (dlRes.ok) {
        let text = await dlRes.text();
        const maybeJson = JSON.parse(text) as EncryptedEnvelope | RemoteSyncPayload;
        if ("format" in maybeJson && (maybeJson.format === "tabvault-encrypted" || maybeJson.format === "smarttabber-encrypted")) {
          if (!effectivePassword) throw new Error("Backup password required to unlock Google Drive data");
          try {
            text = await decryptPayload(maybeJson, effectivePassword);
          } catch {
            throw new Error("Incorrect backup password. Your existing Google Drive backup was not modified.");
          }
        }
        const remote = JSON.parse(text) as RemoteSyncPayload;
        for (const [id, delTs] of Object.entries(remote.deletedIds || {})) {
          if (typeof delTs === "number" && delTs > (mergedTombstones[id] || 0)) {
            mergedTombstones[id] = delTs;
          }
        }

        const [localSnaps, localCols] = await Promise.all([getAllSnapshots(), getAllCollections()]);
        const snapsToDelete: string[] = [];
        for (const ls of localSnaps) {
          const delTs = mergedTombstones[ls.id];
          if (delTs && delTs >= (ls.updatedAt || ls.t)) {
            snapsToDelete.push(ls.id);
          }
        }
        if (snapsToDelete.length) {
          await deleteSnapshots(snapsToDelete);
          await recordSyncTombstones(snapsToDelete);
        }
        for (const lc of localCols) {
          const delTs = mergedTombstones[lc.id];
          if (delTs && delTs >= lc.updatedAt) {
            await deleteCollection(lc.id);
            await recordSyncTombstones([lc.id], delTs);
          }
        }

        const remainingSnaps = await getAllSnapshots();
        const localSnapMap = new Map(remainingSnaps.map((s) => [s.id, s]));
        for (const s of remote.sessions || []) {
          const delTs = mergedTombstones[s.id];
          if (delTs && delTs >= (s.updatedAt || s.t)) continue;
          const cur = localSnapMap.get(s.id);
          if (!cur || (s.updatedAt || s.t) > (cur.updatedAt || cur.t)) {
            await putSnapshot(s);
            imported++;
          }
        }

        const remainingCols = await getAllCollections();
        const localColMap = new Map(remainingCols.map((c) => [c.id, c]));
        for (const c of remote.collections || []) {
          const delTs = mergedTombstones[c.id];
          if (delTs && delTs >= c.updatedAt) continue;
          const cur = localColMap.get(c.id);
          if (!cur || c.updatedAt > cur.updatedAt) {
            await putCollection(c);
            imported++;
          }
        }
      }
    }

    // 2. Upload merged state (keeping 90 days of deletion tombstones)
    const prunedTombstones: Record<string, number> = {};
    for (const [id, ts] of Object.entries(mergedTombstones)) {
      if (now - ts <= 90 * DAY) prunedTombstones[id] = ts;
    }

    const allSnaps = await getAllSnapshots();
    const toUploadSnaps = settings.driveSyncAutoSaves
      ? allSnaps
      : allSnaps.filter((s) => s.kind === "named" || s.kind === "imported" || s.startupRegistered);
    const allCols = await getAllCollections();

    let bodyStr = JSON.stringify({
      format: "tabvault",
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions: toUploadSnaps,
      collections: allCols,
      deletedIds: prunedTombstones,
    });

    if (settings.driveEncryptE2E) {
      if (!effectivePassword) throw new Error("Enter a backup password in Settings to encrypt cloud sync.");
      bodyStr = JSON.stringify(await encryptPayload(bodyStr, effectivePassword));
    }

    const boundary = "tabvault_" + uid();
    const metadata = JSON.stringify({
      name: DRIVE_BACKUP_FILE,
      ...(existingFileId ? {} : { parents: ["appDataFolder"] }),
    });
    const multipart =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${bodyStr}\r\n--${boundary}--`;

    const uploadUrl = existingFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
      : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

    const upRes = await fetchWithTimeout(uploadUrl, {
      method: existingFileId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: multipart,
    });
    if (!upRes.ok) throw new Error("Failed to upload sessions to Google Drive");

    if (settings.driveEncryptE2E && effectivePassword) {
      await setSessionDrivePassword(effectivePassword);
    }
    await chrome.storage.local.set({ lastSyncAt: Date.now(), lastSyncError: null });
    return { uploaded: toUploadSnaps.length + allCols.length, imported };
  } catch (err) {
    await chrome.storage.local.set({ lastSyncError: String((err as Error)?.message || err) }).catch(() => {});
    throw err;
  }
}

export async function importFromRawText(rawText: string, password?: string) {
  let text = rawText;
  let isEncrypted = false;
  try {
    const parsed = JSON.parse(rawText) as EncryptedEnvelope;
    if (parsed?.format === "tabvault-encrypted" || parsed?.format === "smarttabber-encrypted") {
      isEncrypted = true;
      if (!password) throw new Error("Password required for encrypted backup file");
      text = await decryptPayload(parsed, password);
    }
  } catch (e) {
    if (isEncrypted) {
      throw e instanceof Error && e.message.includes("Password")
        ? e
        : new Error("Incorrect password or corrupted encrypted backup file");
    }
  }

  const { source, sessions, collections: parsedCols = [] } = detectAndParseImport(text);
  const [existing, existingCols] = await Promise.all([getAllSnapshots(), getAllCollections()]);
  const have = new Set(existing.map((s) => `${s.t}|${s.sig}`));
  const knownUrls = new Set<string>();
  for (const s of existing) {
    if (s.kind === "named" || s.kind === "imported") {
      for (const w of s.windows) for (const t of w.tabs) knownUrls.add(t.url);
    }
  }
  for (const c of existingCols) {
    if (!c.archived) for (const item of c.items) knownUrls.add(item.url);
  }

  let added = 0;
  let tabsAdded = 0;
  let dedupedTabs = 0;
  for (const s of sessions) {
    const dedupedWindows = s.windows
      .map((w) => ({
        ...w,
        tabs: w.tabs.filter((t) => {
          if (knownUrls.has(t.url)) {
            dedupedTabs++;
            return false;
          }
          knownUrls.add(t.url);
          return true;
        }),
      }))
      .filter((w) => w.tabs.length > 0);
    if (!dedupedWindows.length) continue;

    const sig = dedupedWindows.map((w) => w.tabs.map((t) => `${t.pinned ? "*" : ""}${t.url}`).join("\n")).join("\n--\n");
    const key = `${s.t}|${sig}`;
    if (have.has(key)) continue;
    have.add(key);

    const tabCount = dedupedWindows.reduce((sum, w) => sum + w.tabs.length, 0);
    const snap: SessionSnapshot = {
      id: uid(),
      t: s.t,
      updatedAt: s.t,
      kind: s.kind,
      name: s.name || `${source} import`,
      runId: s.kind === "auto" ? "imported" : "",
      src: source,
      windows: dedupedWindows,
      windowCount: dedupedWindows.length,
      tabCount,
      sig,
    };
    await putSnapshot(snap);
    added++;
    tabsAdded += tabCount;
  }

  // Import SmartTabber backup collections (folders first so parentFolderId links stay valid)
  let colsAdded = 0;
  const existingColById = new Map(existingCols.map((c) => [c.id, c]));
  const orderedCols = [
    ...parsedCols.filter((c) => c.kind === "folder"),
    ...parsedCols.filter((c) => c.kind !== "folder"),
  ];
  for (const col of orderedCols) {
    const cur = existingColById.get(col.id);
    if (cur) {
      const existingItemUrls = new Set(cur.items.map((it) => it.url));
      const newItems = col.items.filter((it) => !existingItemUrls.has(it.url));
      if (newItems.length > 0 || col.updatedAt > cur.updatedAt) {
        const mergedCol: CollectionRecord = {
          ...(col.updatedAt > cur.updatedAt ? col : cur),
          items: col.updatedAt > cur.updatedAt
            ? [...col.items, ...cur.items.filter((it) => !new Set(col.items.map((x) => x.url)).has(it.url))]
            : [...cur.items, ...newItems],
          updatedAt: Math.max(cur.updatedAt, col.updatedAt),
        };
        await putCollection(mergedCol);
        existingColById.set(mergedCol.id, mergedCol);
        tabsAdded += newItems.length;
        colsAdded++;
      }
      continue;
    }

    // Also avoid duplicating an existing non-folder collection with identical title & parent
    const byTitle = existingCols.find(
      (c) => c.kind === col.kind && c.title === col.title && (c.parentFolderId ?? null) === (col.parentFolderId ?? null)
    );
    if (byTitle) {
      if (col.kind === "group") {
        const existingItemUrls = new Set(byTitle.items.map((it) => it.url));
        const newItems = col.items.filter((it) => !existingItemUrls.has(it.url));
        if (newItems.length > 0) {
          const mergedCol: CollectionRecord = {
            ...byTitle,
            items: [...byTitle.items, ...newItems],
            updatedAt: Math.max(byTitle.updatedAt, col.updatedAt),
          };
          await putCollection(mergedCol);
          tabsAdded += newItems.length;
          colsAdded++;
        }
      }
      continue;
    }

    await putCollection(col);
    existingColById.set(col.id, col);
    existingCols.push(col);
    tabsAdded += col.items.length;
    colsAdded++;
  }

  return {
    source,
    sessions: added,
    collections: colsAdded,
    skipped: sessions.length - added,
    tabs: tabsAdded,
    deduped: dedupedTabs,
  };
}

export function buildRestoreBookmarkUrl(type: "session" | "collection", id: string): string {
  return chrome.runtime.getURL(`dashboard.html?restore=${type}:${encodeURIComponent(id)}&autoclose=1`);
}

export async function listPinnedBookmarks(): Promise<string[]> {
  if (!(await chrome.permissions.contains({ permissions: ["bookmarks"] }))) return [];
  const prefix = chrome.runtime.getURL("dashboard.html?restore=");
  const matches = await chrome.bookmarks.search({ query: prefix }).catch(() => []);
  const keys: string[] = [];
  for (const m of matches) {
    if (!m.url || !m.url.startsWith(prefix)) continue;
    try {
      const u = new URL(m.url);
      const val = u.searchParams.get("restore");
      if (val) keys.push(val);
    } catch {
      /* ignore malformed */
    }
  }
  return keys;
}

export async function pinToBookmarksBar(opts: {
  type: "session" | "collection";
  id: string;
  title: string;
}): Promise<boolean> {
  if (!(await chrome.permissions.contains({ permissions: ["bookmarks"] }))) {
    throw new Error("Allow Bookmarks permission to pin to the Bookmarks Bar.");
  }
  const url = buildRestoreBookmarkUrl(opts.type, opts.id);
  const existing = await chrome.bookmarks.search({ url }).catch(() => []);
  const cleanTitle = String(opts.title || "Saved Session").trim().slice(0, 80);
  if (existing.length > 0) {
    await chrome.bookmarks.update(existing[0].id, { title: cleanTitle });
    return true;
  }
  const tree = await chrome.bookmarks.getTree();
  const bar = tree[0]?.children?.find((c) => c.id === "1") || tree[0]?.children?.[0];
  if (!bar) throw new Error("Bookmarks Bar not found.");
  await chrome.bookmarks.create({ parentId: bar.id, title: cleanTitle, url });
  return true;
}

export async function unpinFromBookmarksBar(opts: {
  type: "session" | "collection";
  id: string;
}): Promise<boolean> {
  if (!(await chrome.permissions.contains({ permissions: ["bookmarks"] }))) return false;
  const url = buildRestoreBookmarkUrl(opts.type, opts.id);
  const existing = await chrome.bookmarks.search({ url }).catch(() => []);
  for (const bm of existing) {
    await chrome.bookmarks.remove(bm.id).catch(() => {});
  }
  return true;
}

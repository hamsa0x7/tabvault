import { DRIVE_TOKEN_PROXY_URL } from "./backups-sync.ts";
import type { UpdateCheckResult } from "../shared/types.ts";

const UPDATE_CACHE_KEY = "latestReleaseCache";
const PENDING_UPDATE_KEY = "pendingUpdateVersion";

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

export async function recordPendingUpdate(version: string): Promise<void> {
  await chrome.storage.local.set({ [PENDING_UPDATE_KEY]: version });
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = chrome.runtime?.getManifest?.().version || "1.0.0";
  const stored = await chrome.storage.local.get([PENDING_UPDATE_KEY, UPDATE_CACHE_KEY]);
  let pendingUpdateVersion: string | null =
    typeof stored[PENDING_UPDATE_KEY] === "string" ? stored[PENDING_UPDATE_KEY] : null;

  // Ask Chrome if a Web Store update is ready
  if (typeof chrome.runtime?.requestUpdateCheck === "function") {
    try {
      const check = await chrome.runtime.requestUpdateCheck();
      if (check?.status === "update_available" && check.version) {
        pendingUpdateVersion = check.version;
        await chrome.storage.local.set({ [PENDING_UPDATE_KEY]: check.version });
      }
    } catch {
      // Ignore in unpacked / non-CWS installs
    }
  }

  let latestVersion: string | null = null;
  let releaseNotes: string | null = null;
  let publishedAt: string | null = null;

  try {
    const res = await fetch(`${DRIVE_TOKEN_PROXY_URL}/releases/latest`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        available?: boolean;
        version?: string | null;
        releaseNotes?: string | null;
        publishedAt?: string | null;
      };
      if (data.available && data.version) {
        latestVersion = data.version;
        releaseNotes = data.releaseNotes ?? null;
        publishedAt = data.publishedAt ?? null;
      }
    }
  } catch {
    const cached = stored[UPDATE_CACHE_KEY] as Partial<UpdateCheckResult> | undefined;
    if (cached?.latestVersion) {
      latestVersion = cached.latestVersion;
      releaseNotes = cached.releaseNotes ?? null;
      publishedAt = cached.publishedAt ?? null;
    }
  }

  const hasUpdate =
    Boolean(pendingUpdateVersion && compareSemver(pendingUpdateVersion, currentVersion) > 0) ||
    Boolean(latestVersion && compareSemver(latestVersion, currentVersion) > 0);

  const result: UpdateCheckResult = {
    currentVersion,
    latestVersion,
    hasUpdate,
    pendingUpdateVersion,
    releaseNotes,
    publishedAt,
    checkedAt: Date.now(),
  };

  await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: result });
  return result;
}

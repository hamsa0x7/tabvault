import { extractDomain, isRestorable, matchesWildcard } from "../shared/core.ts";
import { getSettings } from "../shared/db.ts";
import type { Settings } from "../shared/types.ts";

const OWN_PREFIX = chrome.runtime.getURL("");
const SUSPEND_PREFIX = chrome.runtime.getURL("suspend.html");

let activityChain: Promise<unknown> = Promise.resolve();
function withActivityLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = activityChain.then(fn, fn);
  activityChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function readActivityMap(): Promise<Record<string, number>> {
  const res = (await chrome.storage?.session
    ?.get("tabActiveAt")
    .catch(() => ({}))) as { tabActiveAt?: Record<string, number> } | undefined;
  return { ...(res?.tabActiveAt || {}) };
}

export function markTabActive(tabId: number): Promise<void> {
  return withActivityLock(async () => {
    const map = await readActivityMap();
    map[String(tabId)] = Date.now();
    await chrome.storage?.session?.set({ tabActiveAt: map }).catch(() => {});
  });
}

export function removeTabActivity(tabId: number): Promise<void> {
  return withActivityLock(async () => {
    const map = await readActivityMap();
    if (!map[String(tabId)]) return;
    delete map[String(tabId)];
    await chrome.storage?.session?.set({ tabActiveAt: map }).catch(() => {});
  });
}

function isWhitelisted(url: string, whitelist: string[]): boolean {
  const host = extractDomain(url);
  return whitelist.some((entry) => {
    const clean = entry.trim().toLowerCase();
    if (!clean) return false;
    if (clean.includes("*") || clean.includes("/")) return matchesWildcard(url, clean);
    return host === clean || host.endsWith("." + clean);
  });
}

async function hasUnsavedFormInput(tabId: number): Promise<boolean> {
  if (!(await chrome.permissions.contains({ permissions: ["scripting"] }))) return false;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const els = document.querySelectorAll("input, textarea, select");
        for (const el of els) {
          if (el instanceof HTMLTextAreaElement && el.value.trim().length > 0) return true;
          if (
            el instanceof HTMLInputElement &&
            !["hidden", "submit", "button", "checkbox", "radio", "search"].includes(el.type) &&
            el.value !== el.defaultValue &&
            el.value.trim().length > 0
          ) {
            return true;
          }
        }
        return false;
      },
    });
    return Boolean(results[0]?.result);
  } catch {
    return false;
  }
}

export async function suspendTab(tab: chrome.tabs.Tab, settings: Settings): Promise<boolean> {
  if (tab.id == null) return false;
  const url = tab.pendingUrl || tab.url || "";
  if (!isRestorable(url) || url.startsWith(OWN_PREFIX)) return false;
  if (tab.discarded) return false;

  if (settings.suspendBackend === "suspendPage") {
    const hash = new URLSearchParams({
      url,
      title: tab.title || url,
      favIconUrl: tab.favIconUrl || "",
    });
    await chrome.tabs.update(tab.id, { url: `${SUSPEND_PREFIX}#${hash.toString()}` }).catch(() => {});
    return true;
  }

  const d = await chrome.tabs.discard(tab.id).catch(() => null);
  return Boolean(d);
}

export async function unsuspendIfPlaceholder(tabId: number): Promise<void> {
  const settings = await getSettings();
  if (!settings.autoReloadOnFocus) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.url || !tab.url.startsWith(SUSPEND_PREFIX)) return;
  const hashIdx = tab.url.indexOf("#");
  if (hashIdx < 0) return;
  const params = new URLSearchParams(tab.url.slice(hashIdx + 1));
  const origUrl = params.get("url");
  if (origUrl && isRestorable(origUrl)) {
    await chrome.tabs.update(tabId, { url: origUrl }).catch(() => {});
  }
}

export async function checkIdleTabs(forceNow = false): Promise<number> {
  const settings = await getSettings();
  if (!settings.suspenderEnabled && !forceNow) return 0;

  const tabs = await chrome.tabs.query({ windowType: "normal" });
  let activeCount = tabs.filter((t) => !t.discarded && !(t.url || "").startsWith(SUSPEND_PREFIX)).length;
  const now = Date.now();
  const activity = await withActivityLock(async () => {
    const map = await readActivityMap();
    const liveIds = new Set<string>();
    let changed = false;
    for (const t of tabs) {
      if (t.id == null) continue;
      const key = String(t.id);
      liveIds.add(key);
      if (map[key] == null) {
        map[key] = now;
        changed = true;
      }
    }
    for (const existingKey of Object.keys(map)) {
      if (!liveIds.has(existingKey)) {
        delete map[existingKey];
        changed = true;
      }
    }
    if (changed) {
      await chrome.storage?.session?.set({ tabActiveAt: map }).catch(() => {});
    }
    return map;
  });

  const cutoffMs = settings.suspendAfterMin * 60_000;
  // Sort oldest-lastSeen first (LRU) so recently viewed tabs stay awake when enforcing maxActiveTabsBeforeSuspend
  const candidates = [...tabs].sort((a, b) => {
    const la = a.id != null ? (activity[String(a.id)] ?? now) : now;
    const lb = b.id != null ? (activity[String(b.id)] ?? now) : now;
    return la - lb;
  });

  let suspended = 0;
  for (const t of candidates) {
    if (t.id == null || t.discarded) continue;
    const url = t.pendingUrl || t.url || "";
    if (!isRestorable(url) || url.startsWith(OWN_PREFIX)) continue;
    if (settings.guardActiveTab && t.active) continue;
    if (settings.guardAudibleTabs && t.audible) continue;
    if (settings.guardPinnedTabs && t.pinned) continue;
    if (isWhitelisted(url, settings.suspendWhitelist)) continue;

    const lastSeen = activity[String(t.id)] ?? now;
    const expired = now - lastSeen >= cutoffMs;
    const overTabLimit = activeCount > settings.maxActiveTabsBeforeSuspend;
    if (!forceNow && !overTabLimit && !expired) continue;

    if (settings.guardUnsavedForms && (await hasUnsavedFormInput(t.id))) continue;
    if (await suspendTab(t, settings)) {
      suspended++;
      activeCount = Math.max(0, activeCount - 1);
    }
  }
  return suspended;
}

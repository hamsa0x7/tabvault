import type { Settings } from "./types.ts";

export function formatAgo(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}

export function formatTimestamp(t: number, mode: Settings["timestampMode"] = "absolute"): string {
  if (mode === "relative") return formatAgo(t);
  const d = new Date(t);
  return (
    d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function applyTheme(theme: Settings["theme"]): void {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

export function triggerTextDownload(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

export function faviconSrc(pageUrl: string): string {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", pageUrl);
    u.searchParams.set("size", "32");
    return u.toString();
  }
  return "";
}

/**
 * Opens the Dashboard or focuses an already-open Dashboard tab in the same window.
 */
export async function openOrFocusDashboard(path = "dashboard.html", windowId?: number): Promise<void> {
  const baseUrl = chrome.runtime.getURL("dashboard.html");
  const targetUrl = chrome.runtime.getURL(path);
  let targetWinId = windowId;
  if (targetWinId == null && typeof window === "undefined") {
    const win = await chrome.windows?.getLastFocused?.().catch(() => null);
    targetWinId = win?.id;
  }
  const query: chrome.tabs.QueryInfo =
    targetWinId != null ? { windowId: targetWinId, url: `${baseUrl}*` } : { currentWindow: true, url: `${baseUrl}*` };
  const existing = await chrome.tabs.query(query).catch(() => []);
  if (existing[0]?.id != null) {
    const updateProps: chrome.tabs.UpdateProperties = { active: true };
    if (path !== "dashboard.html" && existing[0].url !== targetUrl) {
      updateProps.url = targetUrl;
    }
    await chrome.tabs.update(existing[0].id, updateProps).catch(() => {});
    if (existing[0].windowId != null) {
      await chrome.windows?.update?.(existing[0].windowId, { focused: true }).catch(() => {});
    }
    return;
  }
  await chrome.tabs.create(targetWinId != null ? { windowId: targetWinId, url: targetUrl } : { url: targetUrl });
}

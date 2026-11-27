import type {
  RecoveryState,
  SavedTab,
  SavedTabGroup,
  SavedWindow,
  SessionSnapshot,
  Settings,
  SnapshotMeta,
  TabGroupColor,
} from "./types.ts";

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;

const VALID_GROUP_COLORS: Set<string> = new Set([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** URLs we can safely reopen in a browser tab. */
export function isRestorable(url: string): boolean {
  if (typeof url !== "string" || url.length > 8192) return false;
  return /^(https?|ftp):\/\//i.test(url);
}

export function isNewTabUrl(url: string): boolean {
  return (
    !url ||
    /^(chrome:\/\/newtab|chrome:\/\/new-tab-page|edge:\/\/newtab|brave:\/\/newtab|about:blank|about:newtab)/i.test(
      url
    )
  );
}

export function isBrowserFeatureUrl(url: string): boolean {
  return /^(chrome|edge|brave|chrome-extension|devtools|view-source):/i.test(url);
}

export function isTrivial(url: string): boolean {
  return isNewTabUrl(url);
}

export function matchesWildcard(url: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const escaped = trimmed.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}$`, "i").test(url);
  } catch {
    return false;
  }
}

export function shouldIgnoreUrl(url: string, settings: Pick<Settings, "ignoreUrlPatterns" | "ignoreNewTabs" | "ignoreBrowserFeatureTabs">): boolean {
  if (!url) return true;
  if (settings.ignoreNewTabs && isNewTabUrl(url)) return true;
  if (settings.ignoreBrowserFeatureTabs && isBrowserFeatureUrl(url)) return true;
  return settings.ignoreUrlPatterns.some((p) => matchesWildcard(url, p));
}

export function normalizeGroupColor(c?: string): TabGroupColor {
  if (c && VALID_GROUP_COLORS.has(c)) return c as TabGroupColor;
  return "grey";
}

export function cleanTab(
  t: Partial<SavedTab> & { pendingUrl?: string; groupId?: number },
  keepTabId = false
): SavedTab {
  const url = String(t.pendingUrl || t.url || "").trim();
  const out: SavedTab = {
    url,
    title: String(t.title || url).slice(0, 500),
  };
  if (keepTabId && typeof t.id === "number") out.id = t.id;
  if (t.pinned) out.pinned = true;
  if (t.active) out.active = true;
  if (t.discarded) out.discarded = true;
  if (typeof t.groupKey === "number" && t.groupKey >= 0) out.groupKey = t.groupKey;
  else if (typeof t.groupId === "number" && t.groupId >= 0) out.groupKey = t.groupId;
  if (t.favIconUrl && t.favIconUrl.length < 2048) out.favIconUrl = t.favIconUrl;
  return out;
}

export function cleanWindow(
  w: Partial<SavedWindow> & { tabs?: Array<Partial<SavedTab> & { pendingUrl?: string; groupId?: number }> },
  filterOpts?: Pick<Settings, "ignoreUrlPatterns" | "ignoreNewTabs" | "ignoreBrowserFeatureTabs" | "compressFavicons">,
  keepTabId = false
): SavedWindow {
  let tabs = (w.tabs || []).map((t) => cleanTab(t, keepTabId)).filter((t) => Boolean(t.url));
  if (filterOpts) {
    tabs = tabs.filter((t) => !shouldIgnoreUrl(t.url, filterOpts));
    if (filterOpts.compressFavicons) {
      tabs = tabs.map((t) => {
        if (t.favIconUrl && t.favIconUrl.startsWith("data:") && t.favIconUrl.length > 512) {
          const copy = { ...t };
          delete copy.favIconUrl;
          return copy;
        }
        return t;
      });
    }
  }
  const out: SavedWindow = { tabs };
  if (w.state) out.state = w.state;
  if (w.left != null) out.left = w.left;
  if (w.top != null) out.top = w.top;
  if (w.width != null) out.width = w.width;
  if (w.height != null) out.height = w.height;
  if (w.focused) out.focused = true;
  if (w.title) out.title = String(w.title).slice(0, 200);
  if (w.groups && w.groups.length) {
    const usedKeys = new Set(tabs.map((t) => t.groupKey).filter((k): k is number => k != null));
    const groups: SavedTabGroup[] = w.groups
      .filter((g) => usedKeys.has(g.id))
      .map((g) => ({
        id: g.id,
        title: String(g.title || "").slice(0, 120),
        color: normalizeGroupColor(g.color),
        collapsed: Boolean(g.collapsed),
      }));
    if (groups.length) out.groups = groups;
  }
  return out;
}

export function countTabs(windows: SavedWindow[]): number {
  return windows.reduce((sum, w) => sum + w.tabs.length, 0);
}

export function signature(windows: SavedWindow[]): string {
  return windows
    .map((w) =>
      w.tabs
        .map((t) => `${t.pinned ? "*" : ""}${t.groupKey ?? ""}:${t.url}`)
        .join("\n")
    )
    .join("\n--\n");
}

export function hasContent(windows: SavedWindow[]): boolean {
  return windows.some((w) => w.tabs.some((t) => !isTrivial(t.url)));
}

export function metaOf(s: SessionSnapshot): SnapshotMeta {
  return {
    id: s.id,
    t: s.t,
    updatedAt: s.updatedAt || s.t,
    lastOpenedAt: s.lastOpenedAt,
    kind: s.kind,
    name: s.name || "",
    runId: s.runId || "",
    src: s.src,
    deviceName: s.deviceName,
    tags: s.tags,
    startupRegistered: s.startupRegistered,
    w: s.windows.length,
    n: countTabs(s.windows),
  };
}

export interface RetentionLimits {
  historyDays: number | null;
  autoSnapshots: number | null;
  thinAfter2hHourly: boolean;
  thinAfter48hDaily: boolean;
  maxWindowCloseSaves: number;
  maxBrowserExitSaves: number;
  purgeUnnamedClosedDays: number;
}

export function effectiveLimits(settings: Settings): RetentionLimits {
  let historyDays: number | null = 90;
  if (settings.historyDays === "30") historyDays = 30;
  else if (settings.historyDays === "90") historyDays = 90;
  else if (settings.historyDays === "365") historyDays = 365;
  else if (settings.historyDays === "forever") historyDays = null;

  return {
    historyDays,
    autoSnapshots: settings.maxAutoSnapshots,
    thinAfter2hHourly: settings.thinAfter2hHourly,
    thinAfter48hDaily: settings.thinAfter48hDaily,
    maxWindowCloseSaves: settings.maxWindowCloseSaves,
    maxBrowserExitSaves: settings.maxBrowserExitSaves,
    purgeUnnamedClosedDays: settings.purgeUnnamedClosedDays,
  };
}

/**
 * Compute snapshot IDs to prune. Named & imported & startup-registered snapshots are never auto-pruned.
 */
export function pruneIds(metas: SnapshotMeta[], now: number, limits: RetentionLimits): string[] {
  const toDelete = new Set<string>();

  // 1. Periodic auto-saves with 2h/48h thinning
  const autos = metas.filter((m) => m.kind === "auto" && !m.startupRegistered).sort((a, b) => b.t - a.t);
  const keep = new Set<string>();
  const seenBuckets = new Set<string>();
  for (const m of autos) {
    const age = now - m.t;
    if (limits.historyDays != null && age > limits.historyDays * DAY) continue;
    let bucket: string | null = null;
    if (limits.thinAfter2hHourly && age >= 2 * HOUR && age < 48 * HOUR) {
      bucket = "h" + Math.floor(m.t / HOUR);
    } else if (limits.thinAfter48hDaily && age >= 48 * HOUR) {
      bucket = "d" + Math.floor(m.t / DAY);
    }
    if (bucket) {
      if (seenBuckets.has(bucket)) continue;
      seenBuckets.add(bucket);
    }
    keep.add(m.id);
  }
  let keptAutos = autos.filter((m) => keep.has(m.id));
  if (limits.autoSnapshots != null && keptAutos.length > limits.autoSnapshots) {
    keptAutos = keptAutos.slice(0, limits.autoSnapshots);
  }
  const keepAutoIds = new Set(keptAutos.map((m) => m.id));
  for (const m of autos) {
    if (!keepAutoIds.has(m.id)) toDelete.add(m.id);
  }

  // 2. Window-close FIFO limit & optional unnamed purge
  const winCloses = metas.filter((m) => m.kind === "windowClose" && !m.startupRegistered).sort((a, b) => b.t - a.t);
  winCloses.forEach((m, idx) => {
    const expired =
      limits.purgeUnnamedClosedDays > 0 &&
      !m.name &&
      now - m.t > limits.purgeUnnamedClosedDays * DAY;
    if (idx >= limits.maxWindowCloseSaves || expired) {
      toDelete.add(m.id);
    }
  });

  // 3. Browser-exit FIFO limit
  const exits = metas.filter((m) => m.kind === "browserExit" && !m.startupRegistered).sort((a, b) => b.t - a.t);
  exits.forEach((m, idx) => {
    if (idx >= limits.maxBrowserExitSaves) toDelete.add(m.id);
  });

  return [...toDelete];
}

/**
 * Pick the richest snapshot from the most recent previous browser run still current within 3s of its end.
 */
export function recoveryCandidate(
  metas: SnapshotMeta[],
  currentRunId: string,
  beat: { runId: string; t: number } | null = null
): SnapshotMeta | null {
  const autos = metas.filter(
    (m) => (m.kind === "auto" || m.kind === "browserExit") && m.runId && m.runId !== "imported" && m.runId !== currentRunId
  );
  if (!autos.length) return null;
  const latest = autos.reduce((a, b) => (b.t > a.t ? b : a));
  const prev = autos.filter((m) => m.runId === latest.runId).sort((a, b) => a.t - b.t);
  const last = prev[prev.length - 1];
  const end = Math.max(last.t, beat && beat.runId === latest.runId ? beat.t : 0);
  let best: SnapshotMeta | null = null;
  prev.forEach((m, i) => {
    const until = i < prev.length - 1 ? prev[i + 1].t : Infinity;
    if (until >= end - 3000 && (!best || m.n >= best.n)) best = m;
  });
  return best;
}

export function coverage(snapWindows: SavedWindow[], openWindows: SavedWindow[]): number {
  const want = new Set(snapWindows.flatMap((w) => w.tabs.map((t) => t.url)).filter(isRestorable));
  if (!want.size) return 1;
  const open = new Set(openWindows.flatMap((w) => w.tabs.map((t) => t.url)));
  let hit = 0;
  for (const u of want) if (open.has(u)) hit++;
  return hit / want.size;
}

export function missingCount(snapWindows: SavedWindow[], openWindows: SavedWindow[]): number {
  const want = new Set(snapWindows.flatMap((w) => w.tabs.map((t) => t.url)).filter(isRestorable));
  const open = new Set(openWindows.flatMap((w) => w.tabs.map((t) => t.url)));
  let miss = 0;
  for (const u of want) if (!open.has(u)) miss++;
  return miss;
}

export function shouldOffer(cov: number, missing: number, covThreshold = 0.5, missingMin = 5): boolean {
  return cov < covThreshold || (missing >= missingMin && cov < 0.9);
}

export function buildRecoveryState(
  cand: SnapshotMeta,
  snapWindows: SavedWindow[],
  openWindows: SavedWindow[],
  settings: Pick<Settings, "recoveryCoverageThreshold" | "recoveryMissingMin">
): RecoveryState | null {
  const cov = coverage(snapWindows, openWindows);
  const missing = missingCount(snapWindows, openWindows);
  if (!shouldOffer(cov, missing, settings.recoveryCoverageThreshold, settings.recoveryMissingMin)) {
    return null;
  }
  return {
    id: cand.id,
    t: cand.t,
    w: cand.w,
    n: cand.n,
    missing,
    partial: cov >= settings.recoveryCoverageThreshold,
    detectedAt: Date.now(),
    coverage: cov,
  };
}

/** Deduplicate tabs inside windows (preserving first occurrence order). */
export function deduplicateWindows(windows: SavedWindow[]): { windows: SavedWindow[]; removed: number } {
  const seen = new Set<string>();
  let removed = 0;
  const next = windows
    .map((w) => {
      const tabs = w.tabs.filter((t) => {
        if (seen.has(t.url)) {
          removed++;
          return false;
        }
        seen.add(t.url);
        return true;
      });
      return { ...w, tabs };
    })
    .filter((w) => w.tabs.length > 0);
  return { windows: next, removed };
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 40);
  }
}

export function formatTabDisplayUrl(url: string, mode: Settings["urlDisplayMode"]): string {
  if (mode === "none") return "";
  if (mode === "full") return url;
  if (mode === "domain") return extractDomain(url);
  // abbreviated
  try {
    const u = new URL(url);
    const path = u.pathname === "/" ? "" : u.pathname.slice(0, 28) + (u.pathname.length > 28 ? "…" : "");
    return u.hostname.replace(/^www\./, "") + path;
  } catch {
    return url.slice(0, 45);
  }
}

/** Fraction of unique restorable URLs in `savedUrls` that are already present in `openUrls`. */
export function windowOverlapRatio(savedUrls: string[], openUrls: string[]): number {
  const want = new Set(savedUrls.filter(isRestorable));
  if (want.size === 0) return 0;
  const open = new Set(openUrls);
  let hit = 0;
  for (const u of want) if (open.has(u)) hit++;
  return hit / want.size;
}

/** Find duplicate open tab IDs across windows, keeping the first (or pinned/active) occurrence. */
export function findDuplicateOpenTabIds(
  windows: Array<{ tabs: Array<{ id?: number; url?: string; pendingUrl?: string; pinned?: boolean; active?: boolean }> }>
): number[] {
  const allTabs = windows.flatMap((w) => w.tabs);
  // Sort so pinned and active tabs are kept first
  const ordered = allTabs
    .map((t, idx) => ({ t, idx }))
    .sort((a, b) => {
      const score = (x: typeof a.t) => (x.pinned ? 2 : 0) + (x.active ? 1 : 0);
      return score(b.t) - score(a.t) || a.idx - b.idx;
    });

  const seen = new Set<string>();
  const toClose: number[] = [];
  for (const { t } of ordered) {
    const u = t.pendingUrl || t.url || "";
    if (!u || !isRestorable(u)) continue;
    if (seen.has(u)) {
      if (t.id != null) toClose.push(t.id);
    } else {
      seen.add(u);
    }
  }
  return toClose;
}

/** Find an exact or close (>=70% URL overlap) named Saved Session matching `windows`. */
export function findMatchingSavedSession(
  windows: SavedWindow[],
  existing: SessionSnapshot[]
): { exact: SessionSnapshot | null; closest: { snap: SessionSnapshot; overlap: number } | null } {
  const sig = signature(windows);
  const named = existing.filter((s) => s.kind === "named");
  const exact = named.find((s) => s.sig === sig) || null;
  if (exact) return { exact, closest: null };

  const currentUrls = windows.flatMap((w) => w.tabs.map((t) => t.url)).filter(isRestorable);
  if (currentUrls.length === 0) return { exact: null, closest: null };

  let best: { snap: SessionSnapshot; overlap: number } | null = null;
  for (const snap of named) {
    const snapUrls = snap.windows.flatMap((w) => w.tabs.map((t) => t.url)).filter(isRestorable);
    const forward = windowOverlapRatio(currentUrls, snapUrls);
    const backward = windowOverlapRatio(snapUrls, currentUrls);
    const overlap = Math.min(forward, backward);
    if (overlap >= 0.7 && (!best || overlap > best.overlap)) {
      best = { snap, overlap };
    }
  }
  return { exact: null, closest: best };
}

/** Returns true if a session or collection has not been opened/updated in `days` days (default 30). */
export function isStaleItem(
  item: { lastOpenedAt?: number; updatedAt?: number; t?: number },
  now = Date.now(),
  days = 30
): boolean {
  const ref = item.lastOpenedAt || item.updatedAt || item.t || now;
  return now - ref >= days * DAY;
}

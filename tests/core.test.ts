import { describe, expect, it } from "vitest";
import {
  DAY,
  HOUR,
  buildRecoveryState,
  cleanWindow,
  coverage,
  deduplicateWindows,
  effectiveLimits,
  extractDomain,
  findDuplicateOpenTabIds,
  findMatchingSavedSession,
  formatTabDisplayUrl,
  hasContent,
  isStaleItem,
  matchesWildcard,
  missingCount,
  pruneIds,
  recoveryCandidate,
  shouldIgnoreUrl,
  shouldOffer,
  signature,
  windowOverlapRatio,
  uid,
} from "../src/shared/core.ts";
import { sanitizeSettingsPatch } from "../src/shared/db.ts";
import { DEFAULT_SETTINGS } from "../src/shared/defaults.ts";
import type { SavedWindow, SessionSnapshot, SnapshotMeta } from "../src/shared/types.ts";

describe("core window filtering and cleaning", () => {
  it("filters new tabs, browser feature URLs, and wildcard ignore patterns", () => {
    const win: SavedWindow = {
      tabs: [
        { url: "https://example.com/docs", title: "Docs", pinned: true },
        { url: "chrome://newtab/", title: "New Tab" },
        { url: "chrome://settings/privacy", title: "Settings" },
        { url: "https://mail.internal.corp/inbox", title: "Mail" },
      ],
    };
    const cleaned = cleanWindow(win, {
      ignoreUrlPatterns: ["https://*.internal.corp/*"],
      ignoreNewTabs: true,
      ignoreBrowserFeatureTabs: false,
      compressFavicons: true,
    });
    expect(cleaned.tabs.map((t) => t.url)).toEqual([
      "https://example.com/docs",
      "chrome://settings/privacy",
    ]);
    expect(cleaned.tabs[0].pinned).toBe(true);
  });

  it("matches wildcard rules case-insensitively and ignores invalid inputs", () => {
    expect(matchesWildcard("HTTPS://GitHub.com/user/repo", "https://github.com/*")).toBe(true);
    expect(
      shouldIgnoreUrl("brave://newtab/", {
        ignoreNewTabs: true,
        ignoreBrowserFeatureTabs: false,
        ignoreUrlPatterns: [],
      })
    ).toBe(true);
  });

  it("drops unused tab groups and compresses oversized data-URI favicons", () => {
    const bigDataUri = "data:image/png;base64," + "A".repeat(600);
    const cleaned = cleanWindow(
      {
        groups: [
          { id: 1, title: "Used", color: "blue", collapsed: false },
          { id: 2, title: "Orphaned", color: "red", collapsed: true },
        ],
        tabs: [
          { url: "https://a.test", title: "A", groupKey: 1, favIconUrl: bigDataUri },
          { url: "chrome://newtab", title: "NT", groupKey: 2 },
        ],
      },
      {
        ignoreUrlPatterns: [],
        ignoreNewTabs: true,
        ignoreBrowserFeatureTabs: false,
        compressFavicons: true,
      }
    );
    expect(cleaned.groups).toEqual([{ id: 1, title: "Used", color: "blue", collapsed: false }]);
    expect(cleaned.tabs[0].favIconUrl).toBeUndefined();
  });

  it("deduplicates tabs across windows while preserving first occurrence", () => {
    const res = deduplicateWindows([
      {
        tabs: [
          { url: "https://one.test", title: "One" },
          { url: "https://two.test", title: "Two" },
        ],
      },
      {
        tabs: [
          { url: "https://one.test", title: "One Dup" },
          { url: "https://three.test", title: "Three" },
        ],
      },
    ]);
    expect(res.removed).toBe(1);
    expect(res.windows.map((w) => w.tabs.map((t) => t.url))).toEqual([
      ["https://one.test", "https://two.test"],
      ["https://three.test"],
    ]);
  });

  it("formats domain and abbreviated URLs cleanly", () => {
    expect(extractDomain("https://www.developer.mozilla.org/en-US/docs")).toBe("developer.mozilla.org");
    expect(formatTabDisplayUrl("https://www.github.com/features/actions", "domain")).toBe("github.com");
    expect(formatTabDisplayUrl("https://github.com/a", "full")).toBe("https://github.com/a");
    expect(formatTabDisplayUrl("https://github.com/a", "none")).toBe("");
  });
});

describe("retention pruning & crash recovery", () => {
  it("never prunes named, imported, or startup-registered snapshots while thinning old autosaves", () => {
    const now = 1_700_000_000_000;
    const metas: SnapshotMeta[] = [
      { id: "a-recent-1", t: now - 10 * 60_000, updatedAt: now, kind: "auto", name: "", runId: "r1", w: 1, n: 5 },
      { id: "a-recent-2", t: now - 20 * 60_000, updatedAt: now, kind: "auto", name: "", runId: "r1", w: 1, n: 5 },
      { id: "a-hour-keep", t: now - 3 * HOUR, updatedAt: now, kind: "auto", name: "", runId: "r1", w: 1, n: 5 },
      { id: "a-hour-drop", t: now - 3 * HOUR - 10 * 60_000, updatedAt: now, kind: "auto", name: "", runId: "r1", w: 1, n: 5 },
      { id: "a-old-drop", t: now - 120 * DAY, updatedAt: now, kind: "auto", name: "", runId: "r0", w: 1, n: 5 },
      { id: "named-old", t: now - 400 * DAY, updatedAt: now, kind: "named", name: "Keep Me", runId: "r0", w: 2, n: 20 },
      { id: "startup-auto", t: now - 400 * DAY, updatedAt: now, kind: "auto", name: "", runId: "r0", startupRegistered: true, w: 1, n: 4 },
    ];
    const pruned = new Set(pruneIds(metas, now, effectiveLimits(DEFAULT_SETTINGS)));
    expect(pruned.has("a-recent-1")).toBe(false);
    expect(pruned.has("a-recent-2")).toBe(false);
    expect(pruned.has("a-hour-keep")).toBe(false);
    expect(pruned.has("a-hour-drop")).toBe(true);
    expect(pruned.has("a-old-drop")).toBe(true);
    expect(pruned.has("named-old")).toBe(false);
    expect(pruned.has("startup-auto")).toBe(false);
  });

  it("picks the richest pre-shrink recovery candidate and computes missing coverage", () => {
    const now = 1_700_000_000_000;
    const metas: SnapshotMeta[] = [
      { id: "prev-rich", t: now - 60_000, updatedAt: now, kind: "auto", name: "", runId: "oldRun", w: 2, n: 18 },
      { id: "prev-shrunk", t: now - 58_000, updatedAt: now, kind: "auto", name: "", runId: "oldRun", w: 1, n: 2 },
      { id: "curr", t: now, updatedAt: now, kind: "auto", name: "", runId: "newRun", w: 1, n: 1 },
    ];
    const cand = recoveryCandidate(metas, "newRun", { runId: "oldRun", t: now - 58_000 });
    expect(cand?.id).toBe("prev-rich");

    const snapWins: SavedWindow[] = [
      {
        tabs: Array.from({ length: 10 }, (_, i) => ({
          url: `https://tab${i}.example.com`,
          title: `Tab ${i}`,
        })),
      },
    ];
    const openWins: SavedWindow[] = [
      { tabs: [{ url: "https://tab0.example.com", title: "Tab 0" }] },
    ];
    const cov = coverage(snapWins, openWins);
    const miss = missingCount(snapWins, openWins);
    expect(cov).toBeCloseTo(0.1);
    expect(miss).toBe(9);
    expect(shouldOffer(cov, miss)).toBe(true);
    const rec = buildRecoveryState(cand!, snapWins, openWins, DEFAULT_SETTINGS);
    expect(rec?.missing).toBe(9);
    expect(hasContent(snapWins)).toBe(true);
    expect(signature(openWins)).toContain("https://tab0.example.com");
  });
});

describe("smart save, restore matching, and duplicate tab detection", () => {
  it("computes window URL overlap ratio accurately", () => {
    const saved = ["https://a.test", "https://b.test", "https://c.test", "https://d.test"];
    const open = ["https://a.test", "https://b.test", "https://c.test", "https://other.test"];
    expect(windowOverlapRatio(saved, open)).toBeCloseTo(0.75);
    expect(windowOverlapRatio([], open)).toBe(0);
  });

  it("finds duplicate open tab IDs while keeping pinned and active tabs", () => {
    const dups = findDuplicateOpenTabIds([
      {
        tabs: [
          { id: 1, url: "https://a.test", pinned: false, active: false },
          { id: 2, url: "https://a.test", pinned: true, active: false },
          { id: 3, url: "https://b.test", pinned: false, active: true },
        ],
      },
      {
        tabs: [
          { id: 4, url: "https://b.test", pinned: false, active: false },
        ],
      },
    ]);
    expect(dups).toEqual([1, 4]);
  });

  it("detects exact and close matching named sessions", () => {
    const baseWins: SavedWindow[] = [
      {
        tabs: [
          { url: "https://a.test", title: "A" },
          { url: "https://b.test", title: "B" },
          { url: "https://c.test", title: "C" },
          { url: "https://d.test", title: "D" },
        ],
      },
    ];
    const existing: SessionSnapshot[] = [
      {
        id: "s1",
        t: 1000,
        updatedAt: 1000,
        kind: "named",
        name: "Work",
        runId: "",
        windows: baseWins,
        windowCount: 1,
        tabCount: 4,
        sig: signature(baseWins),
      },
    ];

    expect(findMatchingSavedSession(baseWins, existing).exact?.id).toBe("s1");

    const extendedWins: SavedWindow[] = [
      {
        tabs: [
          ...baseWins[0].tabs,
          { url: "https://e.test", title: "E" },
        ],
      },
    ];
    const close = findMatchingSavedSession(extendedWins, existing);
    expect(close.exact).toBeNull();
    expect(close.closest?.snap.id).toBe("s1");
    expect(close.closest?.overlap).toBeCloseTo(0.8);
  });

  it("flags sessions and collections untouched for 30+ days as stale", () => {
    const now = 1_700_000_000_000;
    expect(isStaleItem({ lastOpenedAt: now - 31 * DAY, t: now - 40 * DAY }, now)).toBe(true);
    expect(isStaleItem({ lastOpenedAt: now - 5 * DAY, t: now - 40 * DAY }, now)).toBe(false);
    expect(isStaleItem({ updatedAt: now - 30 * DAY }, now)).toBe(true);
  });

  it("sanitizes imported settings patches and rejects invalid types or unknown keys", () => {
    const malformed = JSON.parse(
      '{"autoSaveEnabled":"not-a-bool","theme":"neon","ignoreUrlPatterns":[" https://bank.test/* ", 123],"bypassConfirm":{"deleteSession":true,"evil":"yes"},"unknownKey":42,"__proto__":{"polluted":true}}'
    );
    const clean = sanitizeSettingsPatch(malformed);
    expect(clean.autoSaveEnabled).toBeUndefined();
    expect(clean.theme).toBeUndefined();
    expect(clean.ignoreUrlPatterns).toEqual(["https://bank.test/*"]);
    expect(clean.bypassConfirm).toEqual({ deleteSession: true });
    expect((clean as Record<string, unknown>).unknownKey).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(sanitizeSettingsPatch([1, 2, 3])).toEqual({});
  });

  it("generates unique IDs via uid()", () => {
    const ids = new Set(Array.from({ length: 100 }, () => uid()));
    expect(ids.size).toBe(100);
  });
});

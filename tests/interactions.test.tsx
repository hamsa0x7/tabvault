// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "../src/shared/defaults.ts";
import type {
  AppStateSummary,
  CollectionRecord,
  SavedWindow,
  SearchHit,
  Settings,
  SnapshotMeta,
} from "../src/shared/types.ts";

// Shared mutable test state for deterministic RPC responses
let mockSettings: Settings;
let mockOpenWindows: SavedWindow[];
let mockSnapshots: SnapshotMeta[];
let mockCollections: CollectionRecord[];
let mockState: AppStateSummary;
let mockDownloadsGranted = false;
const rpcCalls: Array<{ cmd: string; payload?: Record<string, unknown> }> = [];

const sendBgMock = vi.fn(async (cmd: string, payload: Record<string, unknown> = {}) => {
  rpcCalls.push({ cmd, payload });
  switch (cmd) {
    case "state":
      return mockState;
    case "getOpenWindows":
      return mockOpenWindows;
    case "listSnapshots":
      return mockSnapshots;
    case "listCollections":
      return mockCollections;
    case "getSnapshot":
      return null;
    case "checkRecoveryNow":
      return mockState.recovery;
    case "checkSaveMatch":
      return { exact: null, closest: null };
    case "saveNamed": {
      const meta: SnapshotMeta = {
        id: `snap-${mockSnapshots.length + 1}`,
        t: Date.now(),
        updatedAt: Date.now(),
        kind: "named",
        name: String(payload.name || "Saved Session"),
        runId: "r1",
        w: 1,
        n: 2,
      };
      mockSnapshots = [meta, ...mockSnapshots];
      mockState = {
        ...mockState,
        counts: { ...mockState.counts, named: mockState.counts.named + 1 },
      };
      return meta;
    }
    case "saveWindowAsSpace": {
      const col: CollectionRecord = {
        id: `col-${mockCollections.length + 1}`,
        parentFolderId: null,
        kind: "group",
        title: "Window Collection",
        color: "blue",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        order: 0,
        tags: [],
        items: [
          {
            id: "item-1",
            url: "https://example.com",
            title: "Example",
            addedAt: Date.now(),
          },
        ],
      };
      mockCollections = [col, ...mockCollections];
      mockState = {
        ...mockState,
        counts: { ...mockState.counts, collections: mockState.counts.collections + 1 },
      };
      return col;
    }
    case "collapse":
      return { capturedCount: 2, closedCount: payload.closeTabs === false ? 0 : 2, collectionId: "col-1" };
    case "addTabsToCollection":
      return {
        collection: {
          id: String(payload.collectionId || "col-new"),
          parentFolderId: null,
          kind: "group",
          title: "Dropped Tabs",
          color: "blue",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          order: 0,
          tags: [],
          items: [],
        },
        added: Array.isArray(payload.tabs) ? payload.tabs.length : 1,
      };
    case "deleteSnapshots": {
      const ids = (payload.ids as string[]) || [];
      mockSnapshots = mockSnapshots.filter((s) => !ids.includes(s.id));
      return true;
    }
    case "setSettings": {
      const patch = (payload.patch as Partial<Settings>) || {};
      mockSettings = { ...mockSettings, ...patch };
      mockState = { ...mockState, settings: mockSettings };
      return mockSettings;
    }
    case "searchAll": {
      const q = String(payload.q || "").toLowerCase();
      const hits: SearchHit[] = [];
      for (const w of mockOpenWindows) {
        for (const t of w.tabs) {
          if (t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q)) {
            hits.push({
              source: "open",
              id: String(w.id ?? 1),
              parentTitle: "Open Window",
              t: Date.now(),
              kind: "open",
              tab: t,
              windowId: w.id,
              tabId: t.id,
            });
          }
        }
      }
      return hits;
    }
    case "focusOpenTab":
    case "openUrl":
    case "dedupeOpenTabs":
      return cmd === "dedupeOpenTabs" ? { closed: 1 } : true;
    case "driveSyncNow":
      mockState = { ...mockState, driveE2EUnlocked: true, lastSyncAt: Date.now(), lastSyncError: null };
      return { uploaded: 2, imported: 0 };
    case "storageStats":
      return { extensionLocalBytes: 1024, indexedDbBytes: 2048 };
    case "listLocalBackups":
      return { granted: mockDownloadsGranted, files: [] };
    case "getDriveBackupInfo":
      return { exists: false };
    default:
      return true;
  }
});

vi.mock("../src/shared/rpc.ts", () => ({
  sendBg: (...args: [string, Record<string, unknown>?]) => sendBgMock(...args),
}));

import { BackupPermissionBanner, HeaderAccountButton } from "../src/components/HeaderExtras.tsx";
import { OnboardingCard } from "../src/components/OnboardingCard.tsx";
import { DashboardApp } from "../src/pages/dashboard/DashboardApp.tsx";
import { OptionsApp } from "../src/pages/options/OptionsApp.tsx";
import { PopupApp } from "../src/pages/popup/PopupApp.tsx";
import { SidePanelApp } from "../src/pages/sidepanel/SidePanelApp.tsx";
import { useOnboarding } from "../src/shared/onboarding.ts";

const permissionsRequestMock = vi.fn(async () => {
  mockDownloadsGranted = true;
  return true;
});

function installGlobals() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }

  window.confirm = vi.fn(() => true);

  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    },
    runtime: {
      getURL: (p: string) => `chrome-extension://test-id/${p}`,
      sendMessage: vi.fn(async () => ({ ok: true, r: true })),
      getContexts: vi.fn(async () => []),
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    tabs: {
      create: vi.fn(async () => ({ id: 99 })),
      query: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
      onCreated: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    windows: {
      update: vi.fn(async () => ({})),
      onFocusChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    permissions: {
      contains: vi.fn(async ({ permissions }: { permissions: string[] }) => {
        if (permissions.includes("downloads")) return mockDownloadsGranted;
        return false;
      }),
      request: permissionsRequestMock,
      onAdded: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  rpcCalls.length = 0;
  sendBgMock.mockClear();
  permissionsRequestMock.mockClear();
  mockDownloadsGranted = false;

  mockSettings = { ...DEFAULT_SETTINGS };
  mockOpenWindows = [
    {
      id: 101,
      focused: true,
      tabs: [
        { id: 1, url: "https://github.com/org/repo", title: "GitHub Repo", active: true },
        { id: 2, url: "https://docs.example.com/api", title: "API Docs" },
        { id: 3, url: "https://docs.example.com/api", title: "API Docs Duplicate" },
      ],
    },
  ];
  mockSnapshots = [
    {
      id: "auto-1",
      t: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
      kind: "auto",
      name: "Auto Snapshot 1",
      runId: "r1",
      w: 1,
      n: 3,
    },
    {
      id: "auto-2",
      t: Date.now() - 120_000,
      updatedAt: Date.now() - 120_000,
      kind: "auto",
      name: "Auto Snapshot 2",
      runId: "r1",
      w: 1,
      n: 2,
    },
  ];
  mockCollections = [];
  mockState = {
    settings: mockSettings,
    lastSaveAt: Date.now() - 30_000,
    lastBackupAt: null,
    lastBackupError: null,
    lastSyncAt: null,
    lastSyncError: null,
    driveConnected: false,
    driveEmail: null,
    driveE2EUnlocked: true,
    scriptingPermissionGranted: false,
    recovery: null,
    counts: {
      auto: 2,
      named: 0,
      collections: 0,
      openWindows: 1,
      openTabs: 3,
      sleepingTabs: 0,
    },
  };

  installGlobals();
});

afterEach(() => {
  cleanup();
});

describe("OnboardingCard & useOnboarding longitudinal interactions", () => {
  function OnboardingHarness() {
    const [namedCount, setNamedCount] = React.useState(0);
    const [collectionCount, setCollectionCount] = React.useState(0);
    const [suspenderEnabled, setSuspenderEnabled] = React.useState(false);
    const onboarding = useOnboarding({ namedCount, collectionCount, suspenderEnabled });

    if (!onboarding.shouldShow) return <div data-testid="onboarding-hidden">Hidden</div>;
    return (
      <OnboardingCard
        variant="compact"
        autoSaveIntervalMin={5}
        progress={onboarding.progress}
        onDismiss={onboarding.dismiss}
        steps={[
          {
            id: "save",
            title: "Save your first named session",
            description: "Capture open windows so you can restore them anytime.",
            done: onboarding.progress.savedSession,
            actionLabel: "Save",
            onAction: () => setNamedCount(1),
          },
          {
            id: "col",
            title: "Turn a window into a Collection",
            description: "Group a window's tabs into a reusable workspace.",
            done: onboarding.progress.createdCollection,
            actionLabel: "Save Window",
            onAction: () => setCollectionCount(1),
          },
          {
            id: "sleep",
            title: "Enable Tab Sleep (save RAM)",
            description: "Automatically discard idle tabs to keep Chrome fast.",
            done: onboarding.progress.tabSleepEnabled,
            actionLabel: "Enable",
            onAction: () => setSuspenderEnabled(true),
          },
          {
            id: "guide",
            title: "Explore Dashboard & shortcuts",
            description: "Search all tabs with Ctrl+K or type st in the address bar.",
            done: onboarding.progress.exploredGuide,
            actionLabel: "Open",
            onAction: () => onboarding.markGuideExplored(),
          },
        ]}
      />
    );
  }

  it("shows descriptions & tooltips in compact mode and does NOT close prematurely after step 2", async () => {
    render(<OnboardingHarness />);

    expect(screen.getByText("0/4")).toBeTruthy();
    expect(screen.getByText("Capture open windows so you can restore them anytime.")).toBeTruthy();
    const saveBtn = screen.getByRole("button", { name: "Save" });
    expect(saveBtn.getAttribute("data-tip")).toBe("Capture open windows so you can restore them anytime.");

    // Complete step 1
    fireEvent.click(saveBtn);
    expect(screen.getByText("1/4")).toBeTruthy();

    // Complete step 2 — previously caused premature closure!
    fireEvent.click(screen.getByRole("button", { name: "Save Window" }));
    expect(screen.getByText("2/4")).toBeTruthy();
    expect(screen.queryByTestId("onboarding-hidden")).toBeNull();

    // Complete step 3 & step 4
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(screen.getByText("3/4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("4/4")).toBeTruthy();

    // Clicking Done dismisses
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByTestId("onboarding-hidden")).toBeTruthy();
  });
});

describe("SidePanelApp interactions", () => {
  it("supports saving session, non-destructive To Collection, confirm & Close, Tab Sleep onboarding, and search", async () => {
    render(<SidePanelApp />);

    await waitFor(() => expect(screen.getByText("GitHub Repo")).toBeTruthy());

    // 1. Save named session
    const nameInput = screen.getByLabelText("Session name (optional)");
    fireEvent.change(nameInput, { target: { value: "Morning Work" } });
    fireEvent.click(screen.getByText("Save All"));
    await waitFor(() =>
      expect(rpcCalls.some((c) => c.cmd === "saveNamed" && c.payload?.name === "Morning Work")).toBe(true)
    );

    // 2. Non-destructive To Collection (keeps tabs open)
    fireEvent.click(screen.getByText("To Collection"));
    await waitFor(() => expect(rpcCalls.some((c) => c.cmd === "saveWindowAsSpace")).toBe(true));

    // 3. Destructive & Close asks confirmation first
    fireEvent.click(screen.getByText("& Close"));
    const confirmDialog = await screen.findByRole("alertdialog", { name: "Confirm closing window" });
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "Confirm & Close" }));
    await waitFor(() =>
      expect(rpcCalls.some((c) => c.cmd === "collapse" && c.payload?.scope === "currentWindow")).toBe(true)
    );

    // 4. Onboarding Tab Sleep quick-enable
    const enableSleepBtn = screen.getByRole("button", { name: "Enable" });
    fireEvent.click(enableSleepBtn);
    await waitFor(() =>
      expect(
        rpcCalls.some(
          (c) => c.cmd === "setSettings" && (c.payload?.patch as Partial<Settings>)?.suspenderEnabled === true
        )
      ).toBe(true)
    );

    // 5. Search & keyboard Enter to focus tab
    const searchInput = screen.getByLabelText("Search open, saved sessions, and collections");
    fireEvent.change(searchInput, { target: { value: "GitHub" } });
    await waitFor(() => expect(rpcCalls.some((c) => c.cmd === "searchAll" && c.payload?.q === "GitHub")).toBe(true));
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(rpcCalls.some((c) => c.cmd === "focusOpenTab")).toBe(true));
  });
});

describe("PopupApp interactions", () => {
  it("renders tabs, saves a session, and switches tabs", async () => {
    render(<PopupApp />);

    await waitFor(() => expect(screen.getByText(/Window 1/i)).toBeTruthy());

    fireEvent.click(screen.getByText("Save All"));
    await waitFor(() => expect(rpcCalls.some((c) => c.cmd === "saveNamed")).toBe(true));
    await waitFor(() => expect(screen.getByText("Auto Snapshot 1")).toBeTruthy());

    fireEvent.click(screen.getByText(/Collections/i));
    await waitFor(() => expect(screen.getByText(/No collections yet/i)).toBeTruthy());
  });
});

describe("DashboardApp interactions", () => {
  it("supports cross-pane drag-and-drop to Collections and bulk History deletion", async () => {
    render(<DashboardApp />);

    await waitFor(() => expect(screen.getByText("GitHub Repo")).toBeTruthy());

    // 1. Non-destructive Save to Collection button on open window
    fireEvent.click(screen.getByText("Save to Collection"));
    await waitFor(() => expect(rpcCalls.some((c) => c.cmd === "saveWindowAsSpace")).toBe(true));

    // 2. Cross-pane drag of open tab row onto Collections sidebar nav item
    const tabRow = screen.getByText("GitHub Repo").closest("[draggable='true']") as HTMLElement;
    expect(tabRow).toBeTruthy();
    const dataStore: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: "copy",
      types: ["application/x-tabvault-tab"],
      setData: (type: string, val: string) => {
        dataStore[type] = val;
      },
      getData: (type: string) => dataStore[type] || "",
    };
    fireEvent.dragStart(tabRow, { dataTransfer });
    const collectionsNav = screen.getByRole("button", { name: /Collections/i });
    fireEvent.dragOver(collectionsNav, { dataTransfer });
    fireEvent.drop(collectionsNav, { dataTransfer });
    await waitFor(() => expect(rpcCalls.some((c) => c.cmd === "addTabsToCollection")).toBe(true));

    // 3. Navigate to History and bulk-select + delete 2 auto-save snapshots
    fireEvent.click(screen.getByRole("button", { name: /History/i }));
    await waitFor(() => expect(screen.getByText("Auto Snapshot 1")).toBeTruthy());

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Auto Snapshot 1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Auto Snapshot 2" }));
    expect(screen.getByText("2 selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete 2 Sessions" }));
    await waitFor(() =>
      expect(
        rpcCalls.some(
          (c) =>
            c.cmd === "deleteSnapshots" &&
            Array.isArray(c.payload?.ids) &&
            (c.payload?.ids as string[]).includes("auto-1") &&
            (c.payload?.ids as string[]).includes("auto-2")
        )
      ).toBe(true)
    );
  });
});

describe("HeaderExtras & OptionsApp interactions", () => {
  it("shows E2E locked status and unlocks auto-sync via HeaderAccountButton", async () => {
    const lockedState: AppStateSummary = {
      ...mockState,
      driveConnected: true,
      driveEmail: "user@example.com",
      driveE2EUnlocked: false,
      settings: { ...mockSettings, driveEncryptE2E: true },
    };
    const onRefresh = vi.fn(async () => {});
    const onToast = vi.fn();

    render(<HeaderAccountButton state={lockedState} onRefresh={onRefresh} onToast={onToast} />);
    const trigger = screen.getByRole("button", { name: /Google account/i });
    expect(trigger.getAttribute("data-tip")).toContain("Auto-sync paused");

    // Open Radix dropdown (pointerDown + click)
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);

    const pwInput = await screen.findByLabelText("Backup password to unlock auto-sync");
    expect(screen.getByText("Auto-sync paused — enter backup password")).toBeTruthy();
    fireEvent.change(pwInput, { target: { value: "my-secret-pass" } });
    fireEvent.click(screen.getByRole("button", { name: /Unlock & Sync/i }));

    await waitFor(() =>
      expect(rpcCalls.some((c) => c.cmd === "driveSyncNow" && c.payload?.password === "my-secret-pass")).toBe(true)
    );
  });

  it("requests downloads permission from BackupPermissionBanner", async () => {
    const onToast = vi.fn();
    render(<BackupPermissionBanner onToast={onToast} />);
    const btn = await screen.findByRole("button", { name: "Allow Backups" });
    fireEvent.click(btn);
    await waitFor(() => expect(permissionsRequestMock).toHaveBeenCalledWith({ permissions: ["downloads"] }));
  });

  it("navigates OptionsApp categories and toggles Tab Sleep", async () => {
    render(<OptionsApp />);
    await waitFor(() => expect(screen.getByText("Tab Sleep & Groups")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Tab Sleep & Groups" }));
    const tabSleepSwitch = await screen.findByRole("switch", {
      name: /Automatically put idle background tabs to sleep/i,
    });
    fireEvent.click(tabSleepSwitch);

    await waitFor(() =>
      expect(
        rpcCalls.some(
          (c) => c.cmd === "setSettings" && (c.payload?.patch as Partial<Settings>)?.suspenderEnabled === true
        )
      ).toBe(true)
    );
  });
});

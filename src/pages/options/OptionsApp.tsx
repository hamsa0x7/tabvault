import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  HardDrive,
  Keyboard,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { BackupPasswordField } from "../../components/BackupPasswordField.tsx";
import { Button, GlobalTooltip, Input, Switch, cn } from "../../components/ui.tsx";
import { sanitizeSettingsPatch } from "../../shared/db.ts";
import { DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import { applyTheme, formatTimestamp, openOrFocusDashboard, plural, triggerTextDownload } from "../../shared/format.ts";
import { sendBg } from "../../shared/rpc.ts";
import type { AppStateSummary, CopyTemplate, Settings, TabGroupColor, UpdateCheckResult } from "../../shared/types.ts";
import {
  ALL_COPY_FORMATS,
  ALL_GROUP_COLORS,
  BufferedInput,
  BufferedTextarea,
  CATEGORIES,
  Card,
  type CategoryId,
  RowInput,
  RowSelect,
  RowSwitch,
  SettingRow,
  ensureOptionalPermission,
} from "./OptionsPrimitives.tsx";

export function OptionsApp({
  embedded = false,
  initialCategory,
}: {
  embedded?: boolean;
  initialCategory?: CategoryId;
} = {}) {
  const [state, setState] = useState<AppStateSummary | null>(null);
  const [category, setCategory] = useState<CategoryId>(initialCategory || "general");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (initialCategory) setCategory(initialCategory);
  }, [initialCategory]);
  const [toast, setToast] = useState<string | null>(null);
  const [storageStats, setStorageStats] = useState<{ extensionLocalBytes: number; indexedDbBytes: number | null } | null>(null);
  const [drivePassword, setDrivePassword] = useState("");
  const [driveSyncError, setDriveSyncError] = useState<string | null>(null);
  const [driveSecretDraft, setDriveSecretDraft] = useState("");
  const driveSecretTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateFormat, setNewTemplateFormat] = useState("[%t](%u)");
  const [confirmReset, setConfirmReset] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  const notify = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const loadState = useCallback(async () => {
    const [st, stats] = await Promise.all([
      sendBg<AppStateSummary>("state"),
      sendBg<{ extensionLocalBytes: number; indexedDbBytes: number | null }>("storageStats"),
    ]);
    setState(st);
    setStorageStats(stats);
    applyTheme(st.settings.theme);
  }, []);

  useEffect(() => {
    void loadState();
    chrome?.storage?.local
      ?.get(["latestReleaseCache", "pendingUpdateVersion"])
      .then((res) => {
        const cached = res.latestReleaseCache as UpdateCheckResult | undefined;
        const pending = typeof res.pendingUpdateVersion === "string" ? res.pendingUpdateVersion : null;
        if (cached) {
          setUpdateInfo({ ...cached, pendingUpdateVersion: pending ?? cached.pendingUpdateVersion });
        } else if (pending) {
          setUpdateInfo({
            currentVersion: chrome.runtime?.getManifest?.().version || "1.0.0",
            latestVersion: pending,
            hasUpdate: true,
            pendingUpdateVersion: pending,
            releaseNotes: null,
            publishedAt: null,
            checkedAt: Date.now(),
          });
        }
      })
      .catch(() => {});
  }, [loadState]);

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const res = await sendBg<UpdateCheckResult>("checkForUpdates");
      setUpdateInfo(res);
      if (res.pendingUpdateVersion) {
        notify(`Update v${res.pendingUpdateVersion} is ready to apply.`);
      } else if (res.hasUpdate && res.latestVersion) {
        notify(`New release v${res.latestVersion} is available.`);
      } else {
        notify(`TabVault v${res.currentVersion} is up to date.`);
      }
    } catch {
      notify("Could not check for updates right now.");
    } finally {
      setCheckingUpdates(false);
    }
  };

  const patchSettings = async (patch: Partial<Settings>, message?: string) => {
    const next = await sendBg<Settings>("setSettings", { patch });
    setState((prev) => (prev ? { ...prev, settings: next } : prev));
    if (patch.theme) applyTheme(next.theme);
    notify(message || "Setting saved.");
  };

  const settings = state?.settings;
  useEffect(() => {
    setDriveSecretDraft(settings?.driveClientSecret || "");
  }, [settings?.driveClientSecret]);

  useEffect(
    () => () => {
      if (driveSecretTimerRef.current) clearTimeout(driveSecretTimerRef.current);
    },
    []
  );

  if (!settings) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--st-bg)] text-[var(--st-muted)] text-[13px]">
        Loading settings...
      </div>
    );
  }

  const formatBytes = (b: number | null | undefined) => {
    if (b == null) return "Unknown";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className={cn(embedded ? "h-full flex flex-col min-h-0 bg-[var(--st-bg)] text-[var(--st-ink)]" : "h-screen overflow-hidden flex flex-col md:flex-row bg-[var(--st-bg)] text-[var(--st-ink)]")}>
      {embedded ? null : (
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:rounded-md focus:bg-[var(--st-accent)] focus:text-[var(--st-accent-fg)] focus:text-xs focus:font-semibold"
        >
          Skip to main content
        </a>
      )}
      {embedded ? null : (
        /* Left Navigation */
        <aside className="w-full md:w-[248px] shrink-0 bg-[var(--st-surface)] border-b md:border-b-0 md:border-r border-[var(--st-border)] flex flex-col">
          <div className="h-14 px-4 flex items-center justify-between border-b border-[var(--st-border)]">
            <div className="flex items-center gap-2.5">
              <img src="icons/logo.svg" alt="TabVault" className="w-6 h-6 rounded" />
              <span className="font-semibold text-[15px] tracking-tight">Settings</span>
            </div>
            <Button
              size="icon"
              variant="ghost"
              title="Back to Dashboard"
              aria-label="Back to Dashboard"
              onClick={() => void openOrFocusDashboard()}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </div>

          <nav className="p-2.5 flex md:flex-col gap-1 md:gap-0.5 overflow-x-auto md:overflow-x-visible md:flex-1">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const active = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className={cn(
                    "w-auto md:w-full shrink-0 h-9 px-2.5 rounded-md flex items-center gap-2.5 text-[13px] font-medium transition-colors cursor-pointer",
                    active
                      ? "bg-[var(--st-subtle)] text-[var(--st-ink)]"
                      : "text-[var(--st-muted)] hover:text-[var(--st-ink)] hover:bg-[var(--st-subtle)]"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{cat.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="hidden md:block p-3 border-t border-[var(--st-border)]">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void openOrFocusDashboard()}
            >
              Open Session Dashboard
            </Button>
          </div>
        </aside>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 w-full flex flex-col overflow-hidden">
        {(embedded || category === "general" || category === "tabs") && (
          <div className="px-5 md:px-8 h-12 bg-[var(--st-surface)] border-b border-[var(--st-border)] flex items-center justify-between gap-2 shrink-0">
            <h1 className="text-[15px] font-bold tracking-tight truncate">
              {embedded ? `Settings · ${CATEGORIES.find((c) => c.id === category)?.label}` : CATEGORIES.find((c) => c.id === category)?.label}
            </h1>
            {(category === "general" || category === "tabs") && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? "Hide Advanced Options" : "Show Advanced Options"}
              </Button>
            )}
          </div>
        )}
        <main id={embedded ? undefined : "main-content"} tabIndex={embedded ? undefined : -1} className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden scroll-thin p-5 md:px-8 focus:outline-none">
          <div className="max-w-4xl w-full space-y-5">
          {/* 1. ESSENTIALS & AUTO-SAVE (under General) */}
          {category === "general" && (
            <>
              <Card title="Essentials">
                <SettingRow
                  title="Clicking the TabVault extension icon"
                  description="Choose whether clicking the toolbar icon opens the Side Panel, the Quick Popup, the full Dashboard, or saves tabs."
                >
                  <RowSelect
                    value={settings.toolbarClickAction}
                    onChange={(e) =>
                      void patchSettings({
                        toolbarClickAction: e.target.value as Settings["toolbarClickAction"],
                      })
                    }
                  >
                    <option value="openSidePanel">Open Side Panel</option>
                    <option value="openPopup">Open Quick Popup</option>
                    <option value="openDashboard">Open Dashboard</option>
                    <option value="sendCurrentWindow">Save current window</option>
                    <option value="sendCurrentTab">Save current tab</option>
                    <option value="sendAllWindows">Save all windows</option>
                  </RowSelect>
                </SettingRow>
                {settings.toolbarClickAction === "openPopup" && (
                  <SettingRow
                    title="Quick Popup size (pixels)"
                    description="Width (340–800) and height (400–650) when using the toolbar popup."
                  >
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        aria-label="Popup width"
                        min={340}
                        max={800}
                        value={settings.popupWidth}
                        onChange={(e) =>
                          void patchSettings({
                            popupWidth: Math.min(800, Math.max(340, Number(e.target.value) || 400)),
                          })
                        }
                        className="w-20"
                      />
                      <span className="text-[12px] text-[var(--st-muted)]">×</span>
                      <Input
                        type="number"
                        aria-label="Popup height"
                        min={400}
                        max={650}
                        value={settings.popupHeight}
                        onChange={(e) =>
                          void patchSettings({
                            popupHeight: Math.min(650, Math.max(400, Number(e.target.value) || 560)),
                          })
                        }
                        className="w-20"
                      />
                    </div>
                  </SettingRow>
                )}
                <SettingRow
                  title="Theme"
                  description="Choose light, dark, or match your operating system appearance."
                >
                  <RowSelect
                    value={settings.theme}
                    onChange={(e) =>
                      void patchSettings({ theme: e.target.value as Settings["theme"] })
                    }
                  >
                    <option value="system">Match system</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </RowSelect>
                </SettingRow>
                <SettingRow
                  title="List density"
                  description="Adjust vertical row spacing in tab lists across the Popup, Side Panel, and Dashboard."
                >
                  <RowSelect
                    value={settings.uiDensity === "dense" ? "compact" : settings.uiDensity === "expanded" ? "normal" : settings.uiDensity}
                    onChange={(e) =>
                      void patchSettings({ uiDensity: e.target.value as Settings["uiDensity"] })
                    }
                  >
                    <option value="compact">Compact</option>
                    <option value="normal">Comfortable</option>
                  </RowSelect>
                </SettingRow>
                <SettingRow
                  title="Keyboard shortcuts"
                  description="Defaults: Alt+Shift+P (open TabVault), Alt+Shift+D (Dashboard), Alt+Shift+S (save all windows), Alt+Shift+W (save & close window)."
                >
                  <Button
                    variant="outline"
                    onClick={() => chrome.tabs.create({ url: "chrome://extensions/shortcuts" })}
                  >
                    <Keyboard className="w-4 h-4" />
                    Edit Shortcuts
                  </Button>
                </SettingRow>
              </Card>

              <Card title="Automatic Session Saving">
                <SettingRow
                  title="Enable automatic saving"
                  description="Continuously capture your open windows and tabs in the background."
                >
                  <RowSwitch
                    checked={settings.autoSaveEnabled}
                    onCheckedChange={(v) => void patchSettings({ autoSaveEnabled: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Periodic check interval"
                  description="How often TabVault checks for changes even if no tab event fired."
                >
                  <RowSelect
                    value={String(settings.autoSaveIntervalMin)}
                    onChange={(e) => void patchSettings({ autoSaveIntervalMin: Number(e.target.value) })}
                  >
                    <option value="1">Every 1 minute</option>
                    <option value="5">Every 5 minutes</option>
                    <option value="15">Every 15 minutes</option>
                    <option value="30">Every 30 minutes</option>
                    <option value="60">Every 60 minutes</option>
                  </RowSelect>
                </SettingRow>
                <SettingRow
                  title="Save when a browser window closes"
                  description="Creates a dedicated snapshot whenever you close any window."
                >
                  <RowSwitch
                    checked={settings.autoSaveOnWindowClose}
                    onCheckedChange={(v) => void patchSettings({ autoSaveOnWindowClose: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Keep auto-saved history for"
                  description="Older automatic snapshots are pruned after this window; named sessions are kept forever."
                >
                  <RowSelect
                    value={settings.historyDays}
                    onChange={(e) =>
                      void patchSettings({ historyDays: e.target.value as Settings["historyDays"] })
                    }
                  >
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                    <option value="365">1 year</option>
                    <option value="forever">Forever</option>
                  </RowSelect>
                </SettingRow>
                {showAdvanced && (
                  <>
                    <SettingRow
                      title="Wait before saving after tab changes"
                      description="Bundles rapid tab openings or closings into a single clean snapshot."
                    >
                      <RowSelect
                        value={String(settings.debounceMs)}
                        onChange={(e) => void patchSettings({ debounceMs: Number(e.target.value) })}
                      >
                        <option value="1000">1 second</option>
                        <option value="2000">2 seconds</option>
                        <option value="5000">5 seconds</option>
                        <option value="10000">10 seconds</option>
                      </RowSelect>
                    </SettingRow>
                    <SettingRow
                      title="Protect previous snapshot if many tabs close at once"
                      description="Starts a fresh snapshot instead of overwriting your last one if fewer tabs remain."
                    >
                      <RowSelect
                        value={String(settings.shrinkForkPct)}
                        onChange={(e) => void patchSettings({ shrinkForkPct: Number(e.target.value) })}
                      >
                        <option value="50">Below 50% remaining</option>
                        <option value="70">Below 70% remaining</option>
                        <option value="85">Below 85% remaining</option>
                        <option value="0">Always overwrite current session</option>
                      </RowSelect>
                    </SettingRow>
                    <SettingRow
                      title="Name auto-saves using the active tab title"
                      description="Makes automatic snapshots easier to recognize at a glance."
                    >
                      <RowSwitch
                        checked={settings.useTabTitleForAutoSave}
                        onCheckedChange={(v) => void patchSettings({ useTabTitleForAutoSave: v })}
                      />
                    </SettingRow>
                  </>
                )}
              </Card>

              {showAdvanced && (
                <>
                  <Card title="Window Close Saving">
                    <SettingRow title="Minimum tabs required to save a closed window">
                      <RowInput
                        type="number"
                        min={1}
                        max={50}
                        value={settings.minTabsOnWindowClose}
                        onChange={(e) =>
                          void patchSettings({ minTabsOnWindowClose: Math.max(1, Number(e.target.value) || 1) })
                        }
                        className="w-20"
                      />
                    </SettingRow>
                    <SettingRow title="Maximum closed-window snapshots to keep">
                      <RowInput
                        type="number"
                        min={1}
                        max={200}
                        value={settings.maxWindowCloseSaves}
                        onChange={(e) =>
                          void patchSettings({ maxWindowCloseSaves: Math.max(1, Number(e.target.value) || 15) })
                        }
                        className="w-20"
                      />
                    </SettingRow>
                    <SettingRow title="Skip saving windows with no restorable tabs on close">
                      <RowSwitch
                        checked={settings.purgeEmptyOnClose}
                        onCheckedChange={(v) => void patchSettings({ purgeEmptyOnClose: v })}
                      />
                    </SettingRow>
                    <SettingRow title="Skip saving closed windows that only contain pinned tabs">
                      <RowSwitch
                        checked={settings.purgePinnedOnlyOnClose}
                        onCheckedChange={(v) => void patchSettings({ purgePinnedOnlyOnClose: v })}
                      />
                    </SettingRow>
                  </Card>

                  <Card title="History Retention & Cleanup">
                    <SettingRow title="Maximum auto-save entries">
                      <RowSelect
                        value={settings.maxAutoSnapshots === null ? "unlimited" : String(settings.maxAutoSnapshots)}
                        onChange={(e) =>
                          void patchSettings({
                            maxAutoSnapshots:
                              e.target.value === "unlimited"
                                ? null
                                : (Number(e.target.value) as Settings["maxAutoSnapshots"]),
                          })
                        }
                      >
                        <option value="60">60 snapshots</option>
                        <option value="200">200 snapshots</option>
                        <option value="500">500 snapshots</option>
                        <option value="1000">1,000 snapshots</option>
                        <option value="unlimited">Unlimited</option>
                      </RowSelect>
                    </SettingRow>
                    <SettingRow
                      title="Keep one snapshot per hour after 2 hours"
                      description="Compacts older rapid auto-saves while keeping your recent timeline detailed."
                    >
                      <RowSwitch
                        checked={settings.thinAfter2hHourly}
                        onCheckedChange={(v) => void patchSettings({ thinAfter2hHourly: v })}
                      />
                    </SettingRow>
                    <SettingRow
                      title="Keep one snapshot per day after 48 hours"
                      description="Named sessions and backups are never thinned automatically."
                    >
                      <RowSwitch
                        checked={settings.thinAfter48hDaily}
                        onCheckedChange={(v) => void patchSettings({ thinAfter48hDaily: v })}
                      />
                    </SettingRow>
                    <SettingRow
                      title="Remove unnamed closed-window saves after (days)"
                      description="Set to 0 to keep unnamed closed-window saves under the normal retention limit."
                    >
                      <RowInput
                        type="number"
                        min={0}
                        max={365}
                        value={settings.purgeUnnamedClosedDays}
                        onChange={(e) =>
                          void patchSettings({ purgeUnnamedClosedDays: Math.max(0, Number(e.target.value) || 0) })
                        }
                        className="w-20"
                      />
                    </SettingRow>
                  </Card>
                </>
              )}
            </>
          )}

          {category === "general" && (
            <Card title="Updates & About">
              <SettingRow
                title={`TabVault v${updateInfo?.currentVersion || chrome.runtime?.getManifest?.().version || "1.0.0"}`}
                description={
                  updateInfo?.pendingUpdateVersion
                    ? `Update v${updateInfo.pendingUpdateVersion} downloaded and ready to apply.`
                    : updateInfo?.hasUpdate && updateInfo.latestVersion
                      ? `New release v${updateInfo.latestVersion} is available.`
                      : updateInfo?.checkedAt
                        ? `Up to date · Last checked ${formatTimestamp(updateInfo.checkedAt)}`
                        : "Check for new TabVault releases and release notes."
                }
              >
                <div className="flex items-center gap-2 shrink-0">
                  {updateInfo?.pendingUpdateVersion && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => void sendBg("applyPendingUpdate")}
                    >
                      Apply Update &amp; Reload
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={checkingUpdates}
                    onClick={() => void handleCheckUpdates()}
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", checkingUpdates && "animate-spin")} />
                    {checkingUpdates ? "Checking…" : "Check for Updates"}
                  </Button>
                </div>
              </SettingRow>
              {updateInfo?.hasUpdate && updateInfo.releaseNotes && (
                <div className="px-4 py-2.5 bg-[var(--st-subtle)] border-t border-[var(--st-border)] text-[12px] text-[var(--st-ink)] whitespace-pre-wrap">
                  {updateInfo.releaseNotes}
                </div>
              )}
              <SettingRow
                title="Automatically apply extension updates"
                description="Applies Chrome Web Store updates as soon as they finish downloading."
              >
                <RowSwitch
                  checked={settings.autoApplyUpdates}
                  onCheckedChange={(v) => void patchSettings({ autoApplyUpdates: v })}
                />
              </SettingRow>
              <SettingRow
                title="Check for release notes on startup"
                description="Checks for new TabVault releases in the background when your browser starts."
              >
                <RowSwitch
                  checked={settings.checkUpdatesOnStartup}
                  onCheckedChange={(v) => void patchSettings({ checkUpdatesOnStartup: v })}
                />
              </SettingRow>
            </Card>
          )}

          {/* 2. CRASH & STARTUP (Advanced under General) */}
          {category === "general" && showAdvanced && (
            <Card title="Startup & Crash Recovery">
              <SettingRow
                title="When browser opens with fewer tabs than your previous session"
                description="Protects against accidental single-tab launches or browser crashes."
              >
                <RowSelect
                  value={settings.startupBehavior}
                  onChange={(e) =>
                    void patchSettings({ startupBehavior: e.target.value as Settings["startupBehavior"] })
                  }
                >
                  <option value="recoveryBanner">Show restore alert &amp; badge</option>
                  <option value="restorePrevious">Automatically restore missing tabs</option>
                  <option value="openStartupSessions">Open startup-pinned sessions</option>
                  <option value="openDashboard">Open TabVault dashboard</option>
                  <option value="ask">Ask in popup</option>
                  <option value="none">Do nothing</option>
                </RowSelect>
              </SettingRow>
              <SettingRow title="Delay after browser launch before checking (seconds)">
                <RowInput
                  type="number"
                  min={3}
                  max={120}
                  value={settings.startupCheckSec}
                  onChange={(e) =>
                    void patchSettings({ startupCheckSec: Math.max(3, Number(e.target.value) || 15) })
                  }
                  className="w-20"
                />
              </SettingRow>
              <SettingRow title="Alert if fewer than this share of previous tabs are open">
                <RowSelect
                  value={String(settings.recoveryCoverageThreshold)}
                  onChange={(e) =>
                    void patchSettings({ recoveryCoverageThreshold: Number(e.target.value) })
                  }
                >
                  <option value="0.25">25% of previous tabs</option>
                  <option value="0.5">50% of previous tabs</option>
                  <option value="0.75">75% of previous tabs</option>
                  <option value="0.9">90% of previous tabs</option>
                </RowSelect>
              </SettingRow>
              <SettingRow title="Minimum missing tabs before triggering recovery alert">
                <RowInput
                  type="number"
                  min={1}
                  max={100}
                  value={settings.recoveryMissingMin}
                  onChange={(e) =>
                    void patchSettings({ recoveryMissingMin: Math.max(1, Number(e.target.value) || 5) })
                  }
                  className="w-20"
                />
              </SettingRow>
              <SettingRow title="Show alert badge on toolbar icon when recovery is available">
                <RowSwitch
                  checked={settings.showBadgeAlert}
                  onCheckedChange={(v) => void patchSettings({ showBadgeAlert: v })}
                />
              </SettingRow>
              <SettingRow
                title="Test recovery check right now"
                description="Compares currently open tabs against your previous browser session."
              >
                <Button
                  variant="outline"
                  onClick={async () => {
                    const rec = await sendBg("checkRecoveryNow");
                    notify(rec ? "Recovery candidate found! Open Dashboard or Popup to restore." : "Your current windows already match your latest session.");
                  }}
                >
                  Check Now
                </Button>
              </SettingRow>
            </Card>
          )}

          {/* 3. RESTORE & TAB SLEEP */}
          {category === "tabs" && (
            <>
              <Card title="Session & Collection Restore">
                <SettingRow
                  title="Default restore location"
                  description="Choose whether restoring a session opens new windows or updates your current window."
                >
                  <RowSelect
                    value={settings.defaultOpenMode}
                    onChange={(e) =>
                      void patchSettings({ defaultOpenMode: e.target.value as Settings["defaultOpenMode"] })
                    }
                  >
                    <option value="newWindow">New window(s)</option>
                    <option value="currentWindow">Replace current window</option>
                    <option value="addToCurrent">Add to current window</option>
                  </RowSelect>
                </SettingRow>
                <SettingRow
                  title="Restore original window positions and sizes"
                  description="Reopens saved windows at their previous screen coordinates and dimensions."
                >
                  <RowSwitch
                    checked={settings.restoreWindowBounds}
                    onCheckedChange={(v) => void patchSettings({ restoreWindowBounds: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Restore colored Chrome/Brave Tab Groups"
                  description="Recreates Tab Group titles, colors, and collapsed states when restoring sessions."
                >
                  <RowSwitch
                    checked={settings.restoreTabGroups}
                    onCheckedChange={(v) => void patchSettings({ restoreTabGroups: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Keep existing pinned tabs when replacing current window"
                  description="Prevents pinned tabs from being closed when you overwrite your current window with a saved session."
                >
                  <RowSwitch
                    checked={settings.keepPinnedInCurrentWindow}
                    onCheckedChange={(v) => void patchSettings({ keepPinnedInCurrentWindow: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Skip addresses already open when restoring from crash alert"
                  description="Avoids opening duplicate tabs if some of your crashed tabs already reopened."
                >
                  <RowSwitch
                    checked={settings.skipAlreadyOpenOnCrashRestore}
                    onCheckedChange={(v) => void patchSettings({ skipAlreadyOpenOnCrashRestore: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Ask before opening sessions with at least this many tabs"
                  description="Shows a confirmation prompt so you don't accidentally open dozens of tabs at once."
                >
                  <RowInput
                    type="number"
                    min={5}
                    max={500}
                    value={settings.warnOnOpenTabCount}
                    onChange={(e) =>
                      void patchSettings({ warnOnOpenTabCount: Math.max(5, Number(e.target.value) || 25) })
                    }
                    className="w-20"
                  />
                </SettingRow>
                <SettingRow title="Open individual tabs next to the current active tab">
                  <RowSwitch
                    checked={settings.openNextToActive}
                    onCheckedChange={(v) => void patchSettings({ openNextToActive: v })}
                  />
                </SettingRow>
                <SettingRow title="Switch focus to newly opened individual tabs">
                  <RowSwitch
                    checked={settings.switchToOpenedTab}
                    onCheckedChange={(v) => void patchSettings({ switchToOpenedTab: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="After opening all tabs from a collection"
                  description="Choose whether restored tabs stay in the collection, get removed, or move to archive."
                >
                  <RowSelect
                    value={settings.restoreListAction}
                    onChange={(e) =>
                      void patchSettings({ restoreListAction: e.target.value as Settings["restoreListAction"] })
                    }
                  >
                    <option value="keep">Keep tabs in collection</option>
                    <option value="remove">Remove unlocked tabs from collection</option>
                    <option value="archive">Archive unlocked tabs</option>
                  </RowSelect>
                </SettingRow>
                <SettingRow title="When clicking a saved tab address">
                  <RowSelect
                    value={settings.urlClickInClosedSession}
                    onChange={(e) =>
                      void patchSettings({
                        urlClickInClosedSession: e.target.value as Settings["urlClickInClosedSession"],
                      })
                    }
                  >
                    <option value="closed">Open in background tab</option>
                    <option value="focused">Open &amp; focus immediately</option>
                    <option value="ask">Follow general focus setting</option>
                  </RowSelect>
                </SettingRow>
              </Card>

              <Card title="Memory Saving & Idle Tab Sleep">
                <SettingRow
                  title="How restored tabs load"
                  description="Waiting until clicked saves memory when opening large sessions."
                >
                  <RowSelect
                    value={settings.restoreLoadMode}
                    onChange={(e) =>
                      void patchSettings({ restoreLoadMode: e.target.value as Settings["restoreLoadMode"] })
                    }
                  >
                    <option value="lazyDiscard">Load tabs only when clicked</option>
                    <option value="alwaysLoad">Load all tabs right away</option>
                    <option value="suspendPage">Use lightweight sleep page</option>
                    <option value="lastState">Keep previous sleep state</option>
                  </RowSelect>
                </SettingRow>
                <SettingRow
                  title="Automatically wait-load tabs when opening more than"
                  description="Keeps background tabs unloaded until clicked when restoring large sessions, preventing browser lag."
                >
                  <RowInput
                    type="number"
                    min={1}
                    max={200}
                    value={settings.optimizedOpenThreshold}
                    onChange={(e) =>
                      void patchSettings({ optimizedOpenThreshold: Math.max(1, Number(e.target.value) || 10) })
                    }
                    className="w-20"
                  />
                </SettingRow>
                <div className="px-4 py-3 bg-[var(--st-subtle)]/50 border-b border-[var(--st-border)] flex flex-wrap items-center justify-between gap-2 text-[12px]">
                  <p className="text-[var(--st-muted)] leading-snug max-w-2xl">
                    <strong className="text-[var(--st-ink)]">Recommended:</strong> Use your browser&apos;s built-in Memory Saver for everyday tab sleeping. Only enable TabVault&apos;s sleeper below if you want extra rules (exact timers, active-tab caps, wildcard whitelists, or unsaved-form checks)—and use carefully, as sleeping a tab discards its in-memory state until reloaded.
                  </p>
                  <Button
                    variant="outline"
                    className="h-7 px-2.5 text-[11.5px] shrink-0"
                    onClick={() => void chrome.tabs.create({ url: "chrome://settings/performance" })}
                  >
                    Browser Memory Saver ↗
                  </Button>
                </div>
                <SettingRow
                  title="Automatically put idle background tabs to sleep"
                  description="Frees memory from tabs you haven't viewed recently."
                >
                  <RowSwitch
                    checked={settings.suspenderEnabled}
                    onCheckedChange={(v) => void patchSettings({ suspenderEnabled: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Sleep background tabs idle for (minutes)"
                  description="Inactive tabs older than this are eligible to be put to sleep."
                >
                  <RowInput
                    type="number"
                    min={1}
                    max={1440}
                    value={settings.suspendAfterMin}
                    onChange={(e) =>
                      void patchSettings({ suspendAfterMin: Math.max(1, Number(e.target.value) || 90) })
                    }
                    className="w-24"
                  />
                </SettingRow>
                <SettingRow
                  title="Keep at least this many recent tabs awake"
                  description="Prevents sleeping your most recently viewed tabs even if you have many tabs open."
                >
                  <RowInput
                    type="number"
                    min={1}
                    max={200}
                    value={settings.maxActiveTabsBeforeSuspend}
                    onChange={(e) =>
                      void patchSettings({
                        maxActiveTabsBeforeSuspend: Math.max(1, Number(e.target.value) || 15),
                      })
                    }
                    className="w-20"
                  />
                </SettingRow>
                <SettingRow
                  title="Sleep method"
                  description="Built-in browser sleep frees RAM natively; placeholder page shows a lightweight TabVault screen instead."
                >
                  <RowSelect
                    value={settings.suspendBackend}
                    onChange={(e) =>
                      void patchSettings({ suspendBackend: e.target.value as Settings["suspendBackend"] })
                    }
                  >
                    <option value="nativeDiscard">Built-in browser tab sleep</option>
                    <option value="suspendPage">Custom sleep placeholder page</option>
                  </RowSelect>
                </SettingRow>
                <SettingRow title="Automatically wake sleeping placeholder tabs when clicked">
                  <RowSwitch
                    checked={settings.autoReloadOnFocus}
                    onCheckedChange={(v) => void patchSettings({ autoReloadOnFocus: v })}
                  />
                </SettingRow>
                <SettingRow title="Never sleep the active tab">
                  <RowSwitch
                    checked={settings.guardActiveTab}
                    onCheckedChange={(v) => void patchSettings({ guardActiveTab: v })}
                  />
                </SettingRow>
                <SettingRow title="Never sleep tabs playing audio">
                  <RowSwitch
                    checked={settings.guardAudibleTabs}
                    onCheckedChange={(v) => void patchSettings({ guardAudibleTabs: v })}
                  />
                </SettingRow>
                <SettingRow title="Never sleep pinned tabs">
                  <RowSwitch
                    checked={settings.guardPinnedTabs}
                    onCheckedChange={(v) => void patchSettings({ guardPinnedTabs: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Avoid sleeping tabs with typed form text"
                  description={
                    settings.guardUnsavedForms && state?.scriptingPermissionGranted === false
                      ? "Permission needed so TabVault can check pages for unsaved input."
                      : "Checks whether a background tab has unsaved input before putting it to sleep."
                  }
                >
                  <div className="flex items-center gap-2">
                    {settings.guardUnsavedForms && state?.scriptingPermissionGranted === false && (
                      <Button
                        variant="outline"
                        className="h-8 px-2.5 text-[11.5px]"
                        onClick={async () => {
                          const ok = await ensureOptionalPermission({ permissions: ["scripting"] });
                          await loadState();
                          notify(ok ? "Form protection permission enabled." : "Permission was not granted.");
                        }}
                      >
                        Allow Permission
                      </Button>
                    )}
                    <RowSwitch
                      checked={settings.guardUnsavedForms}
                      onCheckedChange={async (v) => {
                        if (v) {
                          const ok = await ensureOptionalPermission({ permissions: ["scripting"] });
                          if (!ok) {
                            notify("Scripting permission is needed to check for unsaved forms.");
                            return;
                          }
                        }
                        await patchSettings({ guardUnsavedForms: v });
                        await loadState();
                      }}
                    />
                  </div>
                </SettingRow>
                <div className="p-4 space-y-2">
                  <label htmlFor="st-suspend-whitelist" className="text-[13px] font-medium block">
                    Never sleep these websites (one per line)
                  </label>
                  <BufferedTextarea
                    id="st-suspend-whitelist"
                    value={settings.suspendWhitelist.join("\n")}
                    onCommit={(val) =>
                      void patchSettings({
                        suspendWhitelist: val
                          .split(/\r?\n/)
                          .map((x) => x.trim())
                          .filter(Boolean),
                      })
                    }
                    rows={4}
                    className="w-full rounded-md border border-[var(--st-border)] bg-[var(--st-surface)] p-2.5 text-[12px] focus:outline-none focus:border-[var(--st-accent)]"
                  />
                </div>
              </Card>
            </>
          )}

          {/* 4. CAPTURE & TAB GROUPS (Advanced under Tab Sleep & Groups) */}
          {category === "tabs" && showAdvanced && (
            <Card title="Capture Behavior, Tab Groups & Scheduled Sleep">
              <SettingRow title="Close open tabs after sending them to a collection">
                <RowSwitch
                  checked={settings.closeTabsAfterCapture}
                  onCheckedChange={(v) => void patchSettings({ closeTabsAfterCapture: v })}
                />
              </SettingRow>
              <SettingRow
                title="Pinned tabs when collapsing to a collection"
                description="Choose whether pinned tabs stay open in your window or get saved into the collection too."
              >
                <RowSelect
                  value={settings.capturePinnedPolicy}
                  onChange={(e) =>
                    void patchSettings({
                      capturePinnedPolicy: e.target.value as Settings["capturePinnedPolicy"],
                    })
                  }
                >
                  <option value="ignore">Leave pinned tabs open</option>
                  <option value="allow">Include pinned tabs too</option>
                </RowSelect>
              </SettingRow>
              <SettingRow
                title="Duplicate addresses when adding to an existing collection"
                description="Decide whether matching URLs are skipped, kept, or used to refresh the saved title."
              >
                <RowSelect
                  value={settings.duplicatePolicy}
                  onChange={(e) =>
                    void patchSettings({ duplicatePolicy: e.target.value as Settings["duplicatePolicy"] })
                  }
                >
                  <option value="reject">Skip duplicates</option>
                  <option value="allow">Keep duplicates</option>
                  <option value="keepTitle">Keep existing title</option>
                  <option value="updateTitle">Update title to latest</option>
                </RowSelect>
              </SettingRow>
              <SettingRow title="Include browser Tab Group names and colors when saving">
                <RowSwitch
                  checked={settings.includeTabGroupsOnCapture}
                  onCheckedChange={(v) => void patchSettings({ includeTabGroupsOnCapture: v })}
                />
              </SettingRow>
              <SettingRow title="Automatically group open tabs by website domain">
                <RowSwitch
                  checked={settings.autoTabGroupByDomain}
                  onCheckedChange={(v) => void patchSettings({ autoTabGroupByDomain: v })}
                />
              </SettingRow>
              <SettingRow title="Ungroup single-tab groups automatically">
                <RowSwitch
                  checked={settings.autoTabUngroupSingle}
                  onCheckedChange={(v) => void patchSettings({ autoTabUngroupSingle: v })}
                />
              </SettingRow>
              <SettingRow title="Default color for auto-grouped tabs">
                <RowSelect
                  value={settings.autoTabGroupColor}
                  onChange={(e) =>
                    void patchSettings({
                      autoTabGroupColor: e.target.value as "random" | TabGroupColor,
                    })
                  }
                >
                  {ALL_GROUP_COLORS.map((c) => (
                    <option key={c} value={c}>
                      {c[0].toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </RowSelect>
              </SettingRow>
              <SettingRow title="Automatically save tabs into a collection at a daily time">
                <RowSwitch
                  checked={settings.dailySleepEnabled}
                  onCheckedChange={(v) => void patchSettings({ dailySleepEnabled: v })}
                />
              </SettingRow>
              <SettingRow title="Daily wrap-up time">
                <RowInput
                  type="time"
                  value={settings.dailySleepTime}
                  onChange={(e) => void patchSettings({ dailySleepTime: e.target.value })}
                  className="w-32"
                />
              </SettingRow>
              <SettingRow title="Close open tabs after the daily wrap-up saves them">
                <RowSwitch
                  checked={settings.dailySleepCloseTabs}
                  onCheckedChange={(v) => void patchSettings({ dailySleepCloseTabs: v })}
                />
              </SettingRow>
            </Card>
          )}

          {/* 5. DISPLAY FORMATTING & COPY TEMPLATES (Advanced under General) */}
          {category === "general" && (
            <>
              {showAdvanced && (
                <>
                  <Card title="Display Formatting">
                    <SettingRow title="Show open tab count on toolbar badge">
                      <RowSwitch
                        checked={settings.showTabCountBadge}
                        onCheckedChange={(v) => void patchSettings({ showTabCountBadge: v })}
                      />
                    </SettingRow>
                    <SettingRow title="Website address display">
                      <RowSelect
                        value={settings.urlDisplayMode}
                        onChange={(e) =>
                          void patchSettings({ urlDisplayMode: e.target.value as Settings["urlDisplayMode"] })
                        }
                      >
                        <option value="domain">Website name only</option>
                        <option value="abbreviated">Shortened address</option>
                        <option value="full">Full address</option>
                        <option value="none">Hide addresses</option>
                      </RowSelect>
                    </SettingRow>
                    <SettingRow title="Time display">
                      <RowSelect
                        value={settings.timestampMode}
                        onChange={(e) =>
                          void patchSettings({ timestampMode: e.target.value as Settings["timestampMode"] })
                        }
                      >
                        <option value="relative">Relative (5m ago)</option>
                        <option value="absolute">Exact date &amp; time</option>
                      </RowSelect>
                    </SettingRow>
                    <SettingRow title="Shorten long page titles to single line">
                      <RowSwitch
                        checked={settings.truncateTitles}
                        onCheckedChange={(v) => void patchSettings({ truncateTitles: v })}
                      />
                    </SettingRow>
                  </Card>

                  <Card title="Copy Formats & Custom Templates">
                <div className="px-4 pt-3 text-[12px] text-[var(--st-muted)]">
                  Choose which clipboard formats are available when copying tabs, and define custom text templates using{" "}
                  <code className="px-1 py-0.5 rounded bg-[var(--st-subtle)]">%t</code> (title) and{" "}
                  <code className="px-1 py-0.5 rounded bg-[var(--st-subtle)]">%u</code> (URL).
                </div>
                <div className="p-4 space-y-2">
                  <div className="text-[13px] font-medium">Enabled Copy &amp; Export Formats</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {ALL_COPY_FORMATS.map((fmt) => {
                      const on = settings.enabledCopyFormats.includes(fmt.id);
                      return (
                        <label
                          key={fmt.id}
                          className="flex items-center justify-between rounded-md border border-[var(--st-border)] px-3 py-2 text-[12px]"
                        >
                          <span>{fmt.label}</span>
                          <Switch
                            ariaLabel={`Enable ${fmt.label}`}
                            checked={on}
                            onCheckedChange={(checked) => {
                              const next = checked
                                ? [...settings.enabledCopyFormats, fmt.id]
                                : settings.enabledCopyFormats.filter((x) => x !== fmt.id);
                              void patchSettings({ enabledCopyFormats: next });
                            }}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="p-4 space-y-2.5">
                  <div className="text-[13px] font-medium">Custom Copy Templates (%t = title, %u = address)</div>
                  <div className="space-y-1.5">
                    {settings.customCopyTemplates.map((tpl, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          aria-label={`Template ${idx + 1} name`}
                          value={tpl.name}
                          onChange={(e) => {
                            const copy = [...settings.customCopyTemplates];
                            copy[idx] = { ...tpl, name: e.target.value };
                            void patchSettings({ customCopyTemplates: copy });
                          }}
                          className="w-40"
                        />
                        <Input
                          aria-label={`Template ${idx + 1} format`}
                          value={tpl.format}
                          onChange={(e) => {
                            const copy = [...settings.customCopyTemplates];
                            copy[idx] = { ...tpl, format: e.target.value };
                            void patchSettings({ customCopyTemplates: copy });
                          }}
                          className="flex-1"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove ${tpl.name || `template ${idx + 1}`}`}
                          onClick={() => {
                            const next = settings.customCopyTemplates.filter((_, i) => i !== idx);
                            void patchSettings({ customCopyTemplates: next });
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      aria-label="New template name"
                      value={newTemplateName}
                      onChange={(e) => setNewTemplateName(e.target.value)}
                      placeholder="Template name"
                      className="w-40"
                    />
                    <Input
                      aria-label="New template format"
                      value={newTemplateFormat}
                      onChange={(e) => setNewTemplateFormat(e.target.value)}
                      placeholder="[%t](%u)"
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!newTemplateName.trim() || !newTemplateFormat.trim()) return;
                        const next: CopyTemplate[] = [
                          ...settings.customCopyTemplates,
                          { name: newTemplateName.trim(), format: newTemplateFormat.trim() },
                        ];
                        void patchSettings({ customCopyTemplates: next }, "Template added.");
                        setNewTemplateName("");
                      }}
                    >
                      <Plus className="w-4 h-4" />
                      Add
                    </Button>
                  </div>
                </div>
              </Card>

              <Card title="Skip Confirmation Prompts For">
                {[
                  { key: "deleteSession" as const, label: "Deleting saved sessions or collections" },
                  { key: "deleteItem" as const, label: "Removing individual tabs from collections" },
                  { key: "closeWindow" as const, label: "Closing all open windows when collapsing" },
                  { key: "openLarge" as const, label: "Opening sessions with many tabs" },
                  { key: "replace" as const, label: "Replacing current window tabs" },
                ].map((item) => (
                  <SettingRow key={item.key} title={item.label}>
                    <RowSwitch
                      checked={settings.bypassConfirm[item.key]}
                      onCheckedChange={(v) =>
                        void patchSettings({
                          bypassConfirm: { ...settings.bypassConfirm, [item.key]: v },
                        })
                      }
                    />
                  </SettingRow>
                ))}
                  </Card>
                </>
              )}
            </>
          )}

          {/* 6. BACKUPS & GOOGLE DRIVE */}
          {category === "backups" && (
            <>
              <Card title="Local File Backups">
                {state?.lastBackupError && (
                  <div className="px-4 py-2.5 bg-[var(--st-warn-bg)] text-[12px] text-[var(--st-warn-ink)] flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>Last backup error:</strong> {state.lastBackupError}
                    </span>
                    <Button
                      variant="outline"
                      className="h-7 px-2.5 text-[11.5px]"
                      onClick={async () => {
                        const ok = await ensureOptionalPermission({ permissions: ["downloads"] });
                        if (ok) {
                          const res = await sendBg<{ files: number; sessions: number }>("backupNow").catch(() => null);
                          await loadState();
                          if (res) notify(`Saved ${plural(res.files, "backup file")}.`);
                        }
                      }}
                    >
                      Fix &amp; Retry
                    </Button>
                  </div>
                )}
                <SettingRow
                  title="Backup schedule"
                  description="Automatically saves TabVault backup files into your Downloads folder."
                >
                  <RowSelect
                    value={settings.localBackupSchedule}
                    onChange={async (e) => {
                      const val = e.target.value as Settings["localBackupSchedule"];
                      if (val !== "off") {
                        const granted = await ensureOptionalPermission({ permissions: ["downloads"] });
                        if (!granted) {
                          notify("Downloads permission is needed for automatic local backups. Allow it in the browser prompt to continue.");
                          return;
                        }
                      }
                      await patchSettings({ localBackupSchedule: val }, "Backup schedule updated.");
                    }}
                  >
                    <option value="off">Off</option>
                    <option value="startup">On browser startup</option>
                    <option value="hourly">Every hour</option>
                    <option value="daily">Once a day</option>
                    <option value="weekly">Once a week</option>
                  </RowSelect>
                </SettingRow>
                <SettingRow
                  title="Subfolder inside Downloads"
                  description="Relative folder inside your browser's Downloads directory where automatic backups are saved."
                >
                  <BufferedInput
                    value={settings.localBackupFolder}
                    onCommit={(val) => void patchSettings({ localBackupFolder: val })}
                    placeholder="TabVault"
                    className="w-48"
                  />
                </SettingRow>
                <SettingRow
                  title="Save each named session as its own file"
                  description="Otherwise writes one combined TabVault backup file."
                >
                  <RowSwitch
                    checked={settings.localBackupIndividual}
                    onCheckedChange={(v) => void patchSettings({ localBackupIndividual: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Backup right now"
                  description="Immediately writes a fresh backup file to your Downloads folder."
                >
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const granted = await ensureOptionalPermission({ permissions: ["downloads"] });
                      if (!granted) {
                        notify("Downloads permission is needed to save local backup files. Allow it in the browser prompt to continue.");
                        return;
                      }
                      try {
                        const res = await sendBg<{ files: number; sessions: number }>("backupNow");
                        await loadState();
                        notify(`Saved ${plural(res.files, "backup file")} (${plural(res.sessions, "session")}).`);
                      } catch (err) {
                        notify((err as Error).message);
                      }
                    }}
                  >
                    <HardDrive className="w-4 h-4" />
                    Back Up Now
                  </Button>
                </SettingRow>
                <SettingRow
                  title="Back up collections into Chrome Bookmarks"
                  description="Copies your collections as folders inside Other Bookmarks > TabVault so they sync with your browser and appear in address-bar search. One-way mirror: edits made in Chrome Bookmarks are overwritten on next sync."
                >
                  <RowSwitch
                    checked={settings.mirrorToBookmarks}
                    onCheckedChange={async (v) => {
                      if (v) {
                        const ok = await ensureOptionalPermission({ permissions: ["bookmarks"] });
                        if (!ok) {
                          notify("Bookmarks permission is needed to mirror collections. Allow it in the browser prompt to continue.");
                          return;
                        }
                      }
                      await patchSettings({ mirrorToBookmarks: v }, v ? "Bookmarks mirror enabled." : "Bookmarks mirror disabled.");
                    }}
                  />
                </SettingRow>
              </Card>

              <Card title="Google Drive Sync (Brave & Chrome Compatible)">
                {(driveSyncError || state?.lastSyncError) && (
                  <div className="px-4 py-2.5 bg-[var(--st-warn-bg)] text-[12px] text-[var(--st-warn-ink)]">
                    <strong>Sync notice:</strong> {driveSyncError || state?.lastSyncError}
                  </div>
                )}
                <SettingRow
                  title="Account status"
                  description={
                    state?.driveConnected
                      ? `Signed in as ${state.driveEmail || "Google user"}`
                      : "Syncs encrypted backups to your private Google Drive app folder."
                  }
                >
                  {state?.driveConnected ? (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={async () => {
                          try {
                            const res = await sendBg<{ email: string }>("driveSignIn", {
                              clientId: settings.driveClientId,
                              clientSecret: settings.driveClientSecret || "",
                            });
                            await loadState();
                            notify(`Reconnected as ${res.email}.`);
                          } catch (err) {
                            notify((err as Error).message);
                          }
                        }}
                      >
                        Reconnect
                      </Button>
                      <Button
                        variant="outline"
                        onClick={async () => {
                          await sendBg("driveSignOut");
                          await loadState();
                          notify("Signed out of Google Drive.");
                        }}
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={async () => {
                        const ok = await ensureOptionalPermission({ permissions: ["identity"] });
                        if (!ok) {
                          notify("Identity permission is needed to sign in to Google Drive. Allow it in the browser prompt to continue.");
                          return;
                        }
                        try {
                          const res = await sendBg<{ email: string }>("driveSignIn", {
                            clientId: settings.driveClientId,
                            clientSecret: settings.driveClientSecret || "",
                          });
                          await loadState();
                          notify(`Connected as ${res.email}.`);
                        } catch (err) {
                          notify((err as Error).message);
                        }
                      }}
                    >
                      Sign in with Google
                    </Button>
                  )}
                </SettingRow>
                <details open={Boolean(settings.driveClientId)} className="border-t border-[var(--st-border)]">
                  <summary className="px-4 py-2.5 text-[12px] font-medium text-[var(--st-muted)] hover:text-[var(--st-ink)] cursor-pointer select-none">
                    Custom Google OAuth App (Advanced)
                  </summary>
                  <div className="divide-y divide-[var(--st-border)] border-t border-[var(--st-border)]">
                    <SettingRow
                      title="Your Google App Client ID"
                      description="Optional: use your own Google Cloud OAuth Client ID instead of the built-in app."
                    >
                      <BufferedInput
                        value={settings.driveClientId}
                        onCommit={(val) => void patchSettings({ driveClientId: val.trim() })}
                        placeholder="xxxxxxxx.apps.googleusercontent.com"
                        className="w-72"
                      />
                    </SettingRow>
                    <SettingRow
                      title="Your Google App Client Secret (optional)"
                      description="Paste from the same OAuth screen for automatic refresh tokens; leave blank for 1-hour session sign-in."
                    >
                      <BackupPasswordField
                        ariaLabel="Your Google App Client Secret (optional)"
                        mode="unlock"
                        showStrength={false}
                        value={driveSecretDraft}
                        onChange={(val) => {
                          setDriveSecretDraft(val);
                          if (driveSecretTimerRef.current) clearTimeout(driveSecretTimerRef.current);
                          driveSecretTimerRef.current = setTimeout(() => {
                            driveSecretTimerRef.current = null;
                            void patchSettings({ driveClientSecret: val.trim() });
                          }, 450);
                        }}
                        placeholder="Optional — enables auto-refresh"
                        className="w-72"
                      />
                    </SettingRow>
                    <div className="px-4 py-3 bg-[var(--st-subtle)]/50 text-[12px] space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">How to get your Google Client ID (2-min setup)</span>
                        <a
                          href="https://console.cloud.google.com/apis/credentials"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--st-accent)] font-medium hover:underline"
                        >
                          Open Google Cloud Console ↗
                        </a>
                      </div>
                      <ol className="list-decimal pl-4 space-y-1 text-[var(--st-muted)]">
                        <li>Create or select a project and enable the <strong>Google Drive API</strong>.</li>
                        <li>
                          In <strong>OAuth consent screen</strong>, add scope{" "}
                          <code className="px-1 py-0.5 rounded bg-[var(--st-surface)] border border-[var(--st-border)]">
                            https://www.googleapis.com/auth/drive.appdata
                          </code>{" "}
                          (and add your email under Test Users if in Testing mode).
                        </li>
                        <li className="flex flex-wrap items-center gap-1.5">
                          <span>
                            In <strong>Credentials → Create OAuth client ID → Web application</strong>, add this Redirect URI:
                          </span>
                          <code className="px-1.5 py-0.5 rounded bg-[var(--st-surface)] border border-[var(--st-border)] text-[11px]">
                            {typeof chrome !== "undefined" && chrome.identity?.getRedirectURL
                              ? chrome.identity.getRedirectURL()
                              : "https://<extension-id>.chromiumapp.org/"}
                          </code>
                          <Button
                            variant="outline"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => {
                              const uri =
                                typeof chrome !== "undefined" && chrome.identity?.getRedirectURL
                                  ? chrome.identity.getRedirectURL()
                                  : "";
                              if (uri) {
                                void navigator.clipboard.writeText(uri);
                                notify("Copied Redirect URI.");
                              }
                            }}
                          >
                            Copy URI
                          </Button>
                        </li>
                        <li>
                          Paste the generated <code className="px-1 py-0.5 rounded bg-[var(--st-surface)]">*.apps.googleusercontent.com</code> Client ID (and Client Secret if you want automatic background refresh) above, then click <strong>Sign in with Google</strong>.
                        </li>
                      </ol>
                    </div>
                  </div>
                </details>
                <SettingRow
                  title="Sync automatically when changes occur"
                  description="Automatically uploads local changes and merges remote updates in the background."
                >
                  <RowSwitch
                    checked={settings.driveAutoSync}
                    onCheckedChange={(v) => void patchSettings({ driveAutoSync: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Include auto-saves in Drive sync"
                  description="Syncs rolling auto-save snapshots in addition to named sessions and collections."
                >
                  <RowSwitch
                    checked={settings.driveSyncAutoSaves}
                    onCheckedChange={(v) => void patchSettings({ driveSyncAutoSaves: v })}
                  />
                </SettingRow>
                <SettingRow
                  title="Password-protect cloud backups"
                  description="Encrypts sessions on this device before uploading to Google Drive. Your password is never stored or sent anywhere."
                >
                  <RowSwitch
                    checked={settings.driveEncryptE2E}
                    onCheckedChange={(v) => {
                      setDriveSyncError(null);
                      void patchSettings({ driveEncryptE2E: v });
                    }}
                  />
                </SettingRow>
                {settings.driveEncryptE2E && (
                  <div className="px-4 py-3 bg-[var(--st-warn-bg)]/70 text-[12px] text-[var(--st-warn-ink)] space-y-1">
                    <div>
                      <strong>No password reset:</strong> TabVault cannot recover or reset this password. Save it
                      in a password manager before syncing—without it, encrypted backups on Google Drive cannot be
                      unlocked.
                    </div>
                    {settings.driveAutoSync && (
                      <div className="text-[11.5px] opacity-90">
                        Because passwords are never saved to disk, automatic background sync is paused while encryption
                        is on. Use <strong>Sync Now</strong> below or in the Dashboard when you want to sync.
                      </div>
                    )}
                  </div>
                )}
                <SettingRow
                  title="Device name label for synced sessions"
                  description="Optional label to identify which computer a synced session came from."
                >
                  <BufferedInput
                    value={settings.deviceName}
                    onCommit={(val) => void patchSettings({ deviceName: val })}
                    placeholder="My Desktop"
                    className="w-48"
                  />
                </SettingRow>
                <SettingRow
                  title="Sync now"
                  description={
                    state?.lastSyncAt
                      ? `Last synced ${formatTimestamp(state.lastSyncAt, settings.timestampMode)}`
                      : "Not synced yet"
                  }
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-2">
                    {settings.driveEncryptE2E && (
                      <BackupPasswordField
                        ariaLabel="Cloud backup encryption password"
                        mode="setup"
                        value={drivePassword}
                        onChange={(next) => {
                          setDrivePassword(next);
                          if (driveSyncError) setDriveSyncError(null);
                        }}
                        placeholder="Backup password (12+ chars)"
                        error={driveSyncError}
                        className="w-64"
                      />
                    )}
                    <Button
                      variant="outline"
                      disabled={!state?.driveConnected}
                      onClick={async () => {
                        setDriveSyncError(null);
                        try {
                          const res = await sendBg<{ uploaded: number; imported: number }>("driveSyncNow", {
                            password: drivePassword || undefined,
                          });
                          await loadState();
                          notify(`Uploaded ${res.uploaded}, imported ${res.imported} sessions.`);
                        } catch (err) {
                          const msg = (err as Error).message;
                          if (settings.driveEncryptE2E) setDriveSyncError(msg);
                          notify(msg);
                        }
                      }}
                    >
                      <RefreshCw className="w-4 h-4" />
                      Sync Now
                    </Button>
                  </div>
                </SettingRow>
              </Card>
            </>
          )}

          {/* 7. FILTERS & PRIVACY (under Data) */}
          {category === "data" && (
            <Card title="Ignored Websites & Private Windows">
              <SettingRow title="Skip empty New Tab pages when saving">
                <RowSwitch
                  checked={settings.ignoreNewTabs}
                  onCheckedChange={(v) => void patchSettings({ ignoreNewTabs: v })}
                />
              </SettingRow>
              <SettingRow title="Skip internal browser settings and extension pages">
                <RowSwitch
                  checked={settings.ignoreBrowserFeatureTabs}
                  onCheckedChange={(v) => void patchSettings({ ignoreBrowserFeatureTabs: v })}
                />
              </SettingRow>
              <SettingRow
                title="Private / Incognito windows"
                description="Choose how TabVault handles tabs opened in private windows."
              >
                <RowSelect
                  value={settings.incognitoPolicy}
                  onChange={(e) =>
                    void patchSettings({ incognitoPolicy: e.target.value as Settings["incognitoPolicy"] })
                  }
                >
                  <option value="exclude">Do not capture private windows</option>
                  <option value="include">Include private windows in saves</option>
                  <option value="secureNoSave">Show open only, never write to disk</option>
                </RowSelect>
              </SettingRow>
              <SettingRow title="Use compact website icon cache to reduce storage size">
                <RowSwitch
                  checked={settings.compressFavicons}
                  onCheckedChange={(v) => void patchSettings({ compressFavicons: v })}
                />
              </SettingRow>
              <div className="p-4 space-y-2">
                <label htmlFor="st-ignore-patterns" className="text-[13px] font-medium block">
                  Never capture tabs matching these patterns (use * as wildcard, one per line)
                </label>
                <BufferedTextarea
                  id="st-ignore-patterns"
                  value={settings.ignoreUrlPatterns.join("\n")}
                  onCommit={(val) =>
                    void patchSettings({
                      ignoreUrlPatterns: val
                        .split(/\r?\n/)
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                  rows={5}
                  placeholder="chrome://settings/*&#10;*://bank.example.com/*"
                  className="w-full rounded-md border border-[var(--st-border)] bg-[var(--st-surface)] p-2.5 text-[12px] focus:outline-none focus:border-[var(--st-accent)]"
                />
              </div>
            </Card>
          )}

          {/* 8. IMPORT, EXPORT & DATA (under Data) */}
          {category === "data" && (
            <>
              <Card title="Storage Usage">
                <SettingRow title="Saved sessions & collections database">
                  <span className="text-[13px] font-medium tabular-nums">
                    {formatBytes(storageStats?.indexedDbBytes)}
                  </span>
                </SettingRow>
                <SettingRow title="Settings & quick startup cache">
                  <span className="text-[13px] font-medium tabular-nums">
                    {formatBytes(storageStats?.extensionLocalBytes)}
                  </span>
                </SettingRow>
                <SettingRow title="Total saved items">
                  <span className="text-[13px] text-[var(--st-muted)] tabular-nums">
                    {plural(state?.counts.auto ?? 0, "auto-save")} · {plural(state?.counts.named ?? 0, "saved session")} ·{" "}
                    {plural(state?.counts.collections ?? 0, "collection")}
                  </span>
                </SettingRow>
                <SettingRow
                  title="Compress all stored favicons"
                  description="Strip oversized inline icon data from existing saved sessions and collections to shrink database size."
                >
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const res = await sendBg<{ updatedSnapshots: number; updatedCollections: number }>("compressAllFavicons");
                      await loadState();
                      notify(
                        res.updatedSnapshots + res.updatedCollections > 0
                          ? `Compressed favicons in ${plural(res.updatedSnapshots, "session")} and ${plural(res.updatedCollections, "collection")}.`
                          : "All stored favicons are already compact."
                      );
                    }}
                  >
                    Compress All Favicons
                  </Button>
                </SettingRow>
                <SettingRow
                  title="Import Chrome Reading List"
                  description="Bring your saved Chrome Reading List links into TabVault as a Collection."
                >
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const ok = await ensureOptionalPermission({ permissions: ["readingList"] as chrome.runtime.ManifestPermission[] });
                      if (!ok) {
                        notify("Reading List permission was not granted.");
                        return;
                      }
                      const res = await sendBg<{ imported: number; collectionId: string | null }>("importReadingList");
                      await loadState();
                      notify(
                        res.imported > 0
                          ? `Imported ${plural(res.imported, "Reading List item")} into Collections.`
                          : res.collectionId
                            ? "All Chrome Reading List items are already in your collection."
                            : "Your Chrome Reading List is empty."
                      );
                    }}
                  >
                    <Upload className="w-4 h-4" />
                    Import Reading List
                  </Button>
                </SettingRow>
              </Card>

              <Card title="Settings Backup & Reset">
                <SettingRow
                  title="Export TabVault settings to a file"
                  description="Downloads your preferences as JSON (excludes OAuth secrets)."
                >
                  <Button
                    variant="outline"
                    onClick={() => {
                      const { driveClientSecret: _omitSecret, ...safeSettings } = settings;
                      triggerTextDownload(
                        "tabvault-settings.json",
                        JSON.stringify({ ...safeSettings, driveClientSecret: "" }, null, 2)
                      );
                      notify("Settings exported (Google Client Secret omitted for security).");
                    }}
                  >
                    <Download className="w-4 h-4" />
                    Export Settings
                  </Button>
                </SettingRow>
                <SettingRow
                  title="Import TabVault settings from a file"
                  description="Restores preferences from a previously exported settings JSON file."
                >
                  <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-[var(--st-border)] bg-[var(--st-surface)] text-[13px] font-medium hover:bg-[var(--st-subtle)] cursor-pointer">
                    <Upload className="w-4 h-4" />
                    Choose File
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = async () => {
                          try {
                            const parsed = JSON.parse(String(reader.result || "{}"));
                            const sanitized = sanitizeSettingsPatch(parsed);
                            if (Object.keys(sanitized).length === 0) {
                              notify("That file does not contain valid TabVault settings.");
                              return;
                            }
                            if (sanitized.driveClientSecret === "" && settings.driveClientSecret) {
                              delete sanitized.driveClientSecret;
                            }
                            await patchSettings(sanitized, "Settings imported.");
                          } catch {
                            notify("That file does not contain valid TabVault settings.");
                          }
                        };
                        reader.readAsText(file);
                      }}
                    />
                  </label>
                </SettingRow>
                <SettingRow
                  title="Reset all preferences to defaults"
                  description="Your saved sessions and collections will not be deleted."
                >
                  {confirmReset ? (
                    <div role="alertdialog" aria-label="Confirm resetting settings" className="flex items-center gap-2">
                      <Button variant="outline" onClick={() => setConfirmReset(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => {
                          setConfirmReset(false);
                          void patchSettings(DEFAULT_SETTINGS, "All settings reset to defaults.");
                        }}
                      >
                        Confirm Reset
                      </Button>
                    </div>
                  ) : (
                    <Button variant="danger" onClick={() => setConfirmReset(true)}>
                      <RotateCcw className="w-4 h-4" />
                      Reset Settings
                    </Button>
                  )}
                </SettingRow>
              </Card>
            </>
          )}
        </div>
      </main>
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-[100] rounded-lg bg-[var(--st-ink)] text-[var(--st-surface)] px-3.5 py-2 text-[13px] font-medium shadow-lg">
          {toast}
        </div>
      )}
      {!embedded && <GlobalTooltip />}
    </div>
  );
}

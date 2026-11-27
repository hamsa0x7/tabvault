import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { AlertTriangle, Check, Clock, Cloud, Copy, LogOut, Moon, RefreshCw, Send, X } from "lucide-react";
import { WORKER_BASE_URL } from "../shared/defaults.ts";
import { formatTimestamp } from "../shared/format.ts";
import { sendBg } from "../shared/rpc.ts";
import type { AppStateSummary } from "../shared/types.ts";
import { Button, Input, Textarea, cn } from "./ui.tsx";

const ACCOUNT_SEEN_KEY = "tabvault:accountMenuSeen";

function readAccountSeen(): boolean {
  try {
    return localStorage.getItem(ACCOUNT_SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

function markAccountSeen(): void {
  try {
    localStorage.setItem(ACCOUNT_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
      />
    </svg>
  );
}

export function HeaderAccountButton({
  state,
  onRefresh,
  onToast,
  compact = false,
}: {
  state: AppStateSummary | null;
  onRefresh: () => Promise<void> | void;
  onToast: (msg: string) => void;
  compact?: boolean;
}) {
  const [seen, setSeen] = useState<boolean>(() => readAccountSeen());
  const [busy, setBusy] = useState(false);
  const [e2ePassword, setE2ePassword] = useState("");

  const connected = Boolean(state?.driveConnected);
  const email = state?.driveEmail || "Google Account";
  const e2eLocked = Boolean(connected && state?.settings.driveEncryptE2E && state?.driveE2EUnlocked === false);

  const handleOpenChange = (open: boolean) => {
    if (open && !seen) {
      setSeen(true);
      markAccountSeen();
    }
  };

  const handleSignIn = async () => {
    setBusy(true);
    try {
      if (chrome.permissions?.request) {
        const granted = await chrome.permissions.request({ permissions: ["identity"] }).catch(() => false);
        if (!granted) {
          onToast("Allow Google Sign-In permission to continue.");
          return;
        }
      }
      const res = await sendBg<{ email: string }>("driveSignIn", {
        clientId: state?.settings.driveClientId || "",
        clientSecret: state?.settings.driveClientSecret || "",
      });
      await onRefresh();
      onToast(`Signed in as ${res.email}`);
    } catch (err) {
      onToast(String((err as Error)?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async (passwordOverride?: string) => {
    setBusy(true);
    try {
      const res = await sendBg<{ uploaded: number; imported: number }>("driveSyncNow", {
        password: passwordOverride || undefined,
      });
      setE2ePassword("");
      await onRefresh();
      onToast(`Synced: ${res.uploaded} uploaded, ${res.imported} imported`);
    } catch (err) {
      onToast(String((err as Error)?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    try {
      await sendBg("driveSignOut");
      await onRefresh();
      onToast("Signed out of Google");
    } catch (err) {
      onToast(String((err as Error)?.message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu.Root onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-tip={
            connected
              ? e2eLocked
                ? `Google: ${email} (Auto-sync paused — enter backup password)`
                : `Google: ${email}`
              : "Sign in with Google"
          }
          aria-label={connected ? `Google account (${email})` : "Sign in with Google"}
          className={cn(
            "relative inline-flex items-center justify-center gap-1.5 rounded-md transition-colors cursor-pointer shrink-0",
            compact
              ? "h-7 w-7 border border-[var(--st-border)] bg-[var(--st-surface)] hover:bg-[var(--st-subtle)] text-[var(--st-ink)]"
              : "h-8 px-2.5 border border-[var(--st-border)] bg-[var(--st-surface)] hover:bg-[var(--st-subtle)] text-[var(--st-ink)] text-[12px] font-medium"
          )}
        >
          <GoogleGlyph className="w-3.5 h-3.5 shrink-0" />
          {!compact && (
            <span className="max-w-[160px] truncate">
              {connected ? (e2eLocked ? `${email} · Locked` : email) : "Sign in"}
            </span>
          )}
          {connected && (
            <span
              className={cn(
                "w-2 h-2 rounded-full ring-2 ring-[var(--st-surface)] shrink-0",
                e2eLocked ? "bg-[var(--st-star)]" : "bg-[var(--st-success)]",
                compact && "absolute -bottom-0.5 -right-0.5"
              )}
              aria-hidden="true"
            />
          )}
          {!seen && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--st-accent)] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--st-accent)]" />
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] p-3 shadow-lg text-[var(--st-ink)] space-y-2.5"
        >
          {connected ? (
            <>
              <div className="space-y-0.5">
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] font-semibold",
                    e2eLocked ? "text-[var(--st-star)]" : "text-[var(--st-success)]"
                  )}
                >
                  <Cloud className="w-3.5 h-3.5" />
                  {e2eLocked ? "Auto-sync paused — enter backup password" : "Google Drive Connected"}
                </div>
                <div className="text-[12.5px] font-semibold truncate">{email}</div>
                <div className="text-[11px] text-[var(--st-muted)] truncate">
                  {state?.settings.deviceName ? `${state.settings.deviceName} · ` : ""}
                  {state?.lastSyncAt
                    ? `Last synced ${formatTimestamp(state.lastSyncAt, "relative")}`
                    : "Not synced yet"}
                </div>
                {state?.lastSyncError && (
                  <div className="text-[11px] text-[var(--st-danger)] leading-snug pt-0.5">
                    {state.lastSyncError}
                  </div>
                )}
              </div>
              {e2eLocked && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (e2ePassword.trim()) void handleSync(e2ePassword);
                  }}
                  className="space-y-1.5 pt-1 border-t border-[var(--st-border)]"
                >
                  <Input
                    type="password"
                    value={e2ePassword}
                    onChange={(e) => setE2ePassword(e.target.value)}
                    placeholder="Backup password to unlock…"
                    aria-label="Backup password to unlock auto-sync"
                    className="h-7 text-[11.5px]"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || !e2ePassword.trim()}
                    className="w-full h-7 text-[11.5px]"
                  >
                    Unlock &amp; Sync
                  </Button>
                </form>
              )}
              <div className="flex items-center gap-1.5 pt-1 border-t border-[var(--st-border)]">
                <Button
                  variant="primary"
                  disabled={busy}
                  className="flex-1 h-7 text-[11.5px]"
                  onClick={() => void handleSync()}
                >
                  <RefreshCw className={cn("w-3 h-3", busy && "animate-spin")} />
                  Sync Now
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  className="h-7 px-2.5 text-[11.5px]"
                  title="Sign out"
                  aria-label="Sign out"
                  onClick={() => void handleSignOut()}
                >
                  <LogOut className="w-3 h-3" />
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="space-y-0.5">
                <div className="text-[12.5px] font-semibold">Google Drive Sync</div>
                <p className="text-[11.5px] text-[var(--st-muted)] leading-snug">
                  Sign in with your Google account to back up and sync sessions in your private Drive app folder.
                </p>
              </div>
              <Button
                variant="primary"
                disabled={busy}
                className="w-full h-8 text-[12px]"
                onClick={() => void handleSignIn()}
              >
                <GoogleGlyph className="w-3.5 h-3.5 bg-white rounded-full p-0.5" />
                {busy ? "Signing in…" : "Sign in with Google"}
              </Button>
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * MV3 CSP-compliant Buy Me a Coffee button (no external script tags).
 */
export function BuyMeACoffeeButton({ compact = false }: { compact?: boolean }) {
  return (
    <a
      href="https://www.buymeacoffee.com/94arts"
      target="_blank"
      rel="noopener noreferrer"
      data-tip="Buy me a coffee"
      aria-label="Buy me a coffee"
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded-md border border-amber-950/20 bg-[#FFDD00] text-black font-semibold hover:brightness-95 transition-all shrink-0 no-underline",
        compact ? "h-7 w-7 text-[13px]" : "h-8 px-2.5 text-[12px]"
      )}
    >
      <span aria-hidden="true">☕</span>
      {!compact && <span>Buy me a coffee</span>}
    </a>
  );
}

const AUTO_SAVE_OPTIONS = [1, 5, 15, 30, 60] as const;
const BACKUP_OPTIONS = [
  ["off", "Off"],
  ["startup", "Startup"],
  ["hourly", "Hourly"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
] as const;

export function useDownloadsPermission() {
  const [granted, setGranted] = useState<boolean>(true);

  const recheck = async () => {
    try {
      if (chrome.permissions?.contains) {
        const ok = await chrome.permissions.contains({ permissions: ["downloads"] });
        setGranted(Boolean(ok));
        return Boolean(ok);
      }
    } catch {
      /* ignore */
    }
    return true;
  };

  useEffect(() => {
    void recheck();
    const onAdded = () => void recheck();
    const onRemoved = () => void recheck();
    chrome.permissions?.onAdded?.addListener(onAdded);
    chrome.permissions?.onRemoved?.addListener(onRemoved);
    return () => {
      chrome.permissions?.onAdded?.removeListener(onAdded);
      chrome.permissions?.onRemoved?.removeListener(onRemoved);
    };
  }, []);

  const request = async (): Promise<boolean> => {
    try {
      if (chrome.permissions?.request) {
        const ok = await chrome.permissions.request({ permissions: ["downloads"] });
        setGranted(Boolean(ok));
        return Boolean(ok);
      }
    } catch {
      /* ignore */
    }
    return false;
  };

  return { granted, request, recheck };
}

export function WelcomeInstallBanner({
  state,
  onRefresh,
  onToast,
  onDismiss,
}: {
  state: AppStateSummary | null;
  onRefresh: () => void | Promise<void>;
  onToast: (msg: string) => void;
  onDismiss: () => void;
}) {
  const [downloadsGranted, setDownloadsGranted] = useState(false);
  const [busyDownloads, setBusyDownloads] = useState(false);
  const [busyDrive, setBusyDrive] = useState(false);

  useEffect(() => {
    chrome.permissions
      ?.contains?.({ permissions: ["downloads"] })
      .then((ok) => setDownloadsGranted(Boolean(ok)))
      .catch(() => {});
  }, []);

  const handleAllowDownloads = async () => {
    if (busyDownloads || downloadsGranted) return;
    setBusyDownloads(true);
    try {
      const ok = await chrome.permissions.request({ permissions: ["downloads"] });
      setDownloadsGranted(Boolean(ok));
      if (ok) {
        onToast("Downloads backup permission enabled");
        await onRefresh();
      }
    } catch {
      onToast("Could not request Downloads permission.");
    } finally {
      setBusyDownloads(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (busyDrive || state?.driveConnected) return;
    setBusyDrive(true);
    try {
      if (chrome.permissions?.request) {
        const granted = await chrome.permissions.request({ permissions: ["identity"] }).catch(() => false);
        if (!granted) {
          onToast("Allow Google Sign-In permission to continue.");
          return;
        }
      }
      await sendBg("driveSignIn");
      let syncWarning: string | null = null;
      await sendBg("driveSyncNow").catch((err) => {
        syncWarning = String((err as Error)?.message || err);
      });
      await onRefresh();
      onToast(syncWarning ? `Signed in to Google Drive (initial sync paused: ${syncWarning})` : "Signed in to Google Drive");
    } catch (err) {
      onToast(String((err as Error).message || err));
    } finally {
      setBusyDrive(false);
    }
  };

  const intervalMin = state?.settings.autoSaveIntervalMin ?? 5;
  const driveConnected = Boolean(state?.driveConnected);
  const driveEmail = state?.driveEmail;

  return (
    <div className="rounded-xl border border-[var(--st-border)] bg-[var(--st-surface)] p-4 sm:p-5 shadow-sm space-y-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <img src="icons/logo.svg" alt="TabVault" className="w-8 h-8 rounded-lg shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <h2 className="text-[15px] font-bold tracking-tight text-[var(--st-ink)]">
              Welcome to TabVault
            </h2>
            <p className="text-[12.5px] text-[var(--st-muted)] leading-relaxed">
              TabVault automatically protects your open windows, tabs, and Chrome Tab Groups—and lets you save, organize, and restore them anytime.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss welcome banner"
          className="text-[var(--st-muted)] hover:text-[var(--st-ink)] p-1 rounded cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-2 text-[12px]">
        <div className="rounded-lg bg-[var(--st-subtle)] px-3 py-2 space-y-0.5">
          <div className="font-semibold text-[var(--st-ink)]">Auto-Save ({intervalMin}m)</div>
          <div className="text-[var(--st-muted)] leading-snug">
            On by default. Saves open windows automatically and on window close.
          </div>
        </div>
        <div className="rounded-lg bg-[var(--st-subtle)] px-3 py-2 space-y-0.5">
          <div className="font-semibold text-[var(--st-ink)]">Crash Recovery</div>
          <div className="text-[var(--st-muted)] leading-snug">
            On by default. Alerts you if tabs didn&apos;t reopen after a restart.
          </div>
        </div>
        <div className="rounded-lg bg-[var(--st-subtle)] px-3 py-2 space-y-0.5">
          <div className="font-semibold text-[var(--st-ink)]">Smart Restore &amp; Groups</div>
          <div className="text-[var(--st-muted)] leading-snug">
            Preserves Chrome Tab Groups and skips duplicate already-open tabs.
          </div>
        </div>
      </div>

      <div className="pt-1 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--st-border)]">
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            size="sm"
            variant={downloadsGranted ? "outline" : "primary"}
            disabled={busyDownloads || downloadsGranted}
            onClick={() => void handleAllowDownloads()}
          >
            {downloadsGranted && <Check className="w-3.5 h-3.5 text-[var(--st-success)]" />}
            {downloadsGranted
              ? "Downloads Backups Allowed"
              : busyDownloads
                ? "Requesting…"
                : "Allow Downloads Backups"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busyDrive || driveConnected}
            onClick={() => void handleGoogleSignIn()}
          >
            <Cloud className="w-3.5 h-3.5" />
            {driveConnected
              ? `Google Drive: ${driveEmail || "Connected"}`
              : busyDrive
                ? "Signing in…"
                : "Sign in with Google"}
          </Button>
        </div>
        <div className="pt-2">
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Skip for now
          </Button>
        </div>
      </div>
    </div>
  );
}

export function BackupPermissionBanner({
  onToast,
  compact = false,
  show = true,
}: {
  onToast: (msg: string) => void;
  compact?: boolean;
  show?: boolean;
}) {
  const { granted, request } = useDownloadsPermission();
  const [dismissed, setDismissed] = useState(false);

  if (!show || granted || dismissed) return null;

  return (
    <div
      className={cn(
        "bg-[var(--st-warn-bg)] border border-[var(--st-warn-bd)] text-[var(--st-warn-ink)] flex items-center justify-between gap-2 shrink-0",
        compact ? "mx-3 mt-2 p-2 rounded-lg text-[11.5px]" : "px-5 py-2 border-x-0 border-t-0 text-[12.5px]"
      )}
    >
      <div className="flex items-start gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span className="leading-snug">
          Auto-saves stay inside the extension and are deleted if TabVault is uninstalled. Allow{" "}
          <strong>Downloads</strong> access to save backup files to your computer.
        </span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="primary"
          className={cn(
            "bg-[var(--st-warn-cta)] text-[var(--st-warn-cta-fg)] hover:opacity-90",
            compact ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[11.5px]"
          )}
          onClick={async () => {
            const ok = await request();
            if (ok) {
              const res = await sendBg<{ files: number; sessions: number }>("backupNow").catch(() => null);
              onToast(
                res && typeof res.files === "number"
                  ? `File backup permission granted — saved ${res.files} backup file${res.files === 1 ? "" : "s"}`
                  : "File backup permission granted"
              );
            } else {
              onToast("Allow Downloads permission to save backup files");
            }
          }}
        >
          Allow Backups
        </Button>
        <button
          type="button"
          aria-label="Dismiss backup permission notice"
          data-tip="Dismiss for now"
          className="p-1 opacity-75 hover:opacity-100 cursor-pointer"
          onClick={() => setDismissed(true)}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function HeaderSleepButton({
  state,
  onRefresh,
  onToast,
  compact = false,
}: {
  state: AppStateSummary | null;
  onRefresh: () => void | Promise<void>;
  onToast: (msg: string) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const enabled = Boolean(state?.settings.suspenderEnabled);
  const mins = state?.settings.suspendAfterMin ?? 30;
  const tip = enabled
    ? `Tab Sleep ON (${mins}m idle) — click to disable`
    : "Tab Sleep OFF — click to enable";

  const handleToggle = async () => {
    if (busy || !state) return;
    setBusy(true);
    try {
      const next = !enabled;
      let autoEnabledFormGuard = false;
      const patch: Record<string, unknown> = { suspenderEnabled: next };
      if (next && !state.settings.guardUnsavedForms) {
        const hasScripting =
          Boolean(state.scriptingPermissionGranted) ||
          (await chrome.permissions?.contains?.({ permissions: ["scripting"] }).catch(() => false));
        if (hasScripting) {
          patch.guardUnsavedForms = true;
          autoEnabledFormGuard = true;
        }
      }
      await sendBg("setSettings", { patch });
      await onRefresh();
      if (!next) {
        onToast("Tab Sleep disabled");
      } else if (autoEnabledFormGuard) {
        onToast(`Tab Sleep enabled (${mins}m idle) with form protection`);
      } else if (!state.settings.guardUnsavedForms) {
        onToast(`Tab Sleep enabled (${mins}m idle). Enable Form Protection in Settings > Tab Sleep to guard typed text.`);
      } else {
        onToast(`Tab Sleep enabled (${mins}m idle)`);
      }
    } catch (err) {
      onToast(String((err as Error).message || err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size={compact ? "icon-sm" : "icon"}
      variant="outline"
      disabled={busy || !state}
      onClick={() => void handleToggle()}
      data-tip={tip}
      aria-label={tip}
      aria-pressed={enabled}
      className={cn(
        enabled && "border-[var(--st-accent)]/50 bg-[var(--st-accent-soft)] text-[var(--st-accent)] hover:bg-[var(--st-accent-soft)]"
      )}
    >
      <Moon className={cn("w-3.5 h-3.5", enabled && "fill-current")} />
    </Button>
  );
}

export function QuickIntervalButton({
  state,
  onRefresh,
  onToast,
  compact = false,
}: {
  state: AppStateSummary | null;
  onRefresh: () => Promise<void> | void;
  onToast: (msg: string) => void;
  compact?: boolean;
}) {
  const intervalMin = state?.settings.autoSaveIntervalMin ?? 5;
  const backupSched = state?.settings.localBackupSchedule ?? "daily";
  const { granted: downloadsGranted, request: requestDownloads } = useDownloadsPermission();

  const updatePatch = async (patch: Record<string, unknown>, msg: string) => {
    try {
      if (typeof patch.localBackupSchedule === "string" && patch.localBackupSchedule !== "off" && !downloadsGranted) {
        const ok = await requestDownloads();
        if (!ok) {
          onToast("Downloads permission is required to save backup files.");
          return;
        }
      }
      await sendBg("setSettings", { patch });
      await onRefresh();
      onToast(msg);
    } catch (err) {
      onToast(String((err as Error)?.message || err));
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          data-tip={
            downloadsGranted
              ? `Auto-save every ${intervalMin}m · Backup: ${backupSched}`
              : "Permission needed for Downloads backup files"
          }
          aria-label="Change auto-save and backup intervals"
          className={cn(
            "relative inline-flex items-center justify-center gap-1 rounded-md border border-[var(--st-border)] bg-[var(--st-surface)] hover:bg-[var(--st-subtle)] text-[var(--st-ink)] font-medium transition-colors cursor-pointer shrink-0 tabular-nums",
            compact ? "h-7 px-1.5 text-[11px]" : "h-8 px-2.5 text-[12px]"
          )}
        >
          <Clock className="w-3.5 h-3.5 text-[var(--st-accent)] shrink-0" />
          <span>{intervalMin}m</span>
          {!downloadsGranted && (
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5" aria-hidden="true">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--st-warn-cta)] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[var(--st-warn-cta)]" />
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] p-3 shadow-lg text-[var(--st-ink)] space-y-2.5"
        >
          {!downloadsGranted && (
            <div className="p-2 rounded-md bg-[var(--st-warn-bg)] border border-[var(--st-warn-bd)] text-[11px] text-[var(--st-warn-ink)] space-y-1.5">
              <p className="leading-snug">
                Auto-saves live inside the extension and are deleted if TabVault is uninstalled. Allow Downloads access to save backup files.
              </p>
              <Button
                variant="primary"
                className="w-full h-7 text-[11px] bg-[var(--st-warn-cta)] text-[var(--st-warn-cta-fg)] hover:opacity-90"
                onClick={async () => {
                  const ok = await requestDownloads();
                  onToast(ok ? "File backup permission granted" : "Downloads permission is needed for backup files.");
                }}
              >
                Allow Backup File Permission
              </Button>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-[var(--st-muted)] uppercase tracking-wide">
              Auto-Save Interval (In-App)
            </div>
            <div className="grid grid-cols-5 gap-1">
              {AUTO_SAVE_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => void updatePatch({ autoSaveEnabled: true, autoSaveIntervalMin: m }, `Auto-save set to ${m}m`)}
                  className={cn(
                    "h-7 rounded text-[11.5px] font-semibold cursor-pointer transition-colors tabular-nums",
                    intervalMin === m
                      ? "bg-[var(--st-accent)] text-[var(--st-accent-fg)]"
                      : "bg-[var(--st-subtle)] text-[var(--st-ink)] hover:opacity-85"
                  )}
                >
                  {m}m
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 pt-2 border-t border-[var(--st-border)]">
            <div className="text-[11px] font-semibold text-[var(--st-muted)] uppercase tracking-wide">
              Downloads Backup File
            </div>
            <div className="grid grid-cols-3 gap-1">
              {BACKUP_OPTIONS.map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => void updatePatch({ localBackupSchedule: val }, `Local backup: ${label}`)}
                  className={cn(
                    "h-7 rounded text-[11px] font-semibold cursor-pointer transition-colors",
                    backupSched === val
                      ? "bg-[var(--st-accent)] text-[var(--st-accent-fg)]"
                      : "bg-[var(--st-subtle)] text-[var(--st-ink)] hover:opacity-85"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export const GITHUB_ISSUES_URL = "https://github.com/94arts/tabvault/issues/new";

export function FeedbackDialog({
  open,
  onOpenChange,
  initialKind = "issue",
  onToast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialKind?: "issue" | "recommendation";
  onToast: (msg: string) => void;
}) {
  const [kind, setKind] = useState<"issue" | "recommendation">(initialKind);
  const [summary, setSummary] = useState("");
  const [details, setDetails] = useState("");
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setKind(initialKind);
  }, [open, initialKind]);

  const buildText = () => {
    const label = kind === "issue" ? "Issue Report" : "Recommendation / Feedback";
    const version = chrome.runtime?.getManifest?.().version || "1.0.0";
    return `**Type:** ${label}\n**TabVault Version:** v${version}\n\n**Summary:**\n${summary.trim()}\n\n**Details:**\n${details.trim() || "_No additional details provided._"}`;
  };

  const handleSubmitFeedback = async () => {
    if (!summary.trim()) {
      onToast("Please enter a short summary first.");
      return;
    }
    setSubmitting(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const prefix = kind === "issue" ? "[Issue]" : "[Recommendation]";
      const version = chrome.runtime?.getManifest?.().version || "1.0.0";
      const res = await fetch(`${WORKER_BASE_URL}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          kind,
          title: `${prefix} ${summary.trim()}`.slice(0, 200),
          body: buildText(),
          version,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; number?: number; error?: string } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setSummary("");
      setDetails("");
      onOpenChange(false);
      onToast(data.number ? `Submitted! (#${data.number})` : "Submitted! Thank you for your feedback.");
    } catch {
      onToast("Could not submit right now. You can Copy and try again.");
    } finally {
      clearTimeout(timer);
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!summary.trim()) {
      onToast("Please enter a short summary first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(buildText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      onToast("Copied to clipboard");
    } catch {
      onToast("Could not access clipboard.");
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[var(--st-border)] bg-[var(--st-surface)] p-4 shadow-xl text-[var(--st-ink)] space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Dialog.Title className="text-[14px] font-bold">
              Issues &amp; Recommendations
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="text-[var(--st-muted)] hover:text-[var(--st-ink)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-[var(--st-subtle)]">
            <button
              type="button"
              onClick={() => setKind("issue")}
              className={cn(
                "h-7 rounded-md text-[12px] font-semibold transition-colors cursor-pointer",
                kind === "issue"
                  ? "bg-[var(--st-surface)] text-[var(--st-ink)] shadow-sm"
                  : "text-[var(--st-muted)] hover:text-[var(--st-ink)]"
              )}
            >
              Report an Issue
            </button>
            <button
              type="button"
              onClick={() => setKind("recommendation")}
              className={cn(
                "h-7 rounded-md text-[12px] font-semibold transition-colors cursor-pointer",
                kind === "recommendation"
                  ? "bg-[var(--st-surface)] text-[var(--st-ink)] shadow-sm"
                  : "text-[var(--st-muted)] hover:text-[var(--st-ink)]"
              )}
            >
              Recommendations / Feedback
            </button>
          </div>

          <div className="space-y-2">
            <Input
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={
                kind === "issue"
                  ? "Short summary of the bug or issue…"
                  : "What feature or improvement would help?"
              }
              aria-label="Summary"
              className="w-full h-8 text-[12.5px]"
            />
            <Textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={4}
              placeholder={
                kind === "issue"
                  ? "Steps to reproduce or what you expected…"
                  : "How would you use this in your workflow?"
              }
              aria-label="Details"
              className="resize-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="outline"
              className="h-8 px-3 text-[12px]"
              onClick={() => void handleCopy()}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button
              variant="primary"
              className="h-8 px-3 text-[12px]"
              disabled={submitting}
              onClick={() => void handleSubmitFeedback()}
            >
              <Send className="w-3.5 h-3.5" />
              {submitting ? "Submitting…" : "Submit Issue / Feedback"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

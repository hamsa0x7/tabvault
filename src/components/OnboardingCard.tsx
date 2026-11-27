import React, { useEffect, useState } from "react";
import { Check, CheckCircle2, Circle, Cloud, HelpCircle, Smartphone, X } from "lucide-react";
import type { OnboardingProgress } from "../shared/onboarding.ts";
import { sendBg } from "../shared/rpc.ts";
import { Button, cn } from "./ui.tsx";

export interface OnboardingStepItem {
  id: string;
  title: string;
  description: string;
  done: boolean;
  actionLabel: string;
  onAction: () => void;
  disabled?: boolean;
}

interface OnboardingCardProps {
  variant?: "compact" | "wide";
  autoSaveIntervalMin: number;
  progress: OnboardingProgress;
  steps: OnboardingStepItem[];
  onDismiss: () => void;
  onOpenGuide?: () => void;
  showSetupBar?: boolean;
  driveConnected?: boolean;
  driveEmail?: string | null;
  mirrorToBookmarks?: boolean;
  onRefresh?: () => void | Promise<void>;
  onToast?: (msg: string) => void;
}

/**
 * First-run welcome & activation checklist card shared between Side Panel and Dashboard.
 * Combines default protection summary, optional backup/cloud setup, and action-first milestones.
 */
export function OnboardingCard({
  variant = "wide",
  autoSaveIntervalMin,
  progress,
  steps,
  onDismiss,
  onOpenGuide,
  showSetupBar = false,
  driveConnected = false,
  driveEmail,
  mirrorToBookmarks = false,
  onRefresh,
  onToast,
}: OnboardingCardProps) {
  const isCompact = variant === "compact";
  const [downloadsGranted, setDownloadsGranted] = useState(false);
  const [bookmarksGranted, setBookmarksGranted] = useState(false);
  const [busyDownloads, setBusyDownloads] = useState(false);
  const [busyDrive, setBusyDrive] = useState(false);
  const [busyMobile, setBusyMobile] = useState(false);

  useEffect(() => {
    if (isCompact || !showSetupBar) return;
    chrome?.permissions
      ?.contains?.({ permissions: ["downloads"] })
      .then((ok) => setDownloadsGranted(Boolean(ok)))
      .catch(() => {});
    chrome?.permissions
      ?.contains?.({ permissions: ["bookmarks"] })
      .then((ok) => setBookmarksGranted(Boolean(ok)))
      .catch(() => {});
  }, [isCompact, showSetupBar]);

  const handleAllowDownloads = async () => {
    if (busyDownloads || downloadsGranted) return;
    setBusyDownloads(true);
    try {
      const ok = await chrome.permissions.request({ permissions: ["downloads"] });
      setDownloadsGranted(Boolean(ok));
      if (ok) {
        const res = await sendBg<{ files: number; sessions: number }>("backupNow").catch(() => null);
        onToast?.(
          res && typeof res.files === "number"
            ? `Downloads backup enabled — saved ${res.files} backup file${res.files === 1 ? "" : "s"}`
            : "Downloads backup permission enabled"
        );
        await onRefresh?.();
      }
    } catch {
      onToast?.("Could not request Downloads permission.");
    } finally {
      setBusyDownloads(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (busyDrive || driveConnected) return;
    setBusyDrive(true);
    try {
      if (chrome?.permissions?.request) {
        const granted = await chrome.permissions.request({ permissions: ["identity"] }).catch(() => false);
        if (!granted) {
          onToast?.("Allow Google Sign-In permission to continue.");
          return;
        }
      }
      await sendBg("driveSignIn");
      let syncWarning: string | null = null;
      await sendBg("driveSyncNow").catch((err) => {
        syncWarning = String((err as Error)?.message || err);
      });
      await onRefresh?.();
      onToast?.(syncWarning ? `Signed in to Google Drive (initial sync paused: ${syncWarning})` : "Signed in to Google Drive");
    } catch (err) {
      onToast?.(String((err as Error).message || err));
    } finally {
      setBusyDrive(false);
    }
  };

  const handleEnableMobileSync = async () => {
    if (busyMobile || (mirrorToBookmarks && bookmarksGranted)) return;
    setBusyMobile(true);
    try {
      if (chrome?.permissions?.request) {
        const granted = await chrome.permissions.request({ permissions: ["bookmarks"] }).catch(() => false);
        setBookmarksGranted(Boolean(granted));
        if (!granted) {
          onToast?.("Allow Bookmarks permission to access collections on mobile.");
          return;
        }
      } else {
        setBookmarksGranted(true);
      }
      await sendBg("setSettings", { patch: { mirrorToBookmarks: true } });
      await onRefresh?.();
      onToast?.("Collections mirrored to Other Bookmarks > TabVault (syncs via your Chrome profile)");
    } catch (err) {
      onToast?.(String((err as Error)?.message || err));
    } finally {
      setBusyMobile(false);
    }
  };

  return (
    <section
      aria-label="Getting started"
      className={cn(
        "rounded-lg border border-[var(--st-accent)]/30 bg-[var(--st-accent-soft)]/55 text-[var(--st-ink)]",
        isCompact ? "p-2.5 space-y-2" : "p-3.5 space-y-3"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {!isCompact && (
            <img src="icons/logo.svg" alt="TabVault" className="w-7 h-7 rounded-md shrink-0 mt-0.5" />
          )}
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className={cn("font-semibold leading-tight", isCompact ? "text-[12.5px]" : "text-[14px]")}>
                {progress.allDone
                  ? "You’re all set"
                  : isCompact
                    ? "Auto-save is protecting your tabs"
                    : "Welcome to TabVault — your tabs are auto-protected"}
              </h2>
              <span className="text-[10.5px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full bg-[var(--st-surface)] border border-[var(--st-border)] text-[var(--st-accent)]">
                {progress.completedCount}/{progress.totalCount}
              </span>
            </div>
            <p className={cn("text-[var(--st-muted)]", isCompact ? "text-[11px]" : "text-[12px]")}>
              {progress.allDone
                ? "Your sessions are backed up and organized. Dismiss this anytime."
                : isCompact
                  ? `Saves every ${autoSaveIntervalMin}m automatically. Try these to get started:`
                  : `Auto-saves every ${autoSaveIntervalMin}m, recovers crashes, preserves Tab Groups, and restores without duplicates.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {!isCompact && onOpenGuide && (
            <Button
              variant="outline"
              className="h-7 px-2.5 text-[11.5px]"
              onClick={onOpenGuide}
            >
              <HelpCircle className="w-3.5 h-3.5" />
              Quick Guide
            </Button>
          )}
          <Button
            variant="ghost"
            size={isCompact ? "icon" : "default"}
            className={isCompact ? "h-6 w-6" : "h-7 px-2 text-[11.5px]"}
            title="Skip getting started"
            aria-label="Skip getting started"
            onClick={onDismiss}
          >
            {isCompact ? <X className="w-3.5 h-3.5" /> : "Skip"}
          </Button>
        </div>
      </div>

      {!progress.allDone ? (
        <div className={cn("grid gap-1.5", !isCompact && "md:grid-cols-2 xl:grid-cols-4 md:gap-2")}>
          {steps.map((step) => (
            <div
              key={step.id}
              className={cn(
                "rounded-md border px-2.5 py-2 flex items-center justify-between gap-2 bg-[var(--st-surface)] transition-colors",
                step.done
                  ? "border-[var(--st-border)] opacity-80"
                  : "border-[var(--st-border)] hover:border-[var(--st-accent)]/60"
              )}
            >
              <div className="flex items-start gap-2 min-w-0">
                {step.done ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--st-accent)] shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <Circle className="w-4 h-4 text-[var(--st-muted)] shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <div
                    className={cn(
                      "font-medium leading-snug truncate",
                      isCompact ? "text-[11.5px]" : "text-[12px]",
                      step.done && "line-through text-[var(--st-muted)]"
                    )}
                  >
                    {step.title}
                  </div>
                  <div
                    className={cn(
                      "text-[var(--st-muted)] leading-snug mt-0.5 line-clamp-2",
                      isCompact ? "text-[10.5px]" : "text-[11px]"
                    )}
                  >
                    {step.description}
                  </div>
                </div>
              </div>

              {!step.done && (
                <Button
                  variant="outline"
                  disabled={step.disabled}
                  onClick={step.onAction}
                  data-tip={step.description}
                  className={cn(
                    "shrink-0",
                    isCompact ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-[11.5px]"
                  )}
                >
                  {step.actionLabel}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-end">
          <Button
            variant="primary"
            className={isCompact ? "h-6 px-2.5 text-[11px]" : "h-7 px-3 text-[12px]"}
            onClick={onDismiss}
          >
            <Check className="w-3.5 h-3.5" />
            Done
          </Button>
        </div>
      )}

      {!isCompact && showSetupBar && (
        <div className="pt-2.5 border-t border-[var(--st-accent)]/20 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11.5px] font-medium text-[var(--st-muted)]">
            Optional backups &amp; cloud sync:
          </span>
          <div className="flex flex-wrap items-center gap-2">
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
            <Button
              size="sm"
              variant="outline"
              disabled={busyMobile || (mirrorToBookmarks && bookmarksGranted)}
              data-tip="One-way mirror to Other Bookmarks > TabVault (syncs to Chrome Mobile via your Chrome profile)"
              onClick={() => void handleEnableMobileSync()}
            >
              {mirrorToBookmarks && bookmarksGranted ? (
                <Check className="w-3.5 h-3.5 text-[var(--st-success)]" />
              ) : (
                <Smartphone className="w-3.5 h-3.5" />
              )}
              {mirrorToBookmarks && bookmarksGranted
                ? "Bookmarks Mirror On"
                : busyMobile
                  ? "Enabling…"
                  : "Access on Mobile"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

interface EmptyStateCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  compact?: boolean;
}

/**
 * Actionable empty-state surface explaining what belongs here, why it matters,
 * and the immediate next step.
 */
export function EmptyStateCard({
  icon,
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  compact = false,
}: EmptyStateCardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-[var(--st-border)] bg-[var(--st-surface)] text-center flex flex-col items-center justify-center",
        compact ? "px-4 py-6 space-y-2.5" : "px-6 py-10 space-y-3"
      )}
    >
      <div
        className={cn(
          "rounded-lg bg-[var(--st-subtle)] text-[var(--st-accent)] grid place-items-center",
          compact ? "w-9 h-9" : "w-10 h-10"
        )}
        aria-hidden="true"
      >
        {icon}
      </div>
      <div className="space-y-1 max-w-sm">
        <div className={cn("font-semibold text-[var(--st-ink)]", compact ? "text-[12.5px]" : "text-[14px]")}>
          {title}
        </div>
        <p className={cn("text-[var(--st-muted)] leading-relaxed", compact ? "text-[11.5px]" : "text-[12.5px]")}>
          {description}
        </p>
      </div>
      {(primaryLabel || secondaryLabel) && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
          {primaryLabel && onPrimary && (
            <Button
              variant="primary"
              className={compact ? "h-7 px-3 text-[11.5px]" : "h-8 px-3.5 text-[12.5px]"}
              onClick={onPrimary}
            >
              {primaryLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button
              variant="outline"
              className={compact ? "h-7 px-2.5 text-[11.5px]" : "h-8 px-3 text-[12.5px]"}
              onClick={onSecondary}
            >
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

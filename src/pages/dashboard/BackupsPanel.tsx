import { useCallback, useEffect, useState } from "react";
import { Cloud, Download, FolderOpen, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "../../components/ui.tsx";
import { formatTimestamp, plural, triggerTextDownload } from "../../shared/format.ts";
import { sendBg } from "../../shared/rpc.ts";
import type { AppStateSummary, Settings } from "../../shared/types.ts";

interface LocalBackupFile {
  id: number;
  filename: string;
  shortName: string;
  fileSize: number;
  startTime: string;
}

interface DriveBackupInfo {
  exists: boolean;
  id?: string;
  name?: string;
  size?: number;
  modifiedTime?: string;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function BackupsPanel({
  state,
  settings,
  tsMode,
  driveSyncPassword,
  onReload,
  onNotify,
  onConfigureDrive,
}: {
  state: AppStateSummary | null;
  settings: Settings;
  tsMode: Settings["timestampMode"];
  driveSyncPassword: string;
  onReload: () => Promise<void>;
  onNotify: (msg: string) => void;
  onConfigureDrive: () => void;
}) {
  const [localFiles, setLocalFiles] = useState<LocalBackupFile[]>([]);
  const [downloadsGranted, setDownloadsGranted] = useState<boolean>(true);
  const [driveInfo, setDriveInfo] = useState<DriveBackupInfo | null>(null);
  const [loadingDrive, setLoadingDrive] = useState(false);

  const loadLocal = useCallback(async () => {
    try {
      const res = await sendBg<{ granted: boolean; files: LocalBackupFile[] }>("listLocalBackups");
      setDownloadsGranted(res.granted);
      setLocalFiles(res.files);
    } catch {
      /* ignore */
    }
  }, []);

  const loadDrive = useCallback(async () => {
    if (!state?.driveConnected) {
      setDriveInfo(null);
      return;
    }
    setLoadingDrive(true);
    try {
      const info = await sendBg<DriveBackupInfo>("getDriveBackupInfo");
      setDriveInfo(info);
    } catch {
      setDriveInfo(null);
    } finally {
      setLoadingDrive(false);
    }
  }, [state?.driveConnected]);

  useEffect(() => {
    void loadLocal();
    void loadDrive();
  }, [loadLocal, loadDrive]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Local File Backups */}
      <div className="rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] p-4 space-y-3 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[14px]">Local File Backups</span>
          <HardDrive className="w-4 h-4 text-[var(--st-success)]" />
        </div>
        <div className="text-[12px] text-[var(--st-muted)] space-y-0.5">
          <div>
            Schedule: <strong className="text-[var(--st-ink)]">{settings.localBackupSchedule}</strong> · Folder:{" "}
            <strong className="text-[var(--st-ink)]">{settings.localBackupFolder || "TabVault"}</strong>
          </div>
          <div>
            Last backup: {state?.lastBackupAt ? formatTimestamp(state.lastBackupAt, tsMode) : "Never"}
          </div>
        </div>
        {state?.lastBackupError && (
          <div className="p-2 rounded-md bg-[var(--st-warn-bg)] border border-[var(--st-warn-bd)] text-[11.5px] text-[var(--st-warn-ink)]">
            {state.lastBackupError}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            title="Write a new JSON backup file to Downloads now"
            onClick={async () => {
              try {
                if (chrome.permissions?.request) {
                  const ok = await chrome.permissions.request({ permissions: ["downloads"] }).catch(() => false);
                  if (!ok) {
                    onNotify("Downloads permission is needed to save local backup files.");
                    return;
                  }
                }
                const res = await sendBg<{ files: number }>("backupNow");
                await onReload();
                await loadLocal();
                onNotify(`Saved ${plural(res.files, "backup file")}.`);
              } catch (err) {
                onNotify((err as Error).message);
              }
            }}
          >
            Back Up Now
          </Button>
          {settings.localBackupSchedule === "off" && (
            <Button
              variant="outline"
              title="Automatically save a backup to Downloads every day so your data survives extension uninstalls"
              onClick={async () => {
                try {
                  if (chrome.permissions?.request) {
                    const ok = await chrome.permissions.request({ permissions: ["downloads"] }).catch(() => false);
                    if (!ok) {
                      onNotify("Downloads permission is needed for automatic local backups.");
                      return;
                    }
                  }
                  await sendBg("setSettings", { patch: { localBackupSchedule: "daily" } });
                  await onReload();
                  await loadLocal();
                  onNotify("Daily auto-backup to Downloads enabled.");
                } catch (err) {
                  onNotify((err as Error).message);
                }
              }}
            >
              Enable Daily Auto-Backup
            </Button>
          )}
        </div>

        <div className="pt-2 border-t border-[var(--st-border)] space-y-2 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-[var(--st-muted)] uppercase tracking-wide">
              Saved Backup Files ({localFiles.length})
            </span>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              title="Refresh local backup list"
              onClick={() => void loadLocal()}
            >
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
          {!downloadsGranted ? (
            <p className="text-[11.5px] text-[var(--st-muted)]">
              Grant Downloads permission via <strong>Back Up Now</strong> to view and manage backup files here.
            </p>
          ) : localFiles.length === 0 ? (
            <p className="text-[11.5px] text-[var(--st-muted)]">
              No backup files found in Downloads yet. Click <strong>Back Up Now</strong> to create one.
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto scroll-thin rounded-md border border-[var(--st-border)] divide-y divide-[var(--st-border)]">
              {localFiles.map((f) => (
                <div key={f.id} className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[12px]">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{f.shortName}</div>
                    <div className="text-[11px] text-[var(--st-muted)] tabular-nums">
                      {formatBytes(f.fileSize)}
                      {f.startTime ? ` · ${formatTimestamp(Date.parse(f.startTime), tsMode)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Show file in folder"
                      onClick={() => void sendBg("showLocalBackup", { id: f.id })}
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-[var(--st-danger)]"
                      title="Delete backup file from disk"
                      onClick={async () => {
                        if (!window.confirm(`Delete "${f.shortName}" from your computer?`)) return;
                        await sendBg("deleteLocalBackup", { id: f.id });
                        await loadLocal();
                        onNotify(`Deleted ${f.shortName}`);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Google Drive Cloud Backups */}
      <div className="rounded-lg border border-[var(--st-border)] bg-[var(--st-surface)] p-4 space-y-3 flex flex-col">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-[14px]">Google Drive Sync</span>
          <Cloud className="w-4 h-4 text-[var(--st-accent)]" />
        </div>
        <p className="text-[12px] text-[var(--st-muted)]">
          {state?.driveConnected ? `Connected as ${state.driveEmail || "Google account"}` : "Not connected"}
        </p>
        {state?.lastSyncError && (
          <div className="p-2 rounded-md bg-[var(--st-warn-bg)] border border-[var(--st-warn-bd)] text-[11.5px] text-[var(--st-warn-ink)]">
            {state.lastSyncError}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={!state?.driveConnected}
            title="Sync local sessions and collections with Google Drive now"
            onClick={async () => {
              try {
                const res = await sendBg<{ uploaded: number; imported: number }>("driveSyncNow", {
                  password: driveSyncPassword || undefined,
                });
                await onReload();
                await loadDrive();
                onNotify(`Synced: ${res.uploaded} uploaded, ${res.imported} imported.`);
              } catch (err) {
                onNotify((err as Error).message);
              }
            }}
          >
            Sync Now
          </Button>
          <Button
            variant="outline"
            title="Open Google Drive sign-in and encryption settings"
            onClick={onConfigureDrive}
          >
            Configure
          </Button>
        </div>

        <div className="pt-2 border-t border-[var(--st-border)] space-y-2 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-[var(--st-muted)] uppercase tracking-wide">
              Cloud Backup File
            </span>
            {state?.driveConnected && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                title="Refresh Google Drive backup status"
                onClick={() => void loadDrive()}
              >
                <RefreshCw className={`w-3 h-3 ${loadingDrive ? "animate-spin" : ""}`} />
              </Button>
            )}
          </div>
          {!state?.driveConnected ? (
            <p className="text-[11.5px] text-[var(--st-muted)]">
              Sign in with Google to inspect, download, or manage your cloud backup file.
            </p>
          ) : loadingDrive && !driveInfo ? (
            <p className="text-[11.5px] text-[var(--st-muted)]">Checking Google Drive appDataFolder…</p>
          ) : !driveInfo?.exists ? (
            <p className="text-[11.5px] text-[var(--st-muted)]">
              No cloud backup file yet. Click <strong>Sync Now</strong> to upload your first backup.
            </p>
          ) : (
            <div className="rounded-md border border-[var(--st-border)] p-2.5 space-y-2 text-[12px]">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{driveInfo.name}</div>
                  <div className="text-[11px] text-[var(--st-muted)] tabular-nums">
                    {formatBytes(driveInfo.size)}
                    {driveInfo.modifiedTime
                      ? ` · Updated ${formatTimestamp(Date.parse(driveInfo.modifiedTime), tsMode)}`
                      : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  className="h-7 px-2.5 text-[11.5px]"
                  title="Download a local copy of your Google Drive backup file"
                  onClick={async () => {
                    try {
                      const raw = await sendBg<string>("downloadDriveBackup");
                      const stamp = new Date().toISOString().slice(0, 10);
                      triggerTextDownload(`tabvault-cloud-copy-${stamp}.json`, raw);
                      onNotify("Downloaded cloud backup copy.");
                    } catch (err) {
                      onNotify((err as Error).message);
                    }
                  }}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Copy
                </Button>
                <Button
                  variant="outline"
                  className="h-7 px-2.5 text-[11.5px] text-[var(--st-danger)]"
                  title="Delete the remote backup file from your Google Drive"
                  onClick={async () => {
                    if (!window.confirm("Delete your remote Google Drive backup file? Local data is not affected.")) return;
                    try {
                      await sendBg("deleteDriveBackup");
                      await loadDrive();
                      onNotify("Deleted remote Google Drive backup.");
                    } catch (err) {
                      onNotify((err as Error).message);
                    }
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Cloud Backup
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import * as Dialog from "@radix-ui/react-dialog";
import { Download, Lock, ShieldCheck, X } from "lucide-react";
import { BackupPasswordField } from "../../components/BackupPasswordField.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { Button, Input, Select, Switch, Textarea, cn } from "../../components/ui.tsx";
import type { DashboardController } from "../../hooks/useDashboardController.ts";
import { COLLECTION_COLORS } from "../../shared/defaults.ts";
import { isEncryptedBackupText } from "../../shared/password-strength.ts";

export { COLLECTION_COLORS };

export function DashboardDialogs({ ctrl }: { ctrl: DashboardController }) {
  const isEncryptedImport = isEncryptedBackupText(ctrl.importText);
  return (
    <>
      {/* Save Named Session Dialog */}
      <Dialog.Root open={ctrl.saveDialogOpen} onOpenChange={ctrl.setSaveDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-2xl border border-[var(--st-border)] bg-[var(--st-surface)] text-[var(--st-ink)] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-[15px] font-semibold">
                {ctrl.saveWindowId != null ? "Save This Window as Session" : "Save All Open Windows"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button size="icon" variant="ghost" aria-label="Close dialog">
                  <X className="w-4 h-4" />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Name and tag your saved session before storing it locally.
            </Dialog.Description>
            {ctrl.saveMatchInfo?.exact && (
              <div className="p-2.5 rounded-lg bg-[var(--st-warn-bg)] border border-[var(--st-warn-bd)] text-[12px] text-[var(--st-warn-ink)]">
                Already saved as <strong>{ctrl.saveMatchInfo.exact.name}</strong>. You can still save a copy if needed.
              </div>
            )}
            {ctrl.saveMatchInfo?.closest && !ctrl.saveMatchInfo.exact && (
              <div className="p-2.5 rounded-lg bg-[var(--st-accent-soft)] border border-[var(--st-accent)]/30 text-[12px] flex items-center justify-between gap-2">
                <span>
                  {Math.round(ctrl.saveMatchInfo.closest.overlap * 100)}% match with{" "}
                  <strong>{ctrl.saveMatchInfo.closest.meta.name}</strong>
                </span>
                <Button
                  type="button"
                  variant="primary"
                  className="h-7 px-2.5 text-[11px]"
                  disabled={ctrl.busy}
                  onClick={(e) => void ctrl.handleSaveNamedSubmit(e, ctrl.saveMatchInfo!.closest!.meta.id)}
                >
                  Update Existing
                </Button>
              </div>
            )}
            <form onSubmit={(e) => void ctrl.handleSaveNamedSubmit(e)} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="st-save-name" className="text-[12px] font-medium">Session name</label>
                <Input
                  id="st-save-name"
                  value={ctrl.saveNameInput}
                  onChange={(e) => ctrl.setSaveNameInput(e.target.value)}
                  placeholder="Optional — defaults to current date & time"
                  className="w-full"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="st-save-tags" className="text-[12px] font-medium">Tags (comma-separated)</label>
                <Input
                  id="st-save-tags"
                  value={ctrl.saveTagsInput}
                  onChange={(e) => ctrl.setSaveTagsInput(e.target.value)}
                  placeholder="work, research, reading"
                  className="w-full"
                />
              </div>
              <label className="flex items-center justify-between text-[13px] pt-1">
                <span>Open automatically when browser starts</span>
                <Switch checked={ctrl.saveStartupReg} onCheckedChange={ctrl.setSaveStartupReg} />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" disabled={ctrl.busy}>
                  Save Session
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* New Collection / Folder Dialog */}
      <Dialog.Root open={ctrl.newColDialogOpen} onOpenChange={ctrl.setNewColDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md rounded-2xl border border-[var(--st-border)] bg-[var(--st-surface)] text-[var(--st-ink)] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-[15px] font-semibold">
                {ctrl.newColKind === "folder" ? "New Folder" : "New Collection"}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button size="icon" variant="ghost" aria-label="Close dialog">
                  <X className="w-4 h-4" />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Create a new collection or folder to organize tabs.
            </Dialog.Description>
            <form onSubmit={(e) => void ctrl.handleCreateCollectionSubmit(e)} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="st-col-title" className="text-[12px] font-medium">Title</label>
                <Input
                  id="st-col-title"
                  value={ctrl.newColTitle}
                  onChange={(e) => ctrl.setNewColTitle(e.target.value)}
                  placeholder={ctrl.newColKind === "folder" ? "Project Workspace" : "Reading List"}
                  className="w-full"
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label htmlFor="st-col-type" className="text-[12px] font-medium">Type</label>
                  <Select
                    id="st-col-type"
                    value={ctrl.newColKind}
                    onChange={(e) => ctrl.setNewColKind(e.target.value as "group" | "folder")}
                    className="w-full"
                  >
                    <option value="group">Collection</option>
                    <option value="folder">Folder</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="st-col-parent" className="text-[12px] font-medium">Parent folder</label>
                  <Select
                    id="st-col-parent"
                    value={ctrl.newColParent}
                    onChange={(e) => ctrl.setNewColParent(e.target.value)}
                    className="w-full"
                  >
                    <option value="">Top level</option>
                    {ctrl.folders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <span className="text-[12px] font-medium block">Tile color</span>
                <div className="flex items-center gap-2 pt-1" role="radiogroup" aria-label="Tile color">
                  {COLLECTION_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Select color ${c}`}
                      aria-pressed={ctrl.newColColor === c}
                      onClick={() => ctrl.setNewColColor(c)}
                      className={cn(
                        "w-6 h-6 rounded cursor-pointer",
                        ctrl.newColColor === c && "ring-2 ring-offset-2 ring-[var(--st-ink)]"
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Dialog.Close asChild>
                  <Button variant="outline">Cancel</Button>
                </Dialog.Close>
                <Button type="submit" variant="primary">
                  Create
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Import / Export Dialog */}
      <Dialog.Root open={ctrl.importDialogOpen} onOpenChange={ctrl.setImportDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg rounded-2xl border border-[var(--st-border)] bg-[var(--st-surface)] text-[var(--st-ink)] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-[15px] font-semibold">Import or Export Sessions</Dialog.Title>
              <Dialog.Close asChild>
                <Button size="icon" variant="ghost" aria-label="Close dialog">
                  <X className="w-4 h-4" />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="sr-only">
              Export all sessions or import from Workona, Toby, OneTab, Session Buddy, JSON, Bookmarks HTML, or URL text.
            </Dialog.Description>

            <div className="space-y-2">
              <div className="text-[12px] font-semibold">Export All Sessions &amp; Collections</div>
              <div className="flex flex-wrap gap-1.5">
                {(["json", "html", "markdown", "csv", "onetab"] as const).map((fmt) => (
                  <Button key={fmt} variant="outline" onClick={() => void ctrl.handleExport(fmt)}>
                    <Download className="w-3.5 h-3.5" />
                    {fmt.toUpperCase()}
                  </Button>
                ))}
              </div>
            </div>

            <form onSubmit={(e) => void ctrl.handleImportSubmit(e)} className="space-y-3 pt-3 border-t border-[var(--st-border)]">
              <label htmlFor="st-import-file" className="text-[12px] font-semibold block">
                Import from file or pasted text (JSON, Bookmarks HTML, or URL list)
              </label>
              <input
                id="st-import-file"
                type="file"
                accept=".json,.html,.htm,.txt,.csv"
                onChange={ctrl.handleImportFilePick}
                className="text-[12px] file:mr-3 file:h-8 file:px-3 file:rounded-md file:border file:border-[var(--st-border)] file:bg-[var(--st-subtle)] file:text-[12px] file:font-medium cursor-pointer"
              />
              <Textarea
                id="st-import-text"
                aria-label="Exported backup text or list of URLs"
                value={ctrl.importText}
                onChange={(e) => ctrl.setImportText(e.target.value)}
                rows={5}
                placeholder="Or paste exported backup text or a list of URLs…"
                className="text-[12px]"
              />
              {isEncryptedImport && (
                <div className="flex items-start gap-2 rounded-md border border-[var(--st-accent)]/30 bg-[var(--st-accent-soft)] px-2.5 py-2 text-[12px] text-[var(--st-ink)]">
                  <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--st-accent)]" aria-hidden="true" />
                  <span>
                    Encrypted backup detected. Enter the password used when this backup was created.
                  </span>
                </div>
              )}
              <div className="space-y-1">
                <label htmlFor="st-import-password" className="text-[12px] font-medium block">Backup password</label>
                <BackupPasswordField
                  id="st-import-password"
                  mode="unlock"
                  value={ctrl.importPassword}
                  onChange={ctrl.setImportPassword}
                  placeholder={
                    isEncryptedImport
                      ? "Enter backup password to unlock"
                      : "Optional — only for password-protected backups"
                  }
                />
              </div>
              <div className="flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button variant="outline">Close</Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" disabled={ctrl.busy || !ctrl.importText.trim()}>
                  <ShieldCheck className="w-4 h-4" />
                  Import Sessions
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Save Copy / Promote Snapshot Dialog */}
      <Dialog.Root
        open={Boolean(ctrl.promoteTargetId)}
        onOpenChange={(open) => {
          if (!open) ctrl.setPromoteTargetId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-sm rounded-2xl border border-[var(--st-border)] bg-[var(--st-surface)] text-[var(--st-ink)] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-[15px] font-semibold">Save Copy of Session</Dialog.Title>
              <Dialog.Close asChild>
                <Button size="icon" variant="ghost" aria-label="Close dialog">
                  <X className="w-4 h-4" />
                </Button>
              </Dialog.Close>
            </div>
            <Dialog.Description className="text-[12.5px] text-[var(--st-muted)]">
              Create a named copy of this session in your saved history.
            </Dialog.Description>
            <form onSubmit={(e) => void ctrl.handlePromoteSubmit(e)} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="st-promote-name" className="text-[12px] font-medium">
                  Session name
                </label>
                <Input
                  id="st-promote-name"
                  value={ctrl.promoteNameInput}
                  onChange={(e) => ctrl.setPromoteNameInput(e.target.value)}
                  placeholder="Enter a name for this saved session"
                  className="w-full"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button type="submit" variant="primary" disabled={ctrl.busy}>
                  Save Copy
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog request={ctrl.confirmRequest} onResolve={ctrl.resolveConfirm} />
    </>
  );
}

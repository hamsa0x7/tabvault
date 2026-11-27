import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Bookmark,
  Download,
  GitCompare,
  GripVertical,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Button, Checkbox, Input, Select, TabFavicon, Textarea, cn } from "../../components/ui.tsx";
import {
  type NavSection,
  flattenCollectionTabs,
  flattenSnapshotTabs,
  kindLabel,
  useDashboardController,
} from "../../hooks/useDashboardController.ts";
import { formatTabDisplayUrl, isRestorable } from "../../shared/core.ts";
import { formatAgo, formatTimestamp, plural } from "../../shared/format.ts";
import { sendBg } from "../../shared/rpc.ts";
import type { Settings } from "../../shared/types.ts";
import { CopyFormatButton, GROUP_DOT_COLORS } from "./dashboardUtils.tsx";

type DashboardController = ReturnType<typeof useDashboardController>;

export function DashboardInspector({
  ctrl,
  activeSection,
  drawerOpen,
  onCloseDrawer,
  settings,
  tsMode,
  urlMode,
  isSessionPinned,
  isCollectionPinned,
}: {
  ctrl: DashboardController;
  activeSection: NavSection;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  settings: Settings;
  tsMode: Settings["timestampMode"];
  urlMode: Settings["urlDisplayMode"];
  isSessionPinned: boolean;
  isCollectionPinned: boolean;
}) {
  const [editColTitle, setEditColTitle] = useState("");
  const [addUrlInput, setAddUrlInput] = useState("");
  const [editingColHeader, setEditingColHeader] = useState(false);
  const [addingToCol, setAddingToCol] = useState(false);
  const [editingSnapHeader, setEditingSnapHeader] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [dragColItemId, setDragColItemId] = useState<string | null>(null);
  const [dragOverColItemId, setDragOverColItemId] = useState<string | null>(null);
  const [dragSnapTab, setDragSnapTab] = useState<{ winIdx: number; tabIdx: number } | null>(null);
  const [dragOverSnapTab, setDragOverSnapTab] = useState<{ winIdx: number; tabIdx: number } | null>(null);

  useEffect(() => {
    if (ctrl.selectedCollection) {
      setEditColTitle(ctrl.selectedCollection.title);
      setEditingColHeader(false);
      setAddingToCol(ctrl.selectedCollection.items.length === 0);
    }
  }, [ctrl.selectedCollection]);

  useEffect(() => {
    setEditingSnapHeader(false);
    setCompareOpen(false);
  }, [ctrl.selectedSnapshotId]);

  const openUrlSet = useMemo(() => {
    const set = new Set<string>();
    for (const w of ctrl.openWindows || []) {
      for (const t of w.tabs || []) set.add(t.url);
    }
    return set;
  }, [ctrl.openWindows]);

  const snapDiffStats = useMemo(() => {
    if (!ctrl.selectedSnapshot) return { newUrls: [] as string[], openCount: 0 };
    const seen = new Set<string>();
    const newUrls: string[] = [];
    let openCount = 0;
    for (const w of ctrl.selectedSnapshot.windows || []) {
      for (const t of w.tabs || []) {
        if (openUrlSet.has(t.url)) {
          openCount++;
        } else if (!seen.has(t.url)) {
          seen.add(t.url);
          newUrls.push(t.url);
        }
      }
    }
    return { newUrls, openCount };
  }, [ctrl.selectedSnapshot, openUrlSet]);

  if (activeSection !== "named" && activeSection !== "auto" && activeSection !== "collections") {
    return null;
  }

  return (
    <aside
      className={cn(
        "flex-col min-h-0 bg-[var(--st-surface)] border-l border-[var(--st-border)]",
        drawerOpen
          ? "fixed inset-y-0 right-0 z-40 w-[420px] max-w-[90vw] flex shadow-2xl lg:static lg:z-auto lg:w-auto lg:shadow-none"
          : "hidden lg:flex"
      )}
    >
      {drawerOpen && (
        <div className="lg:hidden px-4 py-2 border-b border-[var(--st-border)] flex items-center justify-between bg-[var(--st-subtle)]/50 shrink-0">
          <span className="text-[12px] font-semibold text-[var(--st-muted)]">Inspector</span>
          <button
            type="button"
            onClick={onCloseDrawer}
            aria-label="Close inspector"
            className="w-7 h-7 rounded hover:bg-[var(--st-border)] grid place-items-center text-[var(--st-muted)] hover:text-[var(--st-ink)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {activeSection === "collections" ? (
        ctrl.selectedCollection ? (
          <>
            <div className="p-4 border-b border-[var(--st-border)] space-y-2 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--st-muted)]">
                  {ctrl.selectedCollection.kind === "folder" ? "Folder" : "Collection"}
                </span>
                <div className="flex items-center gap-1">
                  {ctrl.selectedCollection.kind === "group" && (
                    <Button
                      variant={addingToCol ? "primary" : "outline"}
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setAddingToCol((v) => !v)}
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </Button>
                  )}
                  <Button
                    variant={editingColHeader ? "primary" : "ghost"}
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setEditingColHeader((v) => !v)}
                  >
                    Edit
                  </Button>
                  <button
                    type="button"
                    title={ctrl.selectedCollection.starred ? "Unstar" : "Star"}
                    aria-label={ctrl.selectedCollection.starred ? "Unstar collection" : "Star collection"}
                    onClick={() =>
                      void ctrl.handleUpdateCollection(
                        { ...ctrl.selectedCollection!, starred: !ctrl.selectedCollection!.starred },
                        ctrl.selectedCollection!.starred ? "Removed star." : "Starred collection."
                      )
                    }
                    className="w-7 h-7 rounded hover:bg-[var(--st-subtle)] grid place-items-center cursor-pointer"
                  >
                    <Star
                      className={cn(
                        "w-3.5 h-3.5",
                        ctrl.selectedCollection.starred ? "fill-[var(--st-star)] text-[var(--st-star)]" : "text-[var(--st-muted)]"
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    title={ctrl.selectedCollection.locked ? "Unlock" : "Lock"}
                    aria-label={ctrl.selectedCollection.locked ? "Unlock collection" : "Lock collection"}
                    onClick={() =>
                      void ctrl.handleUpdateCollection(
                        { ...ctrl.selectedCollection!, locked: !ctrl.selectedCollection!.locked },
                        ctrl.selectedCollection!.locked ? "Unlocked." : "Locked."
                      )
                    }
                    className="w-7 h-7 rounded hover:bg-[var(--st-subtle)] grid place-items-center cursor-pointer"
                  >
                    <Lock
                      className={cn(
                        "w-3.5 h-3.5",
                        ctrl.selectedCollection.locked ? "text-[var(--st-accent)]" : "text-[var(--st-muted)]"
                      )}
                    />
                  </button>
                </div>
              </div>

              {editingColHeader ? (
                <div className="space-y-2 pt-1">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const nextTitle = editColTitle.trim();
                      if (!nextTitle) return;
                      const nextTags = ctrl.editColTags
                        .split(",")
                        .map((t) => t.trim())
                        .filter(Boolean);
                      setEditingColHeader(false);
                      void ctrl.handleUpdateCollection(
                        {
                          ...ctrl.selectedCollection!,
                          title: nextTitle,
                          tags: nextTags,
                          notes: ctrl.editColNotes.trim() || undefined,
                        },
                        "Collection updated."
                      );
                    }}
                    className="space-y-1.5"
                  >
                    <div className="flex gap-1.5">
                      <Input
                        value={editColTitle}
                        onChange={(e) => setEditColTitle(e.target.value)}
                        placeholder="Collection name..."
                        aria-label="Collection name"
                        className="flex-1 h-7.5 text-[13px] font-semibold"
                        autoFocus
                      />
                      <Button type="submit" variant="primary" className="h-7.5 px-2.5 text-[11px]">
                        Save
                      </Button>
                    </div>
                    <Input
                      value={ctrl.editColTags}
                      onChange={(e) => ctrl.setEditColTags(e.target.value)}
                      placeholder="Tags (comma-separated)..."
                      aria-label="Collection tags"
                      className="w-full h-7 text-[11.5px]"
                    />
                    <Textarea
                      value={ctrl.editColNotes}
                      onChange={(e) => ctrl.setEditColNotes(e.target.value)}
                      rows={2}
                      placeholder="Notes (optional)..."
                      aria-label="Collection notes"
                      className="p-2 text-[11.5px]"
                    />
                  </form>
                  {ctrl.selectedCollection.kind === "group" && ctrl.folders.length > 0 && (
                    <Select
                      value={ctrl.selectedCollection.parentFolderId || ""}
                      onChange={(e) =>
                        void ctrl.handleUpdateCollection(
                          { ...ctrl.selectedCollection!, parentFolderId: e.target.value || null },
                          "Moved to folder."
                        )
                      }
                      className="w-full h-7 text-[11.5px]"
                      aria-label="Parent folder"
                    >
                      <option value="">No folder (top level)</option>
                      {ctrl.folders.map((f) => (
                        <option key={f.id} value={f.id}>
                          Folder: {f.title}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-[15.5px] font-bold truncate">{ctrl.selectedCollection.title}</div>
                  <div className="text-[11.5px] text-[var(--st-muted)] tabular-nums">
                    {plural(flattenCollectionTabs(ctrl.selectedCollection).length, "tab")} · Updated{" "}
                    {formatAgo(ctrl.selectedCollection.updatedAt)}
                    {ctrl.selectedCollection.tags?.length ? ` · ${ctrl.selectedCollection.tags.join(", ")}` : ""}
                  </div>
                  {ctrl.selectedCollection.notes && (
                    <p className="text-[12px] text-[var(--st-muted)] leading-snug pt-0.5 break-words">
                      {ctrl.selectedCollection.notes}
                    </p>
                  )}
                </div>
              )}
            </div>

            {addingToCol && ctrl.selectedCollection.kind === "group" && (
              <div className="px-3 py-2.5 border-b border-[var(--st-border)] bg-[var(--st-subtle)]/40 space-y-1.5 shrink-0">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const raw = addUrlInput.trim();
                    if (!raw) return;
                    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
                    if (!isRestorable(url)) {
                      ctrl.notify("Enter a valid http(s) or ftp address.");
                      return;
                    }
                    const existingUrls = new Set(ctrl.selectedCollection!.items.map((i) => i.url));
                    if (existingUrls.has(url)) {
                      ctrl.notify("This URL is already in the collection.");
                      return;
                    }
                    const nextItem = {
                      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                      url,
                      title: url.replace(/^https?:\/\//i, ""),
                      addedAt: Date.now(),
                    };
                    setAddUrlInput("");
                    void ctrl.handleUpdateCollection(
                      { ...ctrl.selectedCollection!, items: [...ctrl.selectedCollection!.items, nextItem] },
                      "Added link to collection."
                    );
                  }}
                  className="flex gap-1.5"
                >
                  <Input
                    value={addUrlInput}
                    onChange={(e) => setAddUrlInput(e.target.value)}
                    placeholder="Add URL (https://...)..."
                    aria-label="Add URL to collection"
                    className="flex-1 h-7 text-[11.5px]"
                  />
                  <Button type="submit" variant="outline" className="h-7 px-2 text-[11px]">
                    Add
                  </Button>
                </form>
                <Button
                  variant="outline"
                  className="w-full h-7 text-[11px]"
                  onClick={() => {
                    const targetWin = ctrl.openWindows.find((w) => w.focused) || ctrl.openWindows[0];
                    if (!targetWin?.tabs.length) {
                      ctrl.notify("No open tabs to add.");
                      return;
                    }
                    const existingUrls = new Set(ctrl.selectedCollection!.items.map((i) => i.url));
                    const additions = targetWin.tabs
                      .filter((t) => !existingUrls.has(t.url))
                      .map((t, idx) => ({
                        id: `${Date.now().toString(36)}_${idx}`,
                        url: t.url,
                        title: t.title || t.url,
                        favIconUrl: t.favIconUrl,
                        pinned: t.pinned,
                        addedAt: Date.now(),
                      }));
                    if (!additions.length) {
                      ctrl.notify("All tabs from your current window are already here.");
                      return;
                    }
                    void ctrl.handleUpdateCollection(
                      { ...ctrl.selectedCollection!, items: [...ctrl.selectedCollection!.items, ...additions] },
                      `Added ${plural(additions.length, "tab")} from open window.`
                    );
                  }}
                >
                  <Plus className="w-3 h-3" />
                  Add Current Window Tabs
                </Button>
              </div>
            )}
            <div
              className="flex-1 overflow-y-auto scroll-thin p-3 space-y-1"
              onDragOver={(e) => {
                if (!ctrl.selectedCollection?.locked) e.preventDefault();
              }}
              onDrop={(e) => {
                if (!ctrl.selectedCollection || ctrl.selectedCollection.locked) return;
                if (dragColItemId) {
                  setDragColItemId(null);
                  return;
                }
                const rawUrl = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "").trim();
                if (!isRestorable(rawUrl)) return;
                e.preventDefault();
                const nextItem = {
                  id: `${Date.now().toString(36)}_drop`,
                  url: rawUrl,
                  title: rawUrl.replace(/^https?:\/\//i, ""),
                  addedAt: Date.now(),
                };
                void ctrl.handleUpdateCollection(
                  { ...ctrl.selectedCollection, items: [...ctrl.selectedCollection.items, nextItem] },
                  "Added dropped link to collection."
                );
              }}
            >
              {ctrl.selectedCollection.items.filter((i) => !i.archived).length === 0 && (
                <div className="py-6 text-center text-[12px] text-[var(--st-muted)] border border-dashed border-[var(--st-border)] rounded-lg">
                  Drop links here or add a URL above.
                </div>
              )}
              {ctrl.selectedCollection.items
                .filter((i) => !i.archived)
                .map((item) => {
                  const isEditingNote = ctrl.editingItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      draggable={!ctrl.selectedCollection?.locked && !isEditingNote}
                      onDragStart={() => setDragColItemId(item.id)}
                      onDragOver={(e) => {
                        if (!ctrl.selectedCollection?.locked && dragColItemId && dragColItemId !== item.id) {
                          e.preventDefault();
                          setDragOverColItemId(item.id);
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverColItemId === item.id) setDragOverColItemId(null);
                      }}
                      onDrop={(e) => {
                        if (!ctrl.selectedCollection || ctrl.selectedCollection.locked || !dragColItemId || dragColItemId === item.id) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const all = [...ctrl.selectedCollection.items];
                        const fromIdx = all.findIndex((x) => x.id === dragColItemId);
                        const toIdx = all.findIndex((x) => x.id === item.id);
                        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) {
                          const [moved] = all.splice(fromIdx, 1);
                          all.splice(toIdx, 0, moved);
                          void ctrl.handleUpdateCollection({ ...ctrl.selectedCollection, items: all });
                        }
                        setDragColItemId(null);
                        setDragOverColItemId(null);
                      }}
                      onDragEnd={() => {
                        setDragColItemId(null);
                        setDragOverColItemId(null);
                      }}
                      className={cn(
                        "row-hover px-2 py-1.5 rounded-md hover:bg-[var(--st-subtle)] space-y-1.5",
                        dragColItemId === item.id && "opacity-50",
                        dragOverColItemId === item.id && "border-t-2 border-[var(--st-accent)]"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {!ctrl.selectedCollection?.locked && (
                          <span title="Drag to reorder" className="shrink-0">
                            <GripVertical className="w-3.5 h-3.5 text-[var(--st-muted)] cursor-grab" aria-hidden="true" />
                          </span>
                        )}
                        <span title="Mark item done" className="shrink-0 flex items-center">
                          <Checkbox
                            checked={Boolean(item.taskDone)}
                            onCheckedChange={() =>
                              void ctrl.handleToggleItemField(ctrl.selectedCollection!, item.id, {
                                taskDone: !item.taskDone,
                              })
                            }
                            ariaLabel={`Mark ${item.title || item.url} done`}
                          />
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            void sendBg("openUrl", { url: item.url }).catch((err) =>
                              ctrl.notify(String((err as Error)?.message || err))
                            )
                          }
                          className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <TabFavicon url={item.url} title={item.title} />
                          <div className="min-w-0 flex-1">
                            <div
                              className={cn(
                                "text-[12.5px]",
                                settings.truncateTitles ? "truncate" : "break-words",
                                item.taskDone && "line-through text-[var(--st-muted)]"
                              )}
                            >
                              {item.title || item.url}
                            </div>
                            <div className="text-[11px] text-[var(--st-muted)] truncate flex items-center gap-1.5">
                              {item.groupTitle && (
                                <span className="inline-flex items-center gap-1 px-1 py-0.2 rounded bg-[var(--st-subtle)] text-[10px]">
                                  <span
                                    className="w-1.5 h-1.5 rounded-full"
                                    style={{
                                      backgroundColor: item.groupColor
                                        ? GROUP_DOT_COLORS[item.groupColor]
                                        : "var(--st-muted)",
                                    }}
                                  />
                                  {item.groupTitle}
                                </span>
                              )}
                              <span className="truncate">
                                {formatTabDisplayUrl(item.url, urlMode === "none" ? "domain" : urlMode)}
                              </span>
                            </div>
                          </div>
                        </button>
                        {!ctrl.selectedCollection?.locked && (
                          <button
                            type="button"
                            onClick={() => {
                              if (isEditingNote) {
                                ctrl.setEditingItemId(null);
                              } else {
                                ctrl.setEditingItemId(item.id);
                                ctrl.setEditingItemNote(item.notes || "");
                              }
                            }}
                            title={item.notes ? "Edit note" : "Add note"}
                            aria-label={item.notes ? `Edit note for ${item.title || item.url}` : `Add note for ${item.title || item.url}`}
                            className={cn(
                              "w-6 h-6 rounded hover:bg-[var(--st-border)] grid place-items-center cursor-pointer shrink-0",
                              item.notes ? "text-[var(--st-accent)]" : "row-actions text-[var(--st-muted)]"
                            )}
                          >
                            <StickyNote className="w-3 h-3" />
                          </button>
                        )}
                        {!ctrl.selectedCollection?.locked && (
                          <button
                            type="button"
                            onClick={() =>
                              void ctrl.handleToggleItemField(ctrl.selectedCollection!, item.id, { archived: true })
                            }
                            title="Archive item"
                            aria-label={`Archive ${item.title || item.url}`}
                            className="row-actions w-6 h-6 rounded hover:bg-[var(--st-border)] grid place-items-center text-[var(--st-muted)] cursor-pointer shrink-0"
                          >
                            <Archive className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void ctrl.handleDeleteCollectionItem(ctrl.selectedCollection!, item.id)}
                          title="Remove item"
                          aria-label={`Remove ${item.title || item.url}`}
                          className="row-actions w-6 h-6 rounded hover:bg-[var(--st-border)] grid place-items-center text-[var(--st-muted)] cursor-pointer shrink-0"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      {item.notes && !isEditingNote && (
                        <div className="pl-11 pr-2 text-[11px] text-[var(--st-muted)] break-words">
                          {item.notes}
                        </div>
                      )}
                      {isEditingNote && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            const nextNote = ctrl.editingItemNote.trim();
                            ctrl.setEditingItemId(null);
                            void ctrl.handleToggleItemField(ctrl.selectedCollection!, item.id, {
                              notes: nextNote || undefined,
                            });
                          }}
                          className="pl-7 flex items-center gap-1.5"
                        >
                          <Input
                            value={ctrl.editingItemNote}
                            onChange={(e) => ctrl.setEditingItemNote(e.target.value)}
                            placeholder="Add note for this link..."
                            aria-label="Note for this link"
                            className="flex-1 h-7 text-[11.5px]"
                            autoFocus
                          />
                          <Button type="submit" variant="primary" className="h-7 px-2 text-[11px]">
                            Save
                          </Button>
                        </form>
                      )}
                    </div>
                  );
                })}
              {(() => {
                const archivedList = ctrl.selectedCollection.items.filter((i) => i.archived);
                if (archivedList.length === 0) return null;
                return (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => ctrl.setShowArchivedItems(!ctrl.showArchivedItems)}
                      className="text-[11.5px] font-medium text-[var(--st-muted)] hover:text-[var(--st-ink)] cursor-pointer px-2 py-1"
                    >
                      {ctrl.showArchivedItems ? "Hide" : "Show"} archived ({archivedList.length})
                    </button>
                    {ctrl.showArchivedItems && (
                      <div className="mt-1 space-y-1 opacity-75">
                        {archivedList.map((item) => (
                          <div
                            key={item.id}
                            className="px-2 py-1 rounded-md bg-[var(--st-subtle)]/50 flex items-center justify-between gap-2 text-[12px]"
                          >
                            <button
                              type="button"
                              onClick={() =>
                            void sendBg("openUrl", { url: item.url }).catch((err) =>
                              ctrl.notify(String((err as Error)?.message || err))
                            )
                          }
                              className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                            >
                              <TabFavicon url={item.url} title={item.title} />
                              <span className="truncate">{item.title || item.url}</span>
                            </button>
                            <Button
                              variant="ghost"
                              className="h-6 px-2 text-[11px]"
                              onClick={() =>
                                void ctrl.handleToggleItemField(ctrl.selectedCollection!, item.id, { archived: false })
                              }
                            >
                              Restore
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="p-3.5 border-t border-[var(--st-border)] space-y-2 shrink-0">
              <Button
                variant="primary"
                className="w-full"
                onClick={() => void ctrl.handleRestoreCollection(ctrl.selectedCollection!.id, "keep")}
              >
                Open Collection
              </Button>
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  variant="outline"
                  onClick={() =>
                    void ctrl.handleTogglePinBookmark(
                      "collection",
                      ctrl.selectedCollection!.id,
                      ctrl.selectedCollection!.title
                    )
                  }
                >
                  <Star className={cn("w-3.5 h-3.5", isCollectionPinned && "fill-[var(--st-star)] text-[var(--st-star)]")} />
                  {isCollectionPinned ? "Pinned" : "Pin Bar"}
                </Button>
                <CopyFormatButton
                  count={flattenCollectionTabs(ctrl.selectedCollection).length}
                  enabledFormats={settings.enabledCopyFormats}
                  customTemplates={settings.customCopyTemplates}
                  onCopy={(mode, label) => void ctrl.handleCopyInspectorTabs(mode, label)}
                />
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <Button
                  variant="outline"
                  className="px-2 text-[11.5px]"
                  title="Remove duplicate URLs in this collection"
                  onClick={() => void ctrl.handleDeduplicateCollection(ctrl.selectedCollection!)}
                >
                  Dedupe
                </Button>
                <Button
                  variant="outline"
                  className="px-2 text-[11.5px]"
                  title="Sort collection items alphabetically"
                  onClick={() => void ctrl.handleSortCollection(ctrl.selectedCollection!, "title")}
                >
                  Sort
                </Button>
                <Button
                  variant="outline"
                  className="px-2 text-[11.5px]"
                  title="Export this collection as JSON"
                  onClick={() => void ctrl.handleExportCollection(ctrl.selectedCollection!, "json")}
                >
                  <Download className="w-3 h-3" />
                  Export
                </Button>
                <Button
                  variant="danger"
                  className="px-2 text-[11.5px]"
                  title="Delete collection"
                  onClick={() => void ctrl.handleDeleteCollection(ctrl.selectedCollection!)}
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 grid place-items-center p-6 text-center text-[13px] text-[var(--st-muted)]">
            Select a collection to inspect its tabs.
          </div>
        )
      ) : ctrl.selectedSnapshot ? (
        <>
          <div className="p-4 border-b border-[var(--st-border)] space-y-2 shrink-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--st-muted)]">
                {kindLabel(ctrl.selectedSnapshot.kind)}
              </span>
              <div className="flex items-center gap-1">
                {ctrl.siblingVersions.length > 1 && (
                  <div className="flex items-center rounded-md bg-[var(--st-subtle)] p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => ctrl.setInspectorTab("tabs")}
                      className={cn(
                        "px-2 py-0.5 rounded font-semibold cursor-pointer",
                        ctrl.inspectorTab !== "versions"
                          ? "bg-[var(--st-surface)] text-[var(--st-ink)] shadow-xs"
                          : "text-[var(--st-muted)]"
                      )}
                    >
                      Tabs
                    </button>
                    <button
                      type="button"
                      onClick={() => ctrl.setInspectorTab("versions")}
                      className={cn(
                        "px-2 py-0.5 rounded font-semibold cursor-pointer",
                        ctrl.inspectorTab === "versions"
                          ? "bg-[var(--st-surface)] text-[var(--st-ink)] shadow-xs"
                          : "text-[var(--st-muted)]"
                      )}
                    >
                      History ({ctrl.siblingVersions.length})
                    </button>
                  </div>
                )}
                <Button
                  variant={editingSnapHeader ? "primary" : "ghost"}
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setEditingSnapHeader((v) => !v)}
                >
                  <Pencil className="w-3 h-3" />
                  Edit
                </Button>
              </div>
            </div>
            {editingSnapHeader ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setEditingSnapHeader(false);
                  void ctrl.handleSaveSnapshotMeta();
                }}
                className="space-y-1.5"
              >
                <Input
                  value={ctrl.editSnapName}
                  onChange={(e) => ctrl.setEditSnapName(e.target.value)}
                  placeholder="Session name..."
                  aria-label="Session name"
                  className="w-full h-7.5 text-[13px] font-semibold"
                  autoFocus
                />
                <div className="flex gap-1.5">
                  <Input
                    value={ctrl.editSnapTags}
                    onChange={(e) => ctrl.setEditSnapTags(e.target.value)}
                    placeholder="Tags (comma-separated)"
                    aria-label="Session tags"
                    className="flex-1 h-7 text-[11.5px]"
                  />
                  <Button type="submit" variant="primary" className="h-7 px-2.5 text-[11px]">
                    Save
                  </Button>
                </div>
              </form>
            ) : (
              <div>
                <div className="text-[15.5px] font-bold truncate">
                  {ctrl.selectedSnapshot.name || formatTimestamp(ctrl.selectedSnapshot.t, tsMode)}
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <div className="text-[11.5px] text-[var(--st-muted)] tabular-nums truncate">
                    {plural(ctrl.selectedSnapshot.windowCount, "window")} ·{" "}
                    {plural(ctrl.selectedSnapshot.tabCount, "tab")}
                    {ctrl.selectedSnapshot.tags?.length ? ` · ${ctrl.selectedSnapshot.tags.join(", ")}` : ""}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCompareOpen((v) => !v)}
                    aria-pressed={compareOpen}
                    title="Compare saved tabs against currently open tabs"
                    className={cn(
                      "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors cursor-pointer shrink-0",
                      compareOpen
                        ? "border-[var(--st-accent)] bg-[var(--st-accent-soft)] text-[var(--st-accent)]"
                        : "border-[var(--st-border)] bg-[var(--st-surface)] text-[var(--st-muted)] hover:text-[var(--st-ink)]"
                    )}
                  >
                    <GitCompare className="w-3 h-3" />
                    Diff
                  </button>
                </div>
                {compareOpen && (
                  <div className="mt-2 px-2.5 py-1.5 rounded-md border border-[var(--st-border)] bg-[var(--st-subtle)]/70 flex items-center justify-between gap-2 text-[11px]">
                    <span className="tabular-nums text-[var(--st-muted)]">
                      <strong className="text-[var(--st-accent)]">{snapDiffStats.newUrls.length}</strong> new ·{" "}
                      <strong>{snapDiffStats.openCount}</strong> already open
                    </span>
                    {snapDiffStats.newUrls.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          for (const url of snapDiffStats.newUrls) {
                            void sendBg("openUrl", { url, active: false });
                          }
                          ctrl.notify(`Opening ${plural(snapDiffStats.newUrls.length, "new tab")}…`);
                        }}
                        className="text-[var(--st-accent)] font-semibold hover:underline cursor-pointer shrink-0"
                      >
                        Open {snapDiffStats.newUrls.length} New
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3">
            {ctrl.inspectorTab === "versions" && ctrl.siblingVersions.length > 1 ? (
              <div className="space-y-1.5">
                {ctrl.siblingVersions.map((ver) => {
                  const isCurrent = ver.id === ctrl.selectedSnapshot!.id;
                  const diff = ver.n - ctrl.selectedSnapshot!.tabCount;
                  return (
                    <button
                      key={ver.id}
                      type="button"
                      onClick={() => {
                        ctrl.setSelectedSnapshotId(ver.id);
                        ctrl.setInspectorTab("tabs");
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg border flex items-center justify-between gap-2 cursor-pointer",
                        isCurrent
                          ? "border-[var(--st-accent)] bg-[var(--st-accent-soft)]/50"
                          : "border-[var(--st-border)] bg-[var(--st-surface)] hover:border-[var(--st-accent)]"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-semibold truncate">
                          {ver.name || formatTimestamp(ver.t, "absolute")}
                        </div>
                        <div className="text-[11px] text-[var(--st-muted)] tabular-nums">
                          {kindLabel(ver.kind)} · {plural(ver.w, "window")} · {plural(ver.n, "tab")} · {formatTimestamp(ver.t, tsMode)}
                        </div>
                      </div>
                      {!isCurrent && diff !== 0 && (
                        <span
                          className={cn(
                            "text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded shrink-0",
                            diff > 0
                              ? "bg-[var(--st-accent-soft)] text-[var(--st-accent)]"
                              : "bg-[var(--st-subtle)] text-[var(--st-muted)]"
                          )}
                        >
                          {diff > 0 ? `+${diff}` : diff}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              (ctrl.selectedSnapshot.windows || []).map((w, wi) => (
                <div key={wi} className="space-y-1">
                  <div className="flex items-center justify-between text-[11.5px] font-semibold text-[var(--st-muted)] px-1">
                    <span>
                      Window {wi + 1} · {plural((w.tabs || []).length, "tab")}
                    </span>
                    <button
                      type="button"
                      onClick={() => void ctrl.handleRestoreSnapshot(ctrl.selectedSnapshot!.id, wi)}
                      className="text-[var(--st-accent)] hover:underline cursor-pointer"
                    >
                      Open window
                    </button>
                  </div>
                  {(w.tabs || []).map((t, ti) => (
                    <div
                      key={ti}
                      draggable
                      onDragStart={() => setDragSnapTab({ winIdx: wi, tabIdx: ti })}
                      onDragOver={(e) => {
                        if (dragSnapTab && dragSnapTab.winIdx === wi && dragSnapTab.tabIdx !== ti) {
                          e.preventDefault();
                          setDragOverSnapTab({ winIdx: wi, tabIdx: ti });
                        }
                      }}
                      onDragLeave={() => {
                        if (dragOverSnapTab?.winIdx === wi && dragOverSnapTab?.tabIdx === ti) {
                          setDragOverSnapTab(null);
                        }
                      }}
                      onDrop={(e) => {
                        if (!dragSnapTab || dragSnapTab.winIdx !== wi || dragSnapTab.tabIdx === ti) return;
                        e.preventDefault();
                        void ctrl.handleReorderSnapshotTabs(wi, dragSnapTab.tabIdx, ti);
                        setDragSnapTab(null);
                        setDragOverSnapTab(null);
                      }}
                      onDragEnd={() => {
                        setDragSnapTab(null);
                        setDragOverSnapTab(null);
                      }}
                      className={cn(
                        "row-hover px-2 py-1 rounded hover:bg-[var(--st-subtle)] flex items-center gap-2",
                        dragSnapTab?.winIdx === wi && dragSnapTab?.tabIdx === ti && "opacity-50",
                        dragOverSnapTab?.winIdx === wi && dragOverSnapTab?.tabIdx === ti && "border-t-2 border-[var(--st-accent)]"
                      )}
                    >
                      <span title="Drag to reorder" className="shrink-0">
                        <GripVertical className="w-3 h-3 text-[var(--st-muted)] cursor-grab" aria-hidden="true" />
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void sendBg("openUrl", { url: t.url }).catch((err) =>
                            ctrl.notify(String((err as Error)?.message || err))
                          )
                        }
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <TabFavicon url={t.url} title={t.title} />
                        <span className={cn("text-[12.5px] flex-1", settings.truncateTitles ? "truncate" : "break-words")}>
                          {t.title || t.url}
                        </span>
                        {compareOpen && (
                          <span
                            className={cn(
                              "text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0",
                              openUrlSet.has(t.url)
                                ? "bg-[var(--st-subtle)] text-[var(--st-muted)]"
                                : "bg-[var(--st-accent-soft)] text-[var(--st-accent)]"
                            )}
                          >
                            {openUrlSet.has(t.url) ? "Open" : "New"}
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void ctrl.handleRemoveSnapshotTab(wi, ti)}
                        title="Remove tab from session"
                        aria-label={`Remove ${t.title || t.url}`}
                        className="row-actions w-6 h-6 rounded hover:bg-[var(--st-border)] grid place-items-center text-[var(--st-muted)] hover:text-[var(--st-ink)] cursor-pointer shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
          <div className="p-3.5 border-t border-[var(--st-border)] space-y-2 shrink-0">
            <Button
              variant="primary"
              className="w-full"
              title="Focus matching open windows and open only missing tabs (no duplicates)"
              onClick={() => void ctrl.handleRestoreSnapshot(ctrl.selectedSnapshot!.id)}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Smart Restore
            </Button>
            {ctrl.selectedSnapshot.kind !== "named" && (
              <Button
                variant="outline"
                className="w-full"
                title="Promote this auto-save into a permanent named Saved Session"
                onClick={() => void ctrl.handlePromoteSnapshot(ctrl.selectedSnapshot!.id)}
              >
                <Bookmark className="w-3.5 h-3.5" />
                Save as Named Session
              </Button>
            )}
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                variant="outline"
                title="Add or remove a 1-click restore bookmark on Chrome's Bookmarks Bar"
                onClick={() =>
                  void ctrl.handleTogglePinBookmark(
                    "session",
                    ctrl.selectedSnapshot!.id,
                    ctrl.selectedSnapshot!.name || formatTimestamp(ctrl.selectedSnapshot!.t, "absolute")
                  )
                }
              >
                <Star className={cn("w-3.5 h-3.5", isSessionPinned && "fill-[var(--st-star)] text-[var(--st-star)]")} />
                {isSessionPinned ? "Pinned" : "Pin Bar"}
              </Button>
              <CopyFormatButton
                count={flattenSnapshotTabs(ctrl.selectedSnapshot).length}
                enabledFormats={settings.enabledCopyFormats}
                customTemplates={settings.customCopyTemplates}
                onCopy={(mode, label) => void ctrl.handleCopyInspectorTabs(mode, label)}
              />
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              <Button
                variant="outline"
                onClick={() => void ctrl.handleDeduplicate(ctrl.selectedSnapshot!.id)}
                title="Remove duplicate URLs inside this saved session"
              >
                Dedupe
              </Button>
              <Button
                variant="outline"
                title="Download this session as a JSON backup file"
                onClick={() => void ctrl.handleExport("json", [ctrl.selectedSnapshot!.id])}
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </Button>
              <Button
                variant="danger"
                title="Permanently delete this session"
                onClick={() => void ctrl.handleDeleteSnapshots([ctrl.selectedSnapshot!.id])}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 grid place-items-center p-6 text-center text-[13px] text-[var(--st-muted)]">
          Select a session to inspect its tabs.
        </div>
      )}
    </aside>
  );
}

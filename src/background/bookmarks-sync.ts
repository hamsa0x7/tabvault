import { getAllCollections, getSettings } from "../shared/db.ts";

export async function syncCollectionsToBookmarks(): Promise<void> {
  const settings = await getSettings();
  if (!settings.mirrorToBookmarks) return;
  if (!(await chrome.permissions.contains({ permissions: ["bookmarks"] }))) return;

  const cols = await getAllCollections();
  const tree = await chrome.bookmarks.getTree();
  const otherFolder = tree[0]?.children?.find((c) => c.id === "2") || tree[0]?.children?.[1] || tree[0];
  if (!otherFolder) return;

  const existing = (otherFolder.children || []).find((c) => c.title === "TabVault");
  let rootId: string;
  if (existing) {
    const children = await chrome.bookmarks.getChildren(existing.id);
    for (const child of children) {
      await chrome.bookmarks.removeTree(child.id).catch(() => {});
    }
    rootId = existing.id;
  } else {
    const created = await chrome.bookmarks.create({ parentId: otherFolder.id, title: "TabVault" });
    rootId = created.id;
  }

  for (const col of cols.filter((c) => !c.archived && c.items.length > 0)) {
    const folder = await chrome.bookmarks.create({ parentId: rootId, title: col.title || "Collection" });
    for (const item of col.items) {
      await chrome.bookmarks.create({ parentId: folder.id, title: item.title, url: item.url }).catch(() => {});
    }
  }
}

export function buildRestoreBookmarkUrl(type: "session" | "collection", id: string): string {
  return chrome.runtime.getURL(`dashboard.html?restore=${type}:${encodeURIComponent(id)}&autoclose=1`);
}

export async function listPinnedBookmarks(): Promise<string[]> {
  if (!(await chrome.permissions.contains({ permissions: ["bookmarks"] }))) return [];
  const prefix = chrome.runtime.getURL("dashboard.html?restore=");
  const matches = await chrome.bookmarks.search({ query: prefix }).catch(() => []);
  const keys: string[] = [];
  for (const m of matches) {
    if (!m.url || !m.url.startsWith(prefix)) continue;
    try {
      const u = new URL(m.url);
      const val = u.searchParams.get("restore");
      if (val) keys.push(val);
    } catch {
      /* ignore malformed */
    }
  }
  return keys;
}

export async function pinToBookmarksBar(opts: {
  type: "session" | "collection";
  id: string;
  title: string;
}): Promise<boolean> {
  if (!(await chrome.permissions.contains({ permissions: ["bookmarks"] }))) {
    throw new Error("Allow Bookmarks permission to pin to the Bookmarks Bar.");
  }
  const url = buildRestoreBookmarkUrl(opts.type, opts.id);
  const existing = await chrome.bookmarks.search({ url }).catch(() => []);
  const cleanTitle = String(opts.title || "Saved Session").trim().slice(0, 80);
  if (existing.length > 0) {
    await chrome.bookmarks.update(existing[0].id, { title: cleanTitle });
    return true;
  }
  const tree = await chrome.bookmarks.getTree();
  const bar = tree[0]?.children?.find((c) => c.id === "1") || tree[0]?.children?.[0];
  if (!bar) throw new Error("Bookmarks Bar not found.");
  await chrome.bookmarks.create({ parentId: bar.id, title: cleanTitle, url });
  return true;
}

export async function unpinFromBookmarksBar(opts: {
  type: "session" | "collection";
  id: string;
}): Promise<boolean> {
  if (!(await chrome.permissions.contains({ permissions: ["bookmarks"] }))) return false;
  const url = buildRestoreBookmarkUrl(opts.type, opts.id);
  const existing = await chrome.bookmarks.search({ url }).catch(() => []);
  for (const bm of existing) {
    await chrome.bookmarks.remove(bm.id).catch(() => {});
  }
  return true;
}

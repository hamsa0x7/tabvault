import { cleanWindow, countTabs, isRestorable, normalizeGroupColor, uid } from "./core.ts";
import type { CollectionItem, CollectionRecord, SavedTab, SavedWindow, SessionSnapshot, SnapshotKind } from "./types.ts";

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asRecords(v: unknown): JsonRecord[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function toSavedTabs(v: unknown): SavedTab[] {
  return asRecords(v)
    .filter((t) => typeof t.url === "string")
    .map((t) => ({
      url: String(t.url),
      title: str(t.title, String(t.url)),
      ...(typeof t.pinned === "boolean" ? { pinned: t.pinned } : {}),
      ...(typeof t.favIconUrl === "string" ? { favIconUrl: t.favIconUrl } : {}),
      ...(typeof t.groupId === "number" ? { groupId: t.groupId } : {}),
      ...(typeof t.groupTitle === "string" ? { groupTitle: t.groupTitle } : {}),
      ...(typeof t.groupColor === "string" ? { groupColor: normalizeGroupColor(t.groupColor) } : {}),
    }));
}

function toSavedWindows(v: unknown): SavedWindow[] {
  return asRecords(v).map((w) => ({
    title: str(w.title) || str(w.name) || undefined,
    tabs: toSavedTabs(w.tabs ?? w.links),
  }));
}

export interface ImportedSessionInput {
  name: string;
  t: number;
  kind: SnapshotKind;
  src: string;
  windows: SavedWindow[];
}

export interface ImportParseResult {
  source: string;
  sessions: ImportedSessionInput[];
  collections?: CollectionRecord[];
}

export const SOURCE_LABELS: Record<string, string> = {
  tabvault: "TabVault",
  smarttabber: "TabVault",
  tabretain: "TabRetain",
  sessionbuddy: "Session Buddy",
  tsm: "Tab Session Manager",
  onetab: "OneTab",
  tablerone: "Tablerone",
  tabxpert: "TabXpert",
  bookmarksHtml: "Bookmarks HTML",
  pocket: "Pocket",
  pinboard: "Pinboard",
  linkwarden: "Linkwarden",
  workona: "Workona",
  toby: "Toby",
  spaces: "Spaces",
  cluster: "Cluster",
  urls: "URL List",
};

function toMs(v: unknown): number {
  if (v == null) return Date.now();
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v;
  const d = Date.parse(String(v));
  return Number.isNaN(d) ? Date.now() : d;
}

function mk(name: string, t: number, windows: SavedWindow[], src: string, kind: SnapshotKind = "imported"): ImportedSessionInput {
  const cleaned = windows.map((w) => cleanWindow(w)).filter((w) => w.tabs.length > 0);
  return { name: name || "", t: Number(t) || Date.now(), kind, src, windows: cleaned };
}

export function collectionToSnapshot(col: CollectionRecord): SessionSnapshot {
  const activeItems = col.items.filter((i) => !i.archived);
  const tabs = activeItems.map((i) => ({
    url: i.url,
    title: i.title,
    pinned: i.pinned,
    favIconUrl: i.favIconUrl,
  }));
  return {
    id: col.id,
    t: col.updatedAt || col.createdAt,
    updatedAt: col.updatedAt || col.createdAt,
    kind: "named",
    name: col.title || "Collection",
    runId: "",
    tags: col.tags,
    startupRegistered: col.startupRegistered,
    windows: [{ title: col.title, tabs }],
    windowCount: 1,
    tabCount: tabs.length,
    sig: "",
  };
}

export function exportAsJson(snaps: SessionSnapshot[], collections?: CollectionRecord[]): string {
  const payload: Record<string, unknown> = {
    format: "tabvault",
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions: snaps.map((s) => ({
      id: s.id,
      name: s.name || "",
      kind: s.kind,
      src: s.src,
      t: s.t,
      updatedAt: s.updatedAt,
      deviceName: s.deviceName,
      tags: s.tags,
      startupRegistered: s.startupRegistered,
      windows: s.windows,
    })),
  };
  if (collections && collections.length > 0) {
    payload.collections = collections;
  }
  return JSON.stringify(payload, null, 2);
}

export function exportAsOneTabText(snaps: SessionSnapshot[]): string {
  return snaps
    .map((s) =>
      s.windows
        .map((w) => w.tabs.map((t) => `${t.url} | ${t.title || t.url}`).join("\n"))
        .join("\n\n")
    )
    .join("\n\n");
}

export function exportAsMarkdown(snaps: SessionSnapshot[]): string {
  return snaps
    .map((s) => {
      const heading = `## ${s.name || new Date(s.t).toLocaleString()}`;
      const body = s.windows
        .map((w, idx) => {
          const wh = `### Window ${idx + 1}`;
          const lines = w.tabs.map((t) => `- [${(t.title || t.url).replace(/[\[\]]/g, "")}](${t.url})`);
          return `${wh}\n${lines.join("\n")}`;
        })
        .join("\n\n");
      return `${heading}\n\n${body}`;
    })
    .join("\n\n---\n\n");
}

export function exportAsCsv(snaps: SessionSnapshot[]): string {
  const esc = (v: string) => {
    const raw = String(v);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows = ["session,saved_at,window,title,url,pinned"];
  for (const s of snaps) {
    const sName = s.name || new Date(s.t).toISOString();
    s.windows.forEach((w, wi) => {
      for (const t of w.tabs) {
        rows.push(
          [esc(sName), esc(new Date(s.t).toISOString()), String(wi + 1), esc(t.title || ""), esc(t.url), t.pinned ? "true" : "false"].join(",")
        );
      }
    });
  }
  return rows.join("\n");
}

export function exportAsBookmarksHtml(snaps: SessionSnapshot[]): string {
  const esc = (v: string) =>
    String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const folders = snaps
    .map((s) => {
      const title = esc(s.name || `TabVault ${new Date(s.t).toLocaleString()}`);
      const addDate = Math.floor(s.t / 1000);
      const links = s.windows
        .flatMap((w) => w.tabs)
        .map((t) => `        <DT><A HREF="${esc(t.url)}" ADD_DATE="${addDate}">${esc(t.title || t.url)}</A>`)
        .join("\n");
      return `    <DT><H3 ADD_DATE="${addDate}">${title}</H3>\n    <DL><p>\n${links}\n    </DL><p>`;
    })
    .join("\n");
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>TabVault Bookmarks</TITLE>\n<H1>TabVault Sessions</H1>\n<DL><p>\n${folders}\n</DL><p>\n`;
}

export function formatWithTemplate(
  tabs: Array<{ title: string; url: string; groupTitle?: string }>,
  template: string
): string {
  return tabs
    .map((t) =>
      template
        .replace(/%t/g, t.title || t.url)
        .replace(/%u/g, t.url)
        .replace(/%g/g, t.groupTitle || "")
    )
    .join("\n");
}

function parseBookmarksHtml(html: string): ImportedSessionInput[] {
  const links: Array<{ url: string; title: string }> = [];
  const rx = /<A\s+[^>]*HREF=["']([^"']+)["'][^>]*>([\s\S]*?)<\/A>/gi;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(html)) !== null) {
    const url = m[1].trim();
    let rawTitle = m[2];
    let prev: string;
    do {
      prev = rawTitle;
      rawTitle = rawTitle.replace(/<[^>]*>/g, "");
    } while (rawTitle !== prev);
    const title = rawTitle.replace(/[<>]/g, "").trim() || url;
    if (/^https?:/i.test(url)) links.push({ url, title });
  }
  return links.length ? [mk("Bookmarks import", Date.now(), [{ tabs: links }], "bookmarksHtml")] : [];
}

function parseOneTabOrUrls(text: string): { source: string; sessions: ImportedSessionInput[] } {
  const groups: Array<Array<{ url: string; title: string }>> = [[]];
  let sawPipe = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      if (groups[groups.length - 1].length) groups.push([]);
      continue;
    }
    const pipeIdx = line.indexOf(" | ");
    if (pipeIdx >= 0) sawPipe = true;
    const url = (pipeIdx >= 0 ? line.slice(0, pipeIdx) : line.split(/\s+/)[0]).trim();
    const title = (pipeIdx >= 0 ? line.slice(pipeIdx + 3) : line.slice(url.length)).trim() || url;
    if (isRestorable(url)) {
      groups[groups.length - 1].push({ url, title });
    }
  }
  const wins = groups.filter((g) => g.length).map((tabs, i) => ({ title: `Group ${i + 1}`, tabs }));
  if (!wins.length) return { source: "urls", sessions: [] };
  const source = sawPipe ? "onetab" : "urls";
  return {
    source,
    sessions: [mk(sawPipe ? "OneTab import" : "URL List import", Date.now(), wins, source)],
  };
}

function parseSessionBuddy(o: unknown): ImportedSessionInput[] {
  const win = (f: JsonRecord): SavedWindow => ({
    title: str(f.name) || str(f.title) || undefined,
    tabs: toSavedTabs(f.links ?? f.tabs),
  });
  const coll = (c: JsonRecord) =>
    mk(
      str(c.name) || str(c.title) || (c.type === "current" ? "Session Buddy" : ""),
      toMs(c.created ?? c.updated ?? c.generated),
      asRecords(c.folders ?? c.windows).map(win),
      "sessionbuddy"
    );
  if (Array.isArray(o)) {
    const items = asRecords(o);
    if (!items.length) return [];
    if (items[0].folders || items[0].windows) return items.map(coll);
    if (items[0].links || items[0].tabs) return [mk("Session Buddy import", Date.now(), items.map(win), "sessionbuddy")];
    if (typeof items[0].url === "string") {
      return [mk("Session Buddy import", Date.now(), [{ tabs: toSavedTabs(items) }], "sessionbuddy")];
    }
    return [];
  }
  if (!isRecord(o)) return [];
  if (o.collections) return asRecords(o.collections).map(coll);
  if (o.sessions) return asRecords(o.sessions).map(coll);
  if (o.folders || o.windows) return [coll(o)];
  if (o.links || o.tabs) {
    return [mk("Session Buddy import", Date.now(), [{ tabs: toSavedTabs(o.links ?? o.tabs) }], "sessionbuddy")];
  }
  return [];
}

function parseTSM(o: unknown): ImportedSessionInput[] {
  const arr = Array.isArray(o) ? asRecords(o) : isRecord(o) ? [o] : [];
  return arr.map((s) => {
    const info = isRecord(s.windowsInfo) ? s.windowsInfo : {};
    const windowsRec = isRecord(s.windows) ? s.windows : {};
    const wins: SavedWindow[] = Object.entries(windowsRec).map(([wid, tabsObj]) => {
      const rawTabs = Array.isArray(tabsObj) ? tabsObj : isRecord(tabsObj) ? Object.values(tabsObj) : [];
      const sorted = asRecords(rawTabs).sort((a, b) => num(a.index) - num(b.index));
      const winMeta = isRecord(info[wid]) ? info[wid] : {};
      return {
        title: str(winMeta.title) || undefined,
        tabs: toSavedTabs(sorted),
      };
    });
    return mk(str(s.name, "Tab Session Manager"), toMs(s.date ?? s.lastEditedTime), wins, "tsm");
  });
}

function parseTablerone(o: unknown): ImportedSessionInput[] {
  const arr = Array.isArray(o)
    ? asRecords(o)
    : isRecord(o)
      ? asRecords(o.sessions ?? o.clusters ?? [o])
      : [];
  return arr
    .filter((c) => Boolean(c.tabs || c.windows))
    .map((c) =>
      mk(
        str(c.title) || str(c.name) || "Tablerone import",
        toMs(c.createdAt ?? c.created ?? c.updatedAt),
        c.windows ? toSavedWindows(c.windows) : [{ tabs: toSavedTabs(c.tabs) }],
        "tablerone"
      )
    );
}

function parseTabXpert(o: unknown): ImportedSessionInput[] {
  const docs = isRecord(o) && Array.isArray(o.docs) ? asRecords(o.docs) : Array.isArray(o) ? asRecords(o) : [];
  const wins = docs.filter((d) => Array.isArray(d.tabs));
  if (!wins.length) return [];
  return wins.map((w) =>
    mk(
      str(w.name, "TabXpert import"),
      toMs(w.dateCreated ?? w.dateUpdated),
      [{ title: str(w.name) || undefined, tabs: toSavedTabs(w.tabs) }],
      "tabxpert"
    )
  );
}

function parsePinboard(arr: unknown[]): ImportedSessionInput[] {
  const items = asRecords(arr);
  const tabs = items
    .filter((item) => typeof item.href === "string" && /^https?:/i.test(item.href))
    .map((item) => ({ url: String(item.href).trim(), title: String(item.description || item.href).trim() }));
  if (!tabs.length) return [];
  return [mk("Pinboard import", toMs(items[0]?.time), [{ title: "Pinboard", tabs }], "pinboard")];
}

function parseLinkwarden(o: unknown): ImportedSessionInput[] {
  if (!isRecord(o)) return [];
  const cols = asRecords(o.collections);
  if (cols.length) {
    return cols
      .filter((c) => Array.isArray(c.links) && c.links.length > 0)
      .map((c) =>
        mk(
          str(c.name, "Linkwarden collection"),
          toMs(c.createdAt ?? c.updatedAt),
          [
            {
              title: str(c.name, "Linkwarden"),
              tabs: asRecords(c.links)
                .filter((l) => typeof l.url === "string")
                .map((l) => ({ url: String(l.url).trim(), title: String(l.name || l.url).trim() })),
            },
          ],
          "linkwarden"
        )
      );
  }
  const links = asRecords(o.links);
  if (!links.length) return [];
  return [
    mk(
      "Linkwarden import",
      toMs(links[0]?.createdAt),
      [
        {
          title: "Linkwarden",
          tabs: links
            .filter((l) => typeof l.url === "string")
            .map((l) => ({ url: String(l.url).trim(), title: String(l.name || l.url).trim() })),
        },
      ],
      "linkwarden"
    ),
  ];
}

function toRecordList(v: unknown): JsonRecord[] {
  if (Array.isArray(v)) return asRecords(v);
  if (isRecord(v)) return asRecords(Object.values(v));
  return [];
}

function buildImportedCollection(
  title: string,
  items: CollectionItem[],
  order: number,
  tags: string[] = []
): CollectionRecord {
  const now = Date.now();
  return {
    id: uid(),
    parentFolderId: null,
    kind: "group",
    title: title.slice(0, 120) || "Imported Collection",
    color: "#0B87C9",
    createdAt: now,
    updatedAt: now,
    order,
    tags,
    items,
  };
}

function parseWorkona(o: unknown): CollectionRecord[] {
  if (!isRecord(o)) return [];
  const rawSpaces = o.Workspaces ?? o.workspaces ?? o.spaces;
  const spaces = toRecordList(rawSpaces);
  if (!spaces.length) return [];

  const now = Date.now();
  const cols: CollectionRecord[] = [];
  spaces.forEach((ws, idx) => {
    const seenUrls = new Set<string>();
    const items: CollectionItem[] = [];
    const pushEntry = (entry: JsonRecord) => {
      const url = str(entry.url).trim();
      if (!url || !isRestorable(url) || seenUrls.has(url)) return;
      seenUrls.add(url);
      const desc = str(entry.description).trim();
      items.push({
        id: uid(),
        url,
        title: (str(entry.title) || str(entry.name) || url).slice(0, 500),
        ...(desc ? { notes: desc.slice(0, 2000) } : {}),
        addedAt: now,
      });
    };

    for (const tab of toRecordList(ws.tabs)) pushEntry(tab);
    for (const res of toRecordList(ws.resources)) pushEntry(res);

    if (items.length > 0) {
      cols.push(buildImportedCollection(str(ws.title) || str(ws.name) || `Workona Space ${idx + 1}`, items, idx));
    }
  });
  return cols;
}

function parseToby(o: unknown): CollectionRecord[] {
  if (!isRecord(o)) return [];
  const lists = Array.isArray(o.lists)
    ? asRecords(o.lists)
    : Array.isArray(o.workspaces)
      ? asRecords(o.workspaces).flatMap((w) => (Array.isArray(w.lists) ? asRecords(w.lists) : []))
      : [];
  if (!lists.length) return [];

  const now = Date.now();
  const cols: CollectionRecord[] = [];
  lists.forEach((list, idx) => {
    const cards = asRecords(list.cards);
    const items: CollectionItem[] = [];
    const seenUrls = new Set<string>();
    const listTags = new Set<string>();

    for (const card of cards) {
      const url = str(card.url).trim();
      if (!url || !isRestorable(url) || seenUrls.has(url)) continue;
      seenUrls.add(url);
      const title = (str(card.customTitle) || str(card.title) || url).slice(0, 500);
      const desc = str(card.description).trim();
      if (Array.isArray(card.tags)) {
        for (const t of card.tags) {
          const clean = String(t).trim();
          if (clean) listTags.add(clean);
        }
      }
      items.push({
        id: uid(),
        url,
        title,
        ...(desc ? { notes: desc.slice(0, 2000) } : {}),
        addedAt: now,
      });
    }

    if (items.length > 0) {
      cols.push(buildImportedCollection(str(list.title) || `Toby List ${idx + 1}`, items, idx, [...listTags]));
    }
  });
  return cols;
}

function parseSpaces(o: unknown): ImportedSessionInput[] {
  const rawSessions = Array.isArray(o)
    ? asRecords(o)
    : isRecord(o)
      ? asRecords(o.sessions ?? o.spaces ?? [o])
      : [];
  return rawSessions
    .filter((s) => Boolean(s.windows || s.tabs))
    .map((s) =>
      mk(
        str(s.name) || str(s.title) || "Spaces import",
        toMs(s.createdAt ?? s.lastAccess ?? s.t),
        s.windows ? toSavedWindows(s.windows) : [{ tabs: toSavedTabs(s.tabs) }],
        "spaces"
      )
    );
}

function parseCluster(o: unknown): ImportedSessionInput[] {
  const rawWindows = Array.isArray(o)
    ? asRecords(o)
    : isRecord(o)
      ? asRecords(o.savedWindows ?? o.windows)
      : [];
  const validWins = rawWindows.filter((w) => Array.isArray(w.tabs));
  if (!validWins.length) return [];
  const name = isRecord(o) ? str(o.name) || str(o.title) || "Cluster import" : "Cluster import";
  const ts = isRecord(o) ? toMs(o.createdAt ?? o.updatedAt ?? o.date) : Date.now();
  return [mk(name, ts, toSavedWindows(validWins), "cluster")];
}

export function detectAndParseImport(rawText: string): ImportParseResult {
  const text = String(rawText || "").replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error("Empty import input.");

  if (/<!DOCTYPE\s+NETSCAPE-Bookmark-file-1|<DL>/i.test(text)) {
    const isPocket = /Pocket|ril_export|Read Archive/i.test(text);
    const sessions = parseBookmarksHtml(text).filter((s) => s.windows.length > 0);
    if (!sessions.length) throw new Error("No bookmarks found in HTML file.");
    if (isPocket) {
      return {
        source: "pocket",
        sessions: sessions.map((s) => ({ ...s, name: "Pocket import", src: "pocket" })),
      };
    }
    return { source: "bookmarksHtml", sessions };
  }

  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (json === null) {
    const parsed = parseOneTabOrUrls(text);
    const sessions = parsed.sessions.filter((s) => s.windows.length > 0);
    if (!sessions.length) throw new Error("No valid URLs found in text.");
    return { source: parsed.source, sessions };
  }

  let source = "sessionbuddy";
  let sessions: ImportedSessionInput[] = [];
  let collections: CollectionRecord[] = [];

  const root = isRecord(json) ? json : null;
  const firstArrItem = Array.isArray(json) && isRecord(json[0]) ? json[0] : null;
  const firstOrRoot = firstArrItem ?? root;

  if (root && (root.format === "tabvault" || root.format === "smarttabber" || root.format === "tabretain")) {
    source = root.format === "tabretain" ? "tabretain" : "tabvault";
    const allowedKinds = new Set<SnapshotKind>(["auto", "windowClose", "browserExit", "named", "imported"]);
    sessions = asRecords(root.sessions).map((s) => {
      const kindStr = str(s.kind) as SnapshotKind;
      const kind: SnapshotKind = source === "tabvault" && allowedKinds.has(kindStr) ? kindStr : "imported";
      return mk(str(s.name), toMs(s.t), toSavedWindows(s.windows), str(s.src, source), kind);
    });
    if (Array.isArray(root.collections)) {
      collections = asRecords(root.collections)
        .map((c, idx): CollectionRecord => {
          const created = toMs(c.createdAt ?? c.updatedAt);
          const updated = toMs(c.updatedAt ?? c.createdAt);
          const kind = c.kind === "folder" ? "folder" : "group";
          const items: CollectionItem[] = asRecords(c.items)
            .filter((it) => typeof it.url === "string" && isRestorable(it.url.trim()))
            .map((it): CollectionItem => ({
              id: typeof it.id === "string" && it.id ? it.id : uid(),
              url: String(it.url).trim(),
              title: String(it.title || it.url).slice(0, 500),
              ...(typeof it.favIconUrl === "string" && it.favIconUrl.length < 2048 ? { favIconUrl: it.favIconUrl } : {}),
              ...(it.pinned ? { pinned: true } : {}),
              ...(typeof it.groupTitle === "string" && it.groupTitle ? { groupTitle: it.groupTitle.slice(0, 120) } : {}),
              ...(typeof it.groupColor === "string" ? { groupColor: normalizeGroupColor(it.groupColor) } : {}),
              ...(typeof it.notes === "string" && it.notes ? { notes: it.notes.slice(0, 2000) } : {}),
              ...(it.starred ? { starred: true } : {}),
              ...(it.isTask ? { isTask: true } : {}),
              ...(it.taskDone ? { taskDone: true } : {}),
              ...(it.archived ? { archived: true } : {}),
              addedAt: toMs(it.addedAt ?? created),
            }));
          return {
            id: typeof c.id === "string" && c.id ? c.id : uid(),
            parentFolderId: typeof c.parentFolderId === "string" ? c.parentFolderId : null,
            kind,
            title: String(c.title || (kind === "folder" ? "Imported Folder" : "Imported Collection")).slice(0, 120),
            color: typeof c.color === "string" && c.color ? c.color : "#0B87C9",
            ...(typeof c.notes === "string" && c.notes ? { notes: c.notes.slice(0, 4000) } : {}),
            ...(c.starred ? { starred: true } : {}),
            ...(c.locked ? { locked: true } : {}),
            ...(c.archived ? { archived: true } : {}),
            ...(c.startupRegistered ? { startupRegistered: true } : {}),
            createdAt: created,
            updatedAt: updated,
            ...(c.lastOpenedAt ? { lastOpenedAt: toMs(c.lastOpenedAt) } : {}),
            order: typeof c.order === "number" ? c.order : idx,
            tags: Array.isArray(c.tags) ? c.tags.map((t: unknown) => String(t).trim()).filter(Boolean) : [],
            items,
          };
        })
        .filter((c) => c.kind === "folder" || c.items.length > 0);
    }
  } else if (
    firstOrRoot?.windowsNumber !== undefined ||
    (firstArrItem?.windows && !Array.isArray(firstArrItem.windows))
  ) {
    source = "tsm";
    sessions = parseTSM(json);
  } else if (root && Array.isArray(root.docs)) {
    source = "tabxpert";
    sessions = parseTabXpert(json);
  } else if (root?.clusters || firstArrItem?.clusterId) {
    source = "tablerone";
    sessions = parseTablerone(json);
  } else if (Array.isArray(json) && firstArrItem?.href && firstArrItem?.description !== undefined) {
    source = "pinboard";
    sessions = parsePinboard(json);
  } else if (
    root &&
    (root.Workspaces !== undefined || root.workspaces !== undefined || root.spaces !== undefined) &&
    toRecordList(root.Workspaces ?? root.workspaces ?? root.spaces).some((w) => w.tabs !== undefined || w.resources !== undefined)
  ) {
    source = "workona";
    collections = parseWorkona(json);
  } else if (
    root &&
    (Array.isArray(root.lists) ||
      (Array.isArray(root.workspaces) && asRecords(root.workspaces).some((w) => Array.isArray(w.lists))))
  ) {
    source = "toby";
    collections = parseToby(json);
  } else if (
    root &&
    (root.exportSource === "cluster" ||
      Array.isArray(root.savedWindows) ||
      (Array.isArray(root.windows) && asRecords(root.windows).some((w) => w.windowId !== undefined && Array.isArray(w.tabs))))
  ) {
    source = "cluster";
    sessions = parseCluster(json);
  } else if (
    firstOrRoot?.sessionId !== undefined ||
    (root && root.exportVersion !== undefined && Array.isArray(root.sessions))
  ) {
    source = "spaces";
    sessions = parseSpaces(json);
  } else if (
    root &&
    (Array.isArray(root.collections) || Array.isArray(root.links)) &&
    (asRecords(root.collections)[0]?.links || asRecords(root.links)[0]?.url)
  ) {
    source = "linkwarden";
    sessions = parseLinkwarden(json);
  } else {
    source = "sessionbuddy";
    sessions = parseSessionBuddy(json);
  }

  sessions = sessions.filter((s) => countTabs(s.windows) > 0);
  if (!sessions.length && !collections.length) throw new Error("No tabs found in this file.");
  return collections.length > 0 ? { source, sessions, collections } : { source, sessions };
}

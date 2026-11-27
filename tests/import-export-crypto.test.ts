import { describe, expect, it } from "vitest";
import { decryptPayload, encryptPayload } from "../src/shared/crypto.ts";
import { evaluatePasswordStrength, isEncryptedBackupText } from "../src/shared/password-strength.ts";
import {
  detectAndParseImport,
  exportAsBookmarksHtml,
  exportAsCsv,
  exportAsJson,
  exportAsMarkdown,
  exportAsOneTabText,
  formatWithTemplate,
} from "../src/shared/import-export.ts";
import type { CollectionRecord, SessionSnapshot } from "../src/shared/types.ts";

const sampleSnapshot: SessionSnapshot = {
  id: "s1",
  t: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  kind: "named",
  name: "Work Research",
  runId: "run1",
  tags: ["docs"],
  windows: [
    {
      tabs: [
        { url: "https://astro.build/", title: "Astro", pinned: true },
        { url: "https://vitejs.dev/guide/", title: "Vite Guide" },
      ],
    },
  ],
  windowCount: 1,
  tabCount: 2,
  sig: "sig1",
};

describe("import & export interoperability", () => {
  it("round-trips SmartTabber JSON and preserves metadata and collections", () => {
    const sampleCollection: CollectionRecord = {
      id: "col-1",
      parentFolderId: null,
      kind: "group",
      title: "Launch Stack",
      color: "#0EA5E9",
      notes: "Q4 docs",
      starred: true,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      order: 0,
      tags: ["launch"],
      items: [
        {
          id: "it-1",
          url: "https://astro.build/",
          title: "Astro",
          groupTitle: "Frameworks",
          groupColor: "blue",
          notes: "Primary framework",
          addedAt: 1_700_000_000_000,
        },
      ],
    };

    const json = exportAsJson([sampleSnapshot], [sampleCollection]);
    const parsed = detectAndParseImport(json);
    expect(parsed.source).toBe("tabvault");
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.sessions[0].name).toBe("Work Research");
    expect(parsed.sessions[0].windows[0].tabs).toHaveLength(2);
    expect(parsed.collections).toHaveLength(1);
    expect(parsed.collections?.[0].title).toBe("Launch Stack");
    expect(parsed.collections?.[0].items[0].notes).toBe("Primary framework");
    expect(parsed.collections?.[0].items[0].groupTitle).toBe("Frameworks");

    const collectionsOnly = exportAsJson([], [sampleCollection]);
    const parsedColsOnly = detectAndParseImport(collectionsOnly);
    expect(parsedColsOnly.sessions).toHaveLength(0);
    expect(parsedColsOnly.collections).toHaveLength(1);
  });

  it("exports & re-imports Bookmarks HTML and OneTab text", () => {
    const html = exportAsBookmarksHtml([sampleSnapshot]);
    const fromHtml = detectAndParseImport(html);
    expect(fromHtml.source).toBe("bookmarksHtml");
    expect(fromHtml.sessions[0].windows[0].tabs.map((t) => t.url)).toEqual([
      "https://astro.build/",
      "https://vitejs.dev/guide/",
    ]);

    const onetab = exportAsOneTabText([sampleSnapshot]);
    const fromOneTab = detectAndParseImport(onetab);
    expect(fromOneTab.source).toBe("onetab");
    expect(fromOneTab.sessions[0].windows[0].tabs).toHaveLength(2);
  });

  it("formats Markdown, CSV, and custom templates", () => {
    const md = exportAsMarkdown([sampleSnapshot]);
    expect(md).toContain("## Work Research");
    expect(md).toContain("[Astro](https://astro.build/)");

    const csv = exportAsCsv([sampleSnapshot]);
    expect(csv).toContain("session,saved_at,window,title,url,pinned");
    expect(csv).toContain('"https://astro.build/",true');

    expect(formatWithTemplate(sampleSnapshot.windows[0].tabs, "[%t](%u)")).toBe(
      "[Astro](https://astro.build/)\n[Vite Guide](https://vitejs.dev/guide/)"
    );
  });

  it("imports TabRetain, Session Buddy, Tab Session Manager, Tablerone, TabXpert, and URL lists", () => {
    const tabRetain = JSON.stringify({
      format: "tabretain",
      sessions: [{ name: "TR", t: 1_700_000_000, windows: [{ tabs: [{ url: "https://tr.example", title: "TR" }] }] }],
    });
    expect(detectAndParseImport(tabRetain).source).toBe("tabretain");

    const sb = JSON.stringify({
      collections: [
        { title: "SB Col", folders: [{ links: [{ url: "https://sb.example", title: "SB" }] }] },
      ],
    });
    expect(detectAndParseImport(sb).source).toBe("sessionbuddy");

    const tsm = JSON.stringify([
      {
        name: "TSM Session",
        date: 1_700_000_000_000,
        windowsNumber: 1,
        windows: { w1: { t1: { url: "https://tsm.example", title: "TSM", index: 0 } } },
      },
    ]);
    expect(detectAndParseImport(tsm).source).toBe("tsm");

    const tablerone = JSON.stringify({
      clusters: [{ title: "T1", tabs: [{ url: "https://tab1.example", title: "Tab1" }] }],
    });
    expect(detectAndParseImport(tablerone).source).toBe("tablerone");

    const pocketHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1><TITLE>Pocket Export</TITLE><H1>Unread</H1><DL><p><DT><A HREF="https://pocket.example/1">Saved Article</A></DL><p>`;
    const pocketRes = detectAndParseImport(pocketHtml);
    expect(pocketRes.source).toBe("pocket");
    expect(pocketRes.sessions[0].windows[0].tabs[0].url).toBe("https://pocket.example/1");

    const pinboardJson = JSON.stringify([
      { href: "https://pinboard.example/a", description: "Pin A", time: "2026-11-01T00:00:00Z" },
    ]);
    const pinboardRes = detectAndParseImport(pinboardJson);
    expect(pinboardRes.source).toBe("pinboard");
    expect(pinboardRes.sessions[0].windows[0].tabs[0].title).toBe("Pin A");

    const linkwardenJson = JSON.stringify({
      collections: [{ name: "LW Stack", links: [{ url: "https://lw.example/1", name: "LW 1" }] }],
    });
    const lwRes = detectAndParseImport(linkwardenJson);
    expect(lwRes.source).toBe("linkwarden");
    expect(lwRes.sessions[0].name).toBe("LW Stack");
    expect(detectAndParseImport(tablerone).source).toBe("tablerone");

    const tabxpert = JSON.stringify({
      docs: [{ name: "TX", tabs: [{ url: "https://tx.example", title: "TX" }] }],
    });
    expect(detectAndParseImport(tabxpert).source).toBe("tabxpert");

    const urls = detectAndParseImport("https://one.example\nhttps://two.example");
    expect(urls.source).toBe("urls");
    expect(urls.sessions[0].windows[0].tabs).toHaveLength(2);
  });

  it("rejects non-restorable schemes in URL list / OneTab imports", () => {
    const mixed = detectAndParseImport(
      "javascript://alert(1)\nfile:///etc/passwd\ndata://text/html,hi\nhttps://safe.example/page"
    );
    expect(mixed.sessions[0].windows[0].tabs.map((t) => t.url)).toEqual(["https://safe.example/page"]);
    expect(() => detectAndParseImport("javascript://alert(1)\nfile:///C:/secret")).toThrow();
  });
});

describe("client-side backup encryption", () => {
  it("encrypts and decrypts payloads with AES-GCM-256 and rejects wrong passwords", async () => {
    const payload = JSON.stringify({ hello: "smarttabber", tabs: 42 });
    const env = await encryptPayload(payload, "correct-horse-battery");
    expect(env.format).toBe("tabvault-encrypted");

    const decrypted = await decryptPayload(env, "correct-horse-battery");
    expect(decrypted).toBe(payload);

    await expect(decryptPayload(env, "wrong-password")).rejects.toThrow();
  });

  it("evaluates password strength by length/passphrase and detects encrypted envelopes", () => {
    expect(evaluatePasswordStrength("").level).toBe("empty");
    expect(evaluatePasswordStrength("short").level).toBe("weak");
    expect(evaluatePasswordStrength("tenletters").level).toBe("fair");
    expect(evaluatePasswordStrength("twelveletter").level).toBe("good");
    expect(evaluatePasswordStrength("correct horse battery staple").level).toBe("strong");

    expect(isEncryptedBackupText(JSON.stringify({ format: "tabvault-encrypted", version: 1 }))).toBe(true);
    expect(isEncryptedBackupText(JSON.stringify({ format: "tabvault", version: 1 }))).toBe(false);
    expect(isEncryptedBackupText("https://example.com")).toBe(false);
  });
});

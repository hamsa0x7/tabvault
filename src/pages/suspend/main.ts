function applySuspendTheme(theme?: "system" | "light" | "dark"): void {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme !== "light" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

applySuspendTheme();
void chrome.storage?.local
  ?.get("settings")
  .then((res) => {
    const theme = (res?.settings as { theme?: "system" | "light" | "dark" } | undefined)?.theme;
    applySuspendTheme(theme);
  })
  .catch(() => {});

const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
const params = new URLSearchParams(hash);
const targetUrl = params.get("url") || "";
const title = params.get("title") || targetUrl || "Sleeping tab";
const fav = params.get("favIconUrl") || "";

document.title = `Sleeping: ${title}`;
const titleEl = document.getElementById("title");
const urlEl = document.getElementById("urlText");
const favEl = document.getElementById("fav") as HTMLImageElement | null;
const wakeBtn = document.getElementById("wakeBtn");

function sanitizeHttpUrl(raw: string, allowFtp = false): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
    if (allowFtp && parsed.protocol === "ftp:") {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

function sanitizeFaviconUrl(raw: string): string | null {
  const httpUrl = sanitizeHttpUrl(raw);
  if (httpUrl) return httpUrl;
  const m = /^data:image\/(png|jpeg|jpg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,([A-Za-z0-9+/=]+)$/i.exec(raw);
  if (m) {
    return `data:image/${m[1].toLowerCase()};base64,${m[2]}`;
  }
  return null;
}

const safeTargetUrl = sanitizeHttpUrl(targetUrl, true);
const safeFavUrl = sanitizeFaviconUrl(fav);

if (titleEl) titleEl.textContent = title;
if (urlEl) urlEl.textContent = targetUrl;
if (favEl && safeFavUrl) {
  favEl.src = safeFavUrl;
  favEl.hidden = false;
}

function wake() {
  if (safeTargetUrl) {
    location.replace(safeTargetUrl);
  }
}

wakeBtn?.addEventListener("click", wake);
document.addEventListener("click", (e) => {
  if (e.target === document.body) wake();
});

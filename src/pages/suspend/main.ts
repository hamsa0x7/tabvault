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

if (titleEl) titleEl.textContent = title;
if (urlEl) urlEl.textContent = targetUrl;
if (favEl && /^(https?:|data:image\/)/i.test(fav)) {
  favEl.src = fav;
  favEl.hidden = false;
}

function wake() {
  if (/^(https?|ftp):\/\//i.test(targetUrl)) {
    location.replace(targetUrl);
  }
}

wakeBtn?.addEventListener("click", wake);
document.addEventListener("click", (e) => {
  if (e.target === document.body) wake();
});

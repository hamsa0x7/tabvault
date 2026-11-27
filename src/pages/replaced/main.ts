function applyTheme(theme?: "system" | "light" | "dark"): void {
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme !== "light" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

applyTheme();
void chrome.storage?.local
  ?.get("settings")
  .then((res) => {
    const theme = (res?.settings as { theme?: "system" | "light" | "dark" } | undefined)?.theme;
    applyTheme(theme);
  })
  .catch(() => {});

const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
const params = new URLSearchParams(hash);
const targetUrl = params.get("url") || "";
const title = params.get("title") || targetUrl || "Restricted page";

document.title = `${title} — TabVault`;
const titleEl = document.getElementById("title");
const urlInput = document.getElementById("urlInput") as HTMLInputElement | null;
const copyBtn = document.getElementById("copyBtn") as HTMLButtonElement | null;

if (titleEl) titleEl.textContent = title;
if (urlInput) {
  urlInput.value = targetUrl;
  urlInput.addEventListener("focus", () => urlInput.select());
}

copyBtn?.addEventListener("click", async () => {
  if (!targetUrl) return;
  try {
    await navigator.clipboard.writeText(targetUrl);
    copyBtn.textContent = "Copied";
    setTimeout(() => {
      copyBtn.textContent = "Copy URL";
    }, 1800);
  } catch {
    urlInput?.select();
  }
});

export {};

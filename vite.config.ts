import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html"),
        dashboard: resolve(import.meta.dirname, "dashboard.html"),
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        options: resolve(import.meta.dirname, "options.html"),
        offscreen: resolve(import.meta.dirname, "offscreen.html"),
        suspend: resolve(import.meta.dirname, "suspend.html"),
        replaced: resolve(import.meta.dirname, "replaced.html"),
        background: resolve(import.meta.dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});

/// <reference types="vitest/config" />
import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { ViteDevServer } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  publicDir: false,
  plugins: [react(), rootStaticPlugin()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: false,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: false,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});

function rootStaticPlugin() {
  const root = process.cwd();
  const prefixes = ["/content/", "/icons/", "/fonts/", "/assets/", "/screenshots/"];
  const exact = new Set(["/manifest.webmanifest"]);
  return {
    name: "root-static-public-contracts",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
        const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
        if (!exact.has(pathname) && !prefixes.some((prefix) => pathname.startsWith(prefix))) return next();
        const filePath = path.join(root, pathname.slice(1));
        if (!existsSync(filePath) || !statSync(filePath).isFile()) return next();
        response.setHeader("Content-Type", contentType(filePath));
        createReadStream(filePath).pipe(response);
      });
    },
  };
}

function contentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json" || ext === ".webmanifest") return "application/json; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".woff2") return "font/woff2";
  return "application/octet-stream";
}

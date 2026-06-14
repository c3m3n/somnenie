import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { readdir } from "node:fs/promises";
import { build } from "esbuild";
import { loadStaticConfig } from "./load-static-config.mjs";

const root = process.cwd();
const dist = path.join(root, "dist");
const { STATIC_ENTRIES: staticEntries } = await loadStaticConfig(root);

async function copyStaticEntry(entry) {
  await cp(path.join(root, entry), path.join(dist, entry), {
    recursive: true,
    force: true,
  });
}

async function buildServiceWorker() {
  const buildHash = new Date().toISOString().replace(/\W/g, "").slice(0, 16);
  const shellAssets = await collectShellAssets();
  await build({
    entryPoints: [path.join(root, "web", "src", "pwa", "sw.ts")],
    bundle: true,
    outfile: path.join(dist, "sw.js"),
    format: "iife",
    target: "es2022",
    sourcemap: true,
    define: {
      __NUTRIO_BUILD_HASH__: JSON.stringify(buildHash),
      __NUTRIO_APP_SHELL_ASSETS__: JSON.stringify(shellAssets),
    },
  });
}

async function writeNoJekyll() {
  await writeFile(path.join(dist, ".nojekyll"), "");
}

async function assertNoInlineScripts() {
  const index = await readFile(path.join(dist, "index.html"), "utf8");
  if (/<script(?![^>]+src=)[^>]*>/i.test(index)) {
    throw new Error("dist/index.html must not contain inline scripts");
  }
}

async function collectShellAssets() {
  const assetsDir = path.join(dist, "assets");
  try {
    const files = await readdir(assetsDir, { withFileTypes: true });
    return files
      .filter((entry) => entry.isFile() && /^index-.*\.(js|css)$/i.test(entry.name))
      .map((entry) => `/assets/${entry.name}`);
  } catch {
    return [];
  }
}

await mkdir(dist, { recursive: true });
await Promise.all(staticEntries.map(copyStaticEntry));
await buildServiceWorker();
await writeNoJekyll();
await assertNoInlineScripts();

console.log("Postbuild assets and service worker completed.");

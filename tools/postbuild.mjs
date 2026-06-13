import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const dist = path.join(root, "dist");

const staticEntries = [
  "content",
  "icons",
  "fonts",
  "assets",
  "screenshots",
  "manifest.webmanifest",
];

async function copyStaticEntry(entry) {
  await cp(path.join(root, entry), path.join(dist, entry), {
    recursive: true,
    force: true,
  });
}

async function buildServiceWorker() {
  await build({
    entryPoints: [path.join(root, "web", "src", "pwa", "sw.ts")],
    bundle: true,
    outfile: path.join(dist, "sw.js"),
    format: "iife",
    target: "es2022",
    sourcemap: true,
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

await mkdir(dist, { recursive: true });
await Promise.all(staticEntries.map(copyStaticEntry));
await buildServiceWorker();
await writeNoJekyll();
await assertNoInlineScripts();

console.log("Postbuild assets and service worker completed.");

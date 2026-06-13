import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function exists(file) {
  try {
    await fs.access(path.join(dist, file));
    return true;
  } catch {
    return false;
  }
}

const index = await fs.readFile(path.join(dist, "index.html"), "utf8");
assert(index.includes('type="module"'), "dist index should load the React module entry");
assert(!/<script(?![^>]+src=)[^>]*>/i.test(index), "dist index should not contain inline scripts");

for (const file of [
  "sw.js",
  "manifest.webmanifest",
  "content/manifest.json",
  "content/course.json",
  "content/claims.json",
  "icons/icon-192.png",
  "assets/generated/icon-today.png",
]) {
  assert(await exists(file), `dist should contain ${file}`);
}

const sw = await fs.readFile(path.join(dist, "sw.js"), "utf8");
assert(sw.includes("nutrio-react-v"), "dist service worker should use the React cache version");
assert(sw.includes("content/manifest.json"), "dist service worker should cache content indexes");

console.log("Dist smoke passed.");

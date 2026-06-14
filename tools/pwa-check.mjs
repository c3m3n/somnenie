import fs from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const publicRoot = process.env.NUTRIO_PUBLIC_ROOT
  ? path.resolve(projectRoot, process.env.NUTRIO_PUBLIC_ROOT)
  : path.join(projectRoot, "dist");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readText(file) {
  return fs.readFile(path.join(publicRoot, file), "utf8");
}

async function readJson(file) {
  return JSON.parse(await readText(file));
}

async function readProjectJson(file) {
  return JSON.parse(await fs.readFile(path.join(projectRoot, file), "utf8"));
}

function assetPath(src) {
  return String(src || "").replace(/^[.][/\\]/, "");
}

async function assertPngSize(file, expectedSizes) {
  const buffer = await fs.readFile(path.join(publicRoot, file));
  assert(buffer.slice(1, 4).toString("ascii") === "PNG", `${file} should be a PNG`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert(expectedSizes.includes(`${width}x${height}`), `${file} has unexpected size ${width}x${height}`);
}

const manifest = await readJson("manifest.webmanifest");
assert(manifest.name && manifest.short_name, "manifest should expose app names");
assert(manifest.id, "manifest should define a stable app id");
assert(manifest.lang === "ru", "manifest language should be ru");
assert(manifest.start_url?.includes("#today"), "manifest start_url should launch Today");
assert(manifest.scope === "./", "manifest scope should stay local to the app");
assert(manifest.display === "standalone", "manifest display should be standalone");
assert(Array.isArray(manifest.display_override) && manifest.display_override.includes("standalone"), "manifest should include display_override");
assert(manifest.background_color && manifest.theme_color, "manifest should define theme colors");
assert(manifest.prefer_related_applications === false, "manifest should avoid unrelated native-app prompts");

const icons = manifest.icons || [];
assert(icons.some((icon) => icon.sizes === "192x192" && icon.purpose?.includes("any")), "manifest should include a 192 any icon");
assert(icons.some((icon) => icon.sizes === "512x512" && icon.purpose?.includes("any")), "manifest should include a 512 any icon");
assert(icons.some((icon) => icon.sizes === "512x512" && icon.purpose?.includes("maskable")), "manifest should include a maskable icon");
for (const icon of icons) await assertPngSize(assetPath(icon.src), [icon.sizes]);

const shortcuts = manifest.shortcuts || [];
for (const route of ["#today", "#atlas", "#memory", "#journal"]) {
  assert(shortcuts.some((item) => String(item.url || "").includes(route)), `manifest shortcut ${route} is missing`);
}

const screenshots = manifest.screenshots || [];
assert(screenshots.some((item) => item.form_factor === "narrow"), "manifest should include a narrow screenshot");
assert(screenshots.some((item) => item.form_factor === "wide"), "manifest should include a wide screenshot");
for (const screenshot of screenshots) await assertPngSize(assetPath(screenshot.src), [screenshot.sizes]);

const sw = await readText("sw.js");
assert(sw.includes("nutrio-react-v"), "service worker should declare the React cache version");
assert(sw.includes("/content/manifest.json"), "service worker should cache the content manifest");
assert(sw.includes("/content/course.json"), "service worker should cache the course index");
assert(sw.includes("/content/claims.json"), "service worker should cache claims");
assert(sw.includes("CACHE_CONTENT"), "service worker should support content warmup messages");
assert(sw.includes("SKIP_WAITING"), "service worker should keep explicit update activation");
assert(sw.includes("navigationPreload"), "service worker should keep navigation preload support");
assert(sw.includes('startsWith("nutrio-")'), "service worker should only target Nutrio cache names");
assert(sw.includes("networkFirst"), "service worker should keep network-first mutable asset handling");

const index = await readText("index.html");
assert(index.includes('rel="manifest"'), "dist index should link the manifest");
assert(index.includes('apple-mobile-web-app-capable'), "dist index should include Apple PWA metadata");
assert(index.includes('type="module"'), "dist index should load the React module entry");
assert(!/<script(?![^>]+src=)[^>]*>/i.test(index), "dist index should not contain inline scripts");

const vercel = await readProjectJson("vercel.json");
assert(vercel.buildCommand === "npm run build", "Vercel should build the React app");
assert(vercel.outputDirectory === "dist", "Vercel should serve the dist output");
assert(vercel.headers.some((entry) => entry.source === "/screenshots/(.*)"), "Vercel should cache manifest screenshots as static assets");

console.log("PWA check passed.");

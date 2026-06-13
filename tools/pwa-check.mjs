import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readText(file) {
  return fs.readFile(path.join(projectRoot, file), "utf8");
}

async function readJson(file) {
  return JSON.parse(await readText(file));
}

function assetPath(src) {
  return String(src || "").replace(/^[.][/\\]/, "");
}

async function assertPngSize(file, expectedSizes) {
  const buffer = await fs.readFile(path.join(projectRoot, file));
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
for (const asset of [
  "./core/constants.js",
  "./core/util.js",
  "./core/storage.js",
  "./core/review.js",
  "./core/quiz.js",
  "./app.js",
  "./views/session.js",
  "./views/quiz.js",
  "./style.css",
  "./manifest.webmanifest",
  "./icons/favicon-32.png",
  "./screenshots/home-narrow.png",
  "./screenshots/progress-wide.png",
]) {
  assert(sw.includes(`"${asset}"`), `service worker should precache ${asset}`);
}
assert(/const VERSION = "nutrio-v\d+";/.test(sw), "service worker should declare a versioned Nutrio cache");
assert(sw.includes('importScripts("./core/constants.js")'), "service worker should import shared constants");
assert(sw.includes('event.data?.type === "CACHE_CONTENT"'), "service worker should support content warmup messages");
assert(sw.includes("navigationPreload.enable"), "service worker should enable navigation preload");
assert(sw.includes("event.preloadResponse"), "service worker should use navigation preload responses");
assert(sw.includes('event.data?.type === "SKIP_WAITING"'), "service worker should keep explicit update activation");
assert(sw.includes('k.startsWith("nutrio-") && !k.startsWith(VERSION)'), "service worker should only clean Nutrio caches");

const app = await readText("app.js");
assert(app.includes('"beforeinstallprompt"'), "app should handle the install prompt event");
assert(app.includes("triggerPwaInstall"), "app should expose a custom install action");
assert(app.includes("syncOnlineStatus"), "app should react to online/offline changes");
assert(app.includes("applyLaunchRoute"), "app should support manifest shortcut launch routes");
assert(app.includes("navigator.serviceWorker.ready"), "app should warm service worker content cache");

const index = await readText("index.html");
assert(index.includes('rel="manifest"'), "index should link the manifest");
assert(index.includes('apple-mobile-web-app-capable'), "index should include Apple PWA metadata");
assert(index.includes('core/constants.js'), "index should load shared constants before app code");

const vercel = await readJson("vercel.json");
assert(vercel.headers.some((entry) => entry.source === "/screenshots/(.*)"), "Vercel should cache manifest screenshots as static assets");

console.log("PWA check passed.");

/* Service worker для офлайн-доступа. Кэширует оболочку приложения и учебный контент. */

importScripts("./core/constants.js");

const VERSION = "nutrio-v19";
const SHELL_CACHE = `${VERSION}-shell`;
const CONTENT_CACHE = `${VERSION}-content`;
const MODULE_FILES = self.NutrioConst?.MODULE_FILES || ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"];

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./core/constants.js",
  "./core/util.js",
  "./core/storage.js",
  "./core/review.js",
  "./core/quiz.js",
  "./core/learningPath.js",
  "./app.js",
  "./views/session.js",
  "./views/quiz.js",
  "./manifest.webmanifest",
  "./lib/marked.min.js",
  "./fonts/IBMPlexMono-Regular.woff2",
  "./fonts/IBMPlexMono-Bold.woff2",
  "./fonts/IBMPlexSans-Regular.woff2",
  "./fonts/IBMPlexSans-Bold.woff2",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png",
  "./assets/generated/icon-today.png",
  "./assets/generated/icon-atlas.png",
  "./assets/generated/icon-memory.png",
  "./assets/generated/icon-journal.png",
  "./assets/generated/icon-understand.png",
  "./assets/generated/icon-apply.png",
  "./assets/generated/icon-check.png",
  "./assets/generated/icon-anchor.png",
  "./assets/generated/icon-progress.png",
  "./assets/generated/icon-install.png",
  "./assets/generated/icon-offline.png",
  "./assets/generated/icon-next.png",
  "./assets/generated/icon-nutrient.png",
  "./assets/generated/icon-product.png",
  "./assets/generated/icon-diet.png",
  "./assets/generated/icon-evidence.png",
  "./screenshots/home-narrow.png",
  "./screenshots/progress-wide.png",
];

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return await res.json();
}

async function precacheContent() {
  const cache = await caches.open(CONTENT_CACHE);
  await precacheContentIndexes(cache);

  const ids = [];
  let files = MODULE_FILES;

  try {
    const manifest = await fetchJson("content/manifest.json");
    if (Array.isArray(manifest.moduleFiles) && manifest.moduleFiles.length) files = manifest.moduleFiles;
    for (const module of manifest.modules || []) {
      if (module && module.id) ids.push(module.id);
    }
  } catch {
    // Fall back to course.json if an older deployment has no content manifest.
  }

  if (!ids.length) {
    try {
      const course = await fetchJson("content/course.json");
      for (const phase of course.phases || []) {
        for (const id of phase.modules || []) ids.push(id);
      }
    } catch {
      // Without an index, content will be cached lazily as lessons are opened.
    }
  }

  const urls = [];
  for (const id of ids) {
    for (const f of files) urls.push(`content/${id}/${f}`);
  }
  await Promise.allSettled(urls.map((u) => cache.add(u)));
}

async function precacheContentIndexes(cache = null) {
  const contentCache = cache || await caches.open(CONTENT_CACHE);
  await contentCache.add("content/manifest.json").catch(() => {});
  await contentCache.add("content/course.json").catch(() => {});
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(APP_SHELL);
    await precacheContentIndexes();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "CACHE_CONTENT") {
    event.waitUntil(precacheContent().catch((error) => console.warn("Content warmup failed", error)));
  }
  if (event.data?.type === "GET_VERSION") {
    event.source?.postMessage?.({ type: "SW_VERSION", version: VERSION });
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("nutrio-") && !k.startsWith(VERSION)).map((k) => caches.delete(k)));
    await self.clients.claim();
    precacheContent().catch((error) => console.warn("Content precache failed", error));
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const preload = await event.preloadResponse;
      if (preload) return preload;
      try {
        return await fetch(req);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match("./index.html")) || (await cache.match("./")) || Response.error();
      }
    })());
    return;
  }

  const isContent = url.pathname.includes("/content/");
  const isMutableShell =
    url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/views/session.js") ||
    url.pathname.endsWith("/views/quiz.js") ||
    url.pathname.endsWith("/core/constants.js") ||
    url.pathname.endsWith("/core/util.js") ||
    url.pathname.endsWith("/core/storage.js") ||
    url.pathname.endsWith("/core/review.js") ||
    url.pathname.endsWith("/core/quiz.js") ||
    url.pathname.endsWith("/core/learningPath.js") ||
    url.pathname.endsWith("/style.css") ||
    url.pathname.endsWith("/manifest.webmanifest");

  if (isContent || isMutableShell) {
    event.respondWith((async () => {
      const cache = await caches.open(isContent ? CONTENT_CACHE : SHELL_CACHE);
      try {
        const res = await fetch(req, { cache: "no-cache" });
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || (await caches.match(req)) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      return cached || Response.error();
    }
  })());
});

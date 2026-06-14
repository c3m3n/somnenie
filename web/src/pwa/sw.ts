/// <reference lib="webworker" />

const swSelf = self as unknown as ServiceWorkerGlobalScope;

declare const __NUTRIO_BUILD_HASH__: string;
declare const __NUTRIO_APP_SHELL_ASSETS__: string[];

const BUILD_HASH = String(__NUTRIO_BUILD_HASH__ || "dev");
const VERSION = `nutrio-react-v${BUILD_HASH}`;
const SHELL_CACHE = `${VERSION}-shell`;
const CONTENT_CACHE = `${VERSION}-content`;
const DEFAULT_MODULE_FILES = ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"];

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/sw.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/favicon-32.png",
  "/assets/generated/icon-today.png",
  "/screenshots/home-narrow.png",
  "/screenshots/progress-wide.png",
  "/fonts/IBMPlexSans-Regular.woff2",
  "/fonts/IBMPlexSans-Bold.woff2",
  "/fonts/IBMPlexMono-Regular.woff2",
  "/fonts/IBMPlexMono-Bold.woff2",
  ...(__NUTRIO_APP_SHELL_ASSETS__ || []),
];

swSelf.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(precacheShell());
});

swSelf.addEventListener("message", (event: ExtendableMessageEvent) => {
  const type = messageType(event.data);
  if (type === "SKIP_WAITING") void swSelf.skipWaiting();
  if (type === "CACHE_CONTENT") event.waitUntil(precacheContent());
  if (type === "GET_VERSION") event.source?.postMessage?.({ type: "SW_VERSION", version: VERSION });
});

swSelf.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(activateWorker());
});

swSelf.addEventListener("fetch", (event: FetchEvent) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== swSelf.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(navigationResponse(event));
    return;
  }
  event.respondWith(responseFor(event.request));
});

async function precacheShell(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  const manifestUrls = APP_SHELL.filter((url) => url);
  await cache.addAll(manifestUrls);
}

async function activateWorker(): Promise<void> {
  if (swSelf.registration.navigationPreload) {
    await swSelf.registration.navigationPreload.enable();
  }
  const keys = await caches.keys();
  const stale = keys.filter((key) => key.startsWith("nutrio-") && !key.startsWith(VERSION));
  await Promise.all(stale.map((key) => caches.delete(key)));
  await swSelf.clients.claim();
  await precacheContent().catch((error: unknown) => console.warn("Content precache failed", error));
}

async function responseFor(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/content/") || isMutableShell(url.pathname)) return networkFirst(request, CONTENT_CACHE);
  return cacheFirst(request);
}

// eslint-disable-next-line complexity
async function navigationResponse(event: FetchEvent): Promise<Response> {
  const request = event.request;
  const preloadUnknown = (await event.preloadResponse) as unknown;
  const preloaded = preloadUnknown && typeof preloadUnknown === "object"
    ? preloadUnknown as Response
    : undefined;
  if (preloaded) {
    if (preloaded.ok) return preloaded;
    if (preloaded.type === "opaqueredirect") return preloaded;
    return preloaded;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      await cache.put(request, response.clone());
      return response;
    }
  } catch {
    // no-op, fallback below
  }

  return (
    (await caches.match(request)) ||
    (await caches.match("/index.html")) ||
    (await caches.match("/")) ||
    new Response("Отключение интернета. Отобразить начальную страницу позже не удалось.", { status: 503 })
  );
}

async function networkFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
  }
  return new Response("Офлайн ресурс недоступен", { status: 503 });
}

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return new Response("Ресурс недоступен", { status: 503 });
  }
}

async function precacheContent(): Promise<void> {
  const cache = await caches.open(CONTENT_CACHE);
  await precacheContentIndexes(cache);
  const catalog = await fetchJson<{ courses?: { id?: string; manifest?: string }[] }>("/content/catalog.json");
  const courses = (catalog.courses || []).filter((course) => course.id && course.manifest);
  await Promise.all(courses.map((course) => precacheCourseContent(course.id!, cache)));
}

async function precacheCourseContent(courseId: string, cache: Cache): Promise<void> {
  const manifest = await fetchJson<{ modules?: { id?: string }[]; moduleFiles?: string[] }>(`/content/${courseId}/manifest.json`);
  const moduleFileList = Array.isArray(manifest.moduleFiles) && manifest.moduleFiles.length ? manifest.moduleFiles : DEFAULT_MODULE_FILES;
  const urls = (manifest.modules || [])
    .flatMap((module) => module.id ? moduleFileList.map((file) => `/content/${courseId}/${module.id}/${file}`) : [])
    .filter((url) => !!url);
  await runWithConcurrencyLimit(urls, 6, (url) => cache.add(url));
}

async function precacheContentIndexes(cache?: Cache): Promise<void> {
  const target = cache || await caches.open(CONTENT_CACHE);
  await Promise.allSettled(["/content/catalog.json"].map((url) => target.add(url)));
  const catalog = await fetchJson<{ courses?: { id?: string }[] }>("/content/catalog.json").catch(() => ({ courses: [] }));
  await Promise.allSettled((catalog.courses || [])
    .filter((course) => course.id)
    .flatMap((course) => [
      `/content/${course.id}/manifest.json`,
      `/content/${course.id}/course.json`,
      `/content/${course.id}/claims.json`,
    ])
    .map((url) => target.add(url).catch(() => undefined)));
}

async function runWithConcurrencyLimit(urls: string[], limit: number, loader: (url: string) => Promise<void>): Promise<void> {
  const queue = [...urls];
  const runners = Array.from({ length: Math.min(limit, urls.length) }, async () => {
    while (queue.length) {
      const url = queue.shift();
      if (!url) continue;
      try {
        await loader(url);
      } catch {
        // content can be absent in partial courses; continue prefetching
      }
    }
  });
  await Promise.all(runners);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return await response.json() as T;
}

function isMutableShell(pathname: string): boolean {
  return pathname === "/index.html" || pathname === "/manifest.webmanifest" || pathname === "/sw.js";
}

function messageType(data: unknown): string {
  return data && typeof data === "object" && "type" in data && typeof (data as { type?: unknown }).type === "string"
    ? String((data as { type: string }).type)
    : "";
}

/// <reference lib="webworker" />

const swSelf = self as unknown as ServiceWorkerGlobalScope;

const VERSION = "nutrio-react-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const CONTENT_CACHE = `${VERSION}-content`;
const MODULE_FILES = ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"];

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/favicon-32.png",
  "/assets/generated/icon-today.png",
  "/screenshots/home-narrow.png",
  "/screenshots/progress-wide.png",
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
  event.respondWith(responseFor(event.request));
});

async function precacheShell(): Promise<void> {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(APP_SHELL);
  await precacheContentIndexes();
}

async function activateWorker(): Promise<void> {
  await swSelf.registration.navigationPreload?.enable();
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith("nutrio-") && !key.startsWith(VERSION)).map((key) => caches.delete(key)));
  await swSelf.clients.claim();
  await precacheContent().catch((error: unknown) => console.warn("Content precache failed", error));
}

async function responseFor(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.mode === "navigate") return navigationResponse(request);
  if (url.pathname.startsWith("/content/") || isMutableShell(url.pathname)) return networkFirst(request, url.pathname.startsWith("/content/") ? CONTENT_CACHE : SHELL_CACHE);
  return cacheFirst(request);
}

async function navigationResponse(request: Request): Promise<Response> {
  try {
    return await fetch(request);
  } catch {
    return await caches.match("/index.html") || Response.error();
  }
}

async function networkFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: "no-cache" });
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return await cache.match(request) || Response.error();
  }
}

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await (await caches.open(SHELL_CACHE)).put(request, response.clone());
  return response;
}

async function precacheContent(): Promise<void> {
  const cache = await caches.open(CONTENT_CACHE);
  await precacheContentIndexes(cache);
  const manifest = await fetchJson<{ modules?: { id?: string }[]; moduleFiles?: string[] }>("/content/manifest.json");
  const files = Array.isArray(manifest.moduleFiles) && manifest.moduleFiles.length ? manifest.moduleFiles : MODULE_FILES;
  const urls = (manifest.modules || []).flatMap((module) => module.id ? files.map((file) => `/content/${module.id}/${file}`) : []);
  await Promise.allSettled(urls.map((url) => cache.add(url)));
}

async function precacheContentIndexes(cache?: Cache): Promise<void> {
  const target = cache || await caches.open(CONTENT_CACHE);
  await Promise.allSettled(["/content/manifest.json", "/content/course.json", "/content/claims.json"].map((url) => target.add(url)));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return await response.json() as T;
}

function isMutableShell(pathname: string): boolean {
  return pathname === "/index.html" || pathname === "/manifest.webmanifest" || pathname === "/sw.js";
}

function messageType(data: unknown): string {
  return data && typeof data === "object" && "type" in data && typeof data.type === "string" ? data.type : "";
}

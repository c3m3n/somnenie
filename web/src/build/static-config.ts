export const STATIC_ENTRIES = [
  "content",
  "icons",
  "fonts",
  "assets",
  "screenshots",
  "manifest.webmanifest",
] as const;

export const STATIC_PREFIXES = ["/content/", "/icons/", "/fonts/", "/assets/", "/screenshots/"] as const;
export const STATIC_EXACT = ["/manifest.webmanifest"] as const;

export const STATIC_CACHE_HEADERS = [
  { source: "/", cacheControl: "public, max-age=0, must-revalidate" },
  { source: "/index.html", cacheControl: "public, max-age=0, must-revalidate" },
  { source: "/content/(.*)", cacheControl: "public, max-age=0, must-revalidate" },
  { source: "/sw.js", cacheControl: "no-cache, no-store, must-revalidate", serviceWorkerAllowed: "/" },
  { source: "/manifest.webmanifest", cacheControl: "public, max-age=0, must-revalidate", contentType: "application/manifest+json; charset=utf-8" },
  { source: "/fonts/(.*)", cacheControl: "public, max-age=604800, stale-while-revalidate=86400" },
  { source: "/icons/(.*)", cacheControl: "public, max-age=604800, stale-while-revalidate=86400" },
  { source: "/assets/(.*)", cacheControl: "public, max-age=604800, stale-while-revalidate=86400" },
  { source: "/screenshots/(.*)", cacheControl: "public, max-age=604800, stale-while-revalidate=86400" },
] as const;

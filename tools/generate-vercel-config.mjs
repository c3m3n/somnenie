import { writeFile } from "node:fs/promises";
import path from "node:path";
import { loadStaticConfig } from "./load-static-config.mjs";

const { STATIC_CACHE_HEADERS } = await loadStaticConfig();

const securityHeaders = [
  { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains; preload" },
];

const config = {
  buildCommand: "npm run build",
  outputDirectory: "dist",
  headers: [
    { source: "/(.*)", headers: securityHeaders },
    ...STATIC_CACHE_HEADERS.map((item) => ({
      source: item.source,
      headers: [
        ...(item.contentType ? [{ key: "Content-Type", value: item.contentType }] : []),
        { key: "Cache-Control", value: item.cacheControl },
        ...(item.serviceWorkerAllowed ? [{ key: "Service-Worker-Allowed", value: item.serviceWorkerAllowed }] : []),
      ],
    })),
  ],
};

await writeFile(path.join(process.cwd(), "vercel.json"), `${JSON.stringify(config, null, 2)}\n`);
console.log("Generated vercel.json from web/src/build/static-config.ts");

# Runbook

## Local Start

```powershell
npm ci
npm run dev
```

Open the local Vite URL, normally `http://127.0.0.1:5173/`.

## Release Check

Run the full gate before publishing:

```powershell
npm run check
npm run e2e
npm audit --audit-level=moderate
```

Expected result:
- TypeScript passes.
- ESLint passes with zero warnings.
- Vitest and coverage pass with at least 80% lines, functions, branches and statements.
- Production build writes `dist/`.
- Content validation reports 24 modules and 240 questions unless the course contract intentionally changes.
- PWA and dist smoke checks pass.
- Browser E2E reaches the route, reader, checkpoint and profile screens without horizontal overflow.
- Dependency audit reports no moderate or higher vulnerabilities.

## Deploy

Vercel builds with:

```powershell
npm run build
```

It serves:

```text
dist
```

## Rollback

1. Revert or redeploy the previous known-good Vercel deployment.
2. If users report stale UI or stale course content, verify that `dist/sw.js` changed and that `/sw.js` is served with `no-cache, no-store, must-revalidate`.
3. If a content-only release misbehaves, compare `content/manifest.json`, `content/course.json`, `content/claims.json` and the changed `content/Mxx/*.md` files against the previous deployment.
4. Do not clear learner IndexedDB automatically. Storage migrations must preserve local progress unless a separate migration plan says otherwise.

## Incident Notes

For broken navigation, start with `web/src/ui/route.ts`, `web/src/app/RoutedApp.tsx` and `web/src/domain/learningPath.ts`.

For stale offline behavior, start with `web/src/pwa/sw.ts`, `tools/postbuild.mjs` and `vercel.json`.

For content errors, start with `tools/check-content.mjs` and the relevant `content/Mxx` folder.

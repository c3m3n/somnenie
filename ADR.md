# Architecture Decision Records

## ADR-001: React PWA with repo-managed course content

Status: Accepted

Context:
Somnenie is a personal learning PWA for a built-in nutrition course. The app must work without a backend, keep learner progress locally, and make course content easy to review in the repository.

Decision:
Use React, TypeScript and Vite for the application shell. Keep course materials in `content/` as versioned Markdown and JSON contracts. Store learner state in IndexedDB through `web/src/storage`, with conservative migration from legacy `localStorage`.

Alternatives:
- Server-backed course platform: deferred because the first release does not need authoring, accounts or shared progress.
- Static HTML with global JavaScript: replaced because typed domain modules, tests and PWA maintenance are easier in the current React/Vite structure.

Consequences:
- The app can be deployed as static files from `dist`.
- Content changes remain reviewable as normal repository diffs.
- Storage and PWA cache migrations need explicit tests and release checks.

## ADR-002: Quality gates follow measured frontend thresholds

Status: Accepted

Context:
The local research materials define practical frontend quality thresholds: cyclomatic complexity 10, cognitive complexity 15, nesting depth 4, function size around 20-30 lines, coverage above 80%, and E2E checks for critical flows.

Decision:
Use TypeScript, ESLint, Vitest coverage, content validation, PWA checks, dist smoke and browser E2E as the quality gate set. ESLint enforces complexity, cognitive complexity, nesting, callback depth, parameter count, statement count, hooks, accessibility and JSX depth. Coverage gates require at least 80% lines, functions, branches and statements on domain and storage code.

Alternatives:
- Rely only on code review: rejected because the research materials call for automated gates.
- Enforce every possible metric in CI immediately: deferred to avoid noisy tools that do not map cleanly to this small app.

Consequences:
- PR and release readiness can be checked with `npm run check`.
- Nightly or release E2E protects the critical learner route.
- Exceptions should be explicit and rare, preferably with a nearby comment explaining why.

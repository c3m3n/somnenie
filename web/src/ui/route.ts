import type { StationStepKey } from "../domain/types";

export type Route =
  | { screen: "today" }
  | { screen: "atlas" }
  | { screen: "memory" }
  | { screen: "journal" }
  | { screen: "station"; moduleId: string; step: StationStepKey }
  | { screen: "remediation"; moduleId: string };

const STEP_KEYS = new Set(["understand", "apply", "check", "anchor"]);

export function parseRoute(hash = window.location.hash): Route {
  const clean = hash.replace(/^#\/?/, "");
  const [screen, moduleId, step] = clean.split("/");
  if (screen === "atlas") return { screen: "atlas" };
  if (screen === "memory") return { screen: "memory" };
  if (screen === "journal" || screen === "profile") return { screen: "journal" };
  if (screen === "remediation" && moduleId) return { screen: "remediation", moduleId };
  if (screen === "block" && moduleId) return { screen: "station", moduleId, step: "check" };
  if (screen === "station" && moduleId) return { screen: "station", moduleId, step: normalizeStep(step) };
  return { screen: "today" };
}

export function routeHash(route: Route): string {
  if (route.screen === "today") return "#today";
  if (route.screen === "station") return `#station/${route.moduleId}/${route.step}`;
  if (route.screen === "remediation") return `#remediation/${route.moduleId}`;
  return `#${route.screen}`;
}

export function navigate(route: Route): void {
  window.location.hash = routeHash(route);
}

function normalizeStep(value?: string): StationStepKey {
  return STEP_KEYS.has(String(value)) ? value as StationStepKey : "understand";
}

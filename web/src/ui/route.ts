import { COURSE_ID, type CourseId } from "../domain/types";
import type { StationStepKey } from "../domain/types";

export type Route =
  | { screen: "today"; courseId: CourseId }
  | { screen: "atlas"; courseId: CourseId }
  | { screen: "memory"; courseId: CourseId }
  | { screen: "journal"; courseId: CourseId }
  | { screen: "station"; courseId: CourseId; moduleId: string; step: StationStepKey }
  | { screen: "remediation"; courseId: CourseId; moduleId: string }
  | { screen: "courses" };

const STEP_KEYS = new Set(["understand", "apply", "check", "anchor"]);

// eslint-disable-next-line complexity
export function parseRoute(hash = window.location.hash): Route {
  const clean = hash.replace(/^#\/?/, "");
  const segments = clean.split("/").filter(Boolean);
  const [maybeCourseId, screen, moduleId, step] = segments;

  if (!maybeCourseId || !screen) {
    return { screen: "courses" };
  }

  if (screen === "courses") return { screen: "courses" };
  const courseId = maybeCourseId;

  if (screen === "atlas") return { screen: "atlas", courseId };
  if (screen === "memory") return { screen: "memory", courseId };
  if (screen === "journal" || screen === "profile") return { screen: "journal", courseId };
  if (screen === "remediation" && moduleId) return { screen: "remediation", courseId, moduleId };
  if (screen === "block" && moduleId) return { screen: "station", courseId, moduleId, step: "check" };
  if (screen === "station" && moduleId) return { screen: "station", courseId, moduleId, step: normalizeStep(step) };
  return { screen: "today", courseId };
}

export function routeHash(route: Route): string {
  if (route.screen === "courses") return "#courses";
  if (route.screen === "today") return `#/${route.courseId}/today`;
  if (route.screen === "station") return `#/${route.courseId}/station/${route.moduleId}/${route.step}`;
  if (route.screen === "remediation") return `#/${route.courseId}/remediation/${route.moduleId}`;
  return `#/${route.courseId}/${route.screen}`;
}

export function navigate(route: Route): void {
  window.location.hash = routeHash(route);
}

export function defaultCourseId(): CourseId {
  return COURSE_ID;
}

function normalizeStep(value?: string): StationStepKey {
  return STEP_KEYS.has(String(value)) ? value as StationStepKey : "understand";
}

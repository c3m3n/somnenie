import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppServicesProvider, type AppServices } from "../shared/services/AppServicesContext";
import { useAppData } from "./useAppData";
import type { CourseBundle } from "../domain/types";

describe("useAppData services", () => {
  it("loads through AppServicesContext", async () => {
    render(<AppServicesProvider services={fakeServices()}><Probe /></AppServicesProvider>);
    await waitFor(() => expect(screen.getByText("loaded")).toBeInTheDocument());
  });
});

function Probe() {
  const data = useAppData();
  return <div>{data.loading ? "loading" : data.bundle ? "loaded" : data.error}</div>;
}

function fakeServices(): AppServices {
  return {
    content: {
      loadCatalog: vi.fn(async () => catalog()),
      loadCourseBundle: vi.fn(async () => bundle()),
      ensureModuleFiles: vi.fn(async () => null),
      moduleById: vi.fn(() => null),
      clearCaches: vi.fn(),
    },
    navigation: {
      navigate: vi.fn(),
      parseRoute: vi.fn(() => ({ screen: "today" as const, courseId: "nutrition" as const })),
      routeHash: vi.fn(() => "#/nutrition/today"),
    },
    storage: {
      initStorage: vi.fn(async () => undefined),
      migrateFromLocalStorage: vi.fn(async () => ({ migrated: false })),
      getProfile: vi.fn(async () => null),
      getAllProgress: vi.fn(async () => ({})),
      getAppState: vi.fn(async () => ({ schemaVersion: 3, activeCourseId: "nutrition", courses: { nutrition: { review: { schemaVersion: 2, courseId: "nutrition", items: [] }, sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } } } })),
      saveProfile: vi.fn(async () => undefined),
      saveModuleProgress: vi.fn(async () => ({})),
      saveAppState: vi.fn(async () => ({ schemaVersion: 3, activeCourseId: "nutrition", courses: { nutrition: { review: { schemaVersion: 2, courseId: "nutrition", items: [] }, sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } } } })),
      getCourseAppState: vi.fn(async () => ({ review: { schemaVersion: 2, courseId: "nutrition", items: [] }, sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } })),
      saveCourseAppState: vi.fn(async () => ({ review: { schemaVersion: 2, courseId: "nutrition", items: [] }, sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } })),
      resetProgress: vi.fn(async () => undefined),
      exportData: vi.fn(async () => ({ schemaVersion: 3, exportedAt: "", courseId: "nutrition", profile: null, progress: {}, review: { schemaVersion: 2, courseId: "nutrition", items: [] }, sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } })),
    },
  };
}

function catalog() {
  return { schemaVersion: 1, courses: [{ id: "nutrition", title: "Nutrition", manifest: "content/nutrition/manifest.json" }] };
}

function bundle(): CourseBundle {
  return { courseId: "nutrition", manifest: { schemaVersion: 1, contentVersion: "test", courseId: "nutrition", course: "", claims: "", moduleFiles: ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"], modules: [] }, course: { title: "Course", phases: [] }, claims: { schemaVersion: 1, reviewedAt: "", sources: [], claims: [] }, modules: [] };
}

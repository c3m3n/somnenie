import { describe, expect, it } from "vitest";
import { appStateWithDefaults, migrateAppState, migrateModuleProgress, migrateProgress } from "./migrations";

describe("migrations", () => {
  it("ignores non-record course states during multi-course migration", () => {
    const state = migrateAppState({
      activeCourseId: "nutrition",
      courses: {
        nutrition: { review: { items: [] }, sessions: { todayDone: {} } },
        informatics: null,
        other: "bad",
      },
    });
    expect(state.courses.nutrition).toBeDefined();
    expect(state.courses.informatics).toBeUndefined();
    expect(state.courses.other).toBeUndefined();
  });

  it("returns empty progress for non-record values", () => {
    expect(migrateProgress(null)).toEqual({});
    expect(migrateProgress("bad")).toEqual({});
  });

  it("fills default app state when default course is missing", () => {
    const state = appStateWithDefaults({
      activeCourseId: "informatics",
      courses: {
        informatics: { review: { items: [] }, sessions: { todayDone: {} } },
      },
    });
    expect(state.sessions.courseId).toBe("nutrition");
    expect(state.review.items).toEqual([]);
  });

  it("uses question key as fallback only for numeric keys", () => {
    const progress = migrateModuleProgress({
      weakSpots: {
        abc: { text: "No number" },
        "5": { text: "From key" },
      },
    });
    expect(progress.weakSpots?.abc.questionNumber).toBeUndefined();
    expect(progress.weakSpots?.["5"].questionNumber).toBe(5);
  });
});

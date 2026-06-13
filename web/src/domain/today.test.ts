import { describe, expect, it } from "vitest";
import { buildTodayAction, completedCount } from "./today";
import { defaultReviewState, normalizeReviewState } from "./review";
import { type AppState, type CourseModule, type ProgressMap } from "./types";

const modules = ["M01", "M02"].map((id) => ({ id, title: id, phaseId: "p", phaseTitle: "P", files: {} })) as CourseModule[];

describe("today priority", () => {
  it("prioritizes due memory over new material", () => {
    const appState = stateWithReview("2026-06-13");
    const action = buildTodayAction(modules, {}, appState, new Date("2026-06-13"));
    expect(action.kind).toBe("review");
  });

  it("continues station and then falls back to journal after completion", () => {
    const action = buildTodayAction(modules, {}, emptyState());
    expect(action).toMatchObject({ kind: "station", moduleId: "M01" });
    expect(buildTodayAction(modules, completeProgress(), emptyState()).kind).toBe("journal");
    expect(completedCount(modules, completeProgress())).toBe(2);
  });
});

function emptyState(): AppState {
  return { schemaVersion: 2, review: defaultReviewState(), sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } };
}

function stateWithReview(due: string): AppState {
  return { ...emptyState(), review: normalizeReviewState({ items: [{ id: "M01-q1", moduleId: "M01", text: "A", due, errors: 1, interval: 1 }] }) };
}

function completeProgress(): ProgressMap {
  return { M01: { theoryRead: true, takeaway: "A", quizAttemptStatus: "complete" }, M02: { theoryRead: true, takeaway: "B", quizAttemptStatus: "complete" } };
}

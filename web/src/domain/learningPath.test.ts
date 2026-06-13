import { describe, expect, it } from "vitest";
import { defaultReviewState, normalizeReviewState } from "./review";
import {
  canOpenBlock,
  getBlockAccess,
  getBlockAccessReason,
  getCourseBlockViewModels,
  getNextLearningAction,
  getNextBlock,
  getPreviousBlock,
} from "./learningPath";
import type { AppState, CourseModule, ModuleProgress } from "./types";

const modules = ["M01", "M02", "M03"].map((id) => moduleFixture(id));

describe("block checkpoint access", () => {
  it("opens only the first block for a new user", () => {
    expect(canOpenBlock("M01", modules, {})).toBe(true);
    expect(canOpenBlock("M02", modules, {})).toBe(false);
    expect(getBlockAccessReason("M02", modules, {})).toBe("previous_checkpoint_required");
  });

  it("keeps M02 locked while M01 is in progress", () => {
    const progress = { M01: { takeawayDraft: "notes" } };
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({ canOpen: false, reason: "previous_checkpoint_required" });
  });

  it("keeps M02 locked when M01 checkpoint is ready but not passed", () => {
    const progress = { M01: { theoryRead: true } };
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({ canOpen: false, reason: "previous_checkpoint_required" });
  });

  it("keeps M02 locked with failed reason after M01 checkpoint fails", () => {
    const progress = { M01: failed() };
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({ canOpen: false, reason: "previous_checkpoint_failed", requiredBlockId: "M01" });
  });

  it("opens M02 after M01 checkpoint passes", () => {
    const progress = { M01: passed() };
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({ canOpen: true, state: "available" });
  });

  it("locks M03 when M01 passed and M02 failed", () => {
    const progress = { M01: passed(), M02: failed() };
    expect(getBlockAccess("M03", modules, progress)).toMatchObject({ canOpen: false, reason: "previous_checkpoint_failed", requiredBlockId: "M02" });
  });

  it("exposes sequential neighbors", () => {
    expect(getPreviousBlock("M02", modules)?.id).toBe("M01");
    expect(getNextBlock("M02", modules)?.id).toBe("M03");
  });

  it("builds course map view models from access state", () => {
    const viewModels = getCourseBlockViewModels(modules, { M01: passed(), M02: failed() });
    expect(viewModels.map((item) => item.state)).toEqual(["checkpoint_passed", "checkpoint_failed", "locked"]);
    expect(viewModels[2]).toMatchObject({ progressLabel: "Откроется после контрольной M02", canOpen: false });
  });

  it("returns course_complete after all checkpoints pass", () => {
    const progress = { M01: passed(), M02: passed(), M03: passed() };
    expect(getNextLearningAction(modules, progress, emptyState()).type).toBe("course_complete");
  });

  it("prioritizes failed checkpoint over due review", () => {
    const progress = { M01: failed() };
    const action = getNextLearningAction(modules, progress, stateWithReview("2026-06-13"), new Date("2026-06-13"));
    expect(action).toMatchObject({ type: "fix_failed_checkpoint", blockId: "M01" });
  });
});

function moduleFixture(id: string): CourseModule {
  return { id, title: id, phaseId: "phase", phaseTitle: "Phase", files: { "theory.md": "", "terms.md": "", "practice.md": "", "diagrams.md": "", "summary.md": "", "quiz.md": "" } };
}

function passed(): ModuleProgress {
  return result(7, 10);
}

function failed(): ModuleProgress {
  return result(6, 10);
}

function result(best: number, total: number): ModuleProgress {
  return { quizAttemptStatus: "complete", quizCompletedAt: "2026-06-13T00:00:00.000Z", quizBest: best, quizTotal: total };
}

function emptyState(): AppState {
  return { schemaVersion: 2, review: defaultReviewState(), sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } };
}

function stateWithReview(due: string): AppState {
  return { ...emptyState(), review: normalizeReviewState({ items: [{ id: "M01-q1", moduleId: "M01", text: "A", due, errors: 1, interval: 1 }] }) };
}

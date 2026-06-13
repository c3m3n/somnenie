import { describe, expect, it } from "vitest";
import { defaultReviewState, normalizeReviewState } from "./review";
import {
  canOpenBlock,
  canRetakeCheckpoint,
  getBlockAccess,
  getBlockAccessReason,
  getCheckpointOutcome,
  getCheckpointStatus,
  getCourseBlockViewModels,
  getNextLearningAction,
  getRemediationPlan,
  getBlockingCheckpoint,
} from "./learningPath";
import type { AppState, CourseModule, ModuleProgress, ReviewState } from "./types";

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

  it("returns failed checkpoint outcome and failed action", () => {
    const progress = { M01: failedLegacy(), M02: {} };
    expect(getCheckpointStatus("M01", progress)).toBe("failed");
    expect(getBlockingCheckpoint(modules, progress)?.id).toBe("M01");
    expect(getNextLearningAction(modules, progress, emptyState()).type).toBe("fix_failed_checkpoint");
  });

  it("keeps M02 locked with failed reason after M01 checkpoint fails", () => {
    const progress = { M01: failedLegacy(), M02: {} };
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({ canOpen: false, reason: "previous_checkpoint_failed", requiredBlockId: "M01" });
  });

  it("keeps blocked module locked while latest checkpoint attempt failed", () => {
    const failedThenPassed = {
      M01: {
        ...legacyCheckpoint({
          checkpointStatus: "passed",
          checkpointAttempts: [
            { ...failedAttempt("M01", "2026-01-01T00:00:00.000Z"), correct: 0, total: 5, passed: false, failedQuestionIds: ["1"] },
            { ...failedAttempt("M01", "2026-01-02T00:00:00.000Z"), correct: 2, total: 5, passed: false, failedQuestionIds: ["2"] },
          ],
        }),
      },
    };
    expect(canRetakeCheckpoint("M01", failedThenPassed)).toBe(true);
    expect(getBlockAccess("M02", modules, failedThenPassed)).toMatchObject({ canOpen: false });
  });

  it("unlocks next module only when latest failed checkpoint attempt becomes passed", () => {
    const failedThenPassed = {
      M01: {
        ...legacyCheckpoint({
          checkpointStatus: "failed",
          checkpointAttempts: [
            { ...failedAttempt("M01", "2026-01-01T00:00:00.000Z"), correct: 2, total: 5, passed: false, failedQuestionIds: ["1"] },
            { ...failedAttempt("M01", "2026-01-02T00:00:00.000Z"), correct: 5, total: 5, passed: true, failedQuestionIds: [] },
          ],
        }),
      },
    };
    expect(getCheckpointStatus("M01", failedThenPassed)).toBe("passed");
    expect(canRetakeCheckpoint("M01", failedThenPassed)).toBe(false);
    expect(getBlockAccess("M02", modules, failedThenPassed)).toMatchObject({ canOpen: true });
  });

  it("keeps latest checkpoint attempt as source of truth even with stale legacy status", () => {
    const progress = {
      M01: {
        ...legacyCheckpoint({
          checkpointStatus: "passed",
          checkpointAttempts: [
            { ...failedAttempt("M01", "2026-01-01T00:00:00.000Z"), correct: 4, total: 5, passed: false, failedQuestionIds: ["1"] },
          ],
        }),
      },
    };
    expect(getCheckpointStatus("M01", progress)).toBe("failed");
    expect(getRemediationPlan("M01", progress)?.canRetake).toBe(true);
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({ canOpen: false, reason: "previous_checkpoint_failed" });
  });

  it("uses latest passed attempt even if checkpointStatus says failed", () => {
    const progress = {
      M01: {
        ...legacyCheckpoint({
          checkpointStatus: "failed",
          checkpointAttempts: [
            { ...baseAttempt("M01"), correct: 5, total: 5, passed: true, completedAt: "2026-01-02T00:00:00.000Z", failedQuestionIds: [] },
          ],
        }),
      },
    };
    expect(getCheckpointStatus("M01", progress)).toBe("passed");
    expect(getRemediationPlan("M01", progress)).toBeNull();
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({ canOpen: true, reason: null });
  });

  it("passes with stable legacy score when quizTotal is >0", () => {
    const passed = progressResult(7, 10);
    const failed = progressResult(6, 10);
    expect(getCheckpointStatus("M01", { M01: passed })).toBe("passed");
    expect(getCheckpointStatus("M01", { M01: failed })).toBe("failed");
  });

  it("does not block on quizTotal === 0", () => {
    const progress = { M01: progressResult(0, 0) };
    const outcome = getCheckpointOutcome("M01", progress);
    expect(outcome.status).not.toBe("failed");
    expect(outcome.isBlocking).toBe(false);
    expect(outcome.score.ratio).toBeNull();
  });

  it("locks next module after legacy failed checkpoint derived from quiz score", () => {
    const legacyFailed = { M01: progressResult(1, 10) };
    expect(getCheckpointStatus("M01", legacyFailed)).toBe("failed");
    expect(canOpenBlock("M02", modules, legacyFailed)).toBe(false);
  });

  it("does not block next block when failed answers are preserved but passed", () => {
    const progress = {
      M01: {
        ...progressResult(7, 10),
        weakSpots: {
          "1": { text: "Неправильный выбор", questionText: "Что важнее", questionNumber: 1, shortExplanation: "Ключевая идея", sourceBlock: "theory", sourceLesson: "M01", sourceFragment: "check" },
          "3": { text: "Определение", questionText: "Что такое ..." , questionNumber: 3, shortExplanation: "Нужно повторить", sourceBlock: "terms", sourceLesson: "M01", sourceFragment: "check" },
        },
      },
    };
    expect(canOpenBlock("M02", modules, progress)).toBe(true);
    expect(progress.M01.weakSpots).toBeDefined();
  });

  it("builds course map view models from access state", () => {
    const viewModels = getCourseBlockViewModels(modules, { M01: progressResult(7, 10), M02: progressResult(6, 10) });
    expect(viewModels.map((item) => item.state)).toEqual(["checkpoint_passed", "checkpoint_failed", "locked"]);
    expect(viewModels[2]).toMatchObject({ progressLabel: "Блок закрыт из-за блока M02", canOpen: false });
  });

  it("returns course_complete after all checkpoints pass", () => {
    const progress = { M01: progressResult(7, 10), M02: progressResult(8, 10), M03: progressResult(10, 10) };
    expect(getNextLearningAction(modules, progress, emptyState()).type).toBe("course_complete");
  });

  it("prioritizes failed checkpoint over due review", () => {
    const progress = { M01: failedLegacy() };
    const action = getNextLearningAction(modules, progress, stateWithReview("2026-06-13"), new Date("2026-06-13"));
    expect(action).toMatchObject({ type: "fix_failed_checkpoint", blockId: "M01" });
  });

  it("remediation plan contains review actions for failed block", () => {
    const progress = {
      M01: {
        ...failedLegacy(),
        weakSpots: {
          "1": {
            text: "A",
            questionNumber: 1,
            questionText: "sample question",
            shortExplanation: "sample explanation",
            sourceBlock: "theory",
          },
        },
      },
    };
    const plan = getRemediationPlan("M01", progress, reviewState("2026-06-13"));
    expect(plan).not.toBeNull();
    expect(plan?.actions).toContain("review_failed_questions");
    expect(plan?.canRetake).toBe(true);
  });

});

function moduleFixture(id: string): CourseModule {
  return { id, title: id, phaseId: "phase", phaseTitle: "Phase", files: { "theory.md": "", "terms.md": "", "practice.md": "", "diagrams.md": "", "summary.md": "", "quiz.md": "" } };
}

function progressResult(best: number, total: number): ModuleProgress {
  return { quizAttemptStatus: "complete", quizCompletedAt: "2026-06-13T00:00:00.000Z", quizBest: best, quizTotal: total };
}

function failedLegacy(): ModuleProgress {
  return { quizAttemptStatus: "complete", quizCompletedAt: "2026-06-13T00:00:00.000Z", quizBest: 6, quizTotal: 10 };
}

function legacyCheckpoint(override: Partial<ModuleProgress>): ModuleProgress {
  return { quizAttemptStatus: "complete", quizCompletedAt: "2026-06-13T00:00:00.000Z", quizBest: 6, quizTotal: 10, ...override };
}

function baseAttempt(blockId: string, startedAt = "2026-01-01T00:00:00.000Z") {
  return { blockId, startedAt, completedAt: startedAt, correct: 0, total: 0, passed: false, failedQuestionIds: [] };
}

function emptyState(): AppState {
  return { schemaVersion: 2, review: defaultReviewState(), sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } };
}

function reviewState(due: string): ReviewState {
  return normalizeReviewState({ items: [{ id: "M01-q1", moduleId: "M01", text: "Q", due, errors: 1, interval: 1 }] });
}

function stateWithReview(due: string): AppState {
  return { ...emptyState(), review: reviewState(due) };
}

function failedAttempt(blockId: string, startedAt: string): ReturnType<typeof baseAttempt> {
  return { ...baseAttempt(blockId, startedAt) };
}

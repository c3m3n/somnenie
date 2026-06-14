import { describe, expect, it, vi } from "vitest";
import {
  nextQuizProgress,
  nextWeakSpotState,
  removeWeakSpot,
  retryQuiz,
  type AnswerContext,
} from "./StationImplementation";
import type { AppState, CourseModule, ModuleProgress, QuizQuestion } from "../../domain/types";

const baseModule: CourseModule = {
  id: "M01",
  title: "Введение",
  phaseId: "phase1",
  phaseTitle: "Основы",
  files: {
    "theory.md": "",
    "terms.md": "",
    "quiz.md": "",
    "practice.md": "",
    "diagrams.md": "",
    "summary.md": "",
  },
};

const baseAppState: AppState = {
  schemaVersion: 2,
  review: { schemaVersion: 2, courseId: "nutrition", items: [] },
  sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 },
};

function buildContext(overrides: {
  progress?: ModuleProgress;
  question?: Partial<QuizQuestion>;
  isLast?: boolean;
  autoTotal?: number;
} = {}): AnswerContext {
  const progress = overrides.progress ?? {};
  const question: QuizQuestion = {
    number: 1,
    type: "mcq",
    kind: "auto",
    text: "Question",
    options: [
      { key: "A", text: "Alpha" },
      { key: "B", text: "Beta" },
    ],
    answer: "A",
    explain: "Because A",
    sourceBlock: "theory",
    ...overrides.question,
  };
  return {
    module: baseModule,
    question,
    progress,
    isLast: overrides.isLast ?? false,
    autoTotal: overrides.autoTotal ?? 2,
    appState: baseAppState,
    saveProgress: vi.fn(),
    saveState: vi.fn(),
  };
}

describe("nextQuizProgress", () => {
  it("preserves quizBest when current run is worse", () => {
    const context = buildContext({ progress: { quizBest: 3, quizTotal: 5 } });
    const result = nextQuizProgress(context, false, "2024-01-01T00:00:00.000Z", "B");
    expect(result.quizBest).toBe(3);
  });

  it("updates quizBest when current run is better", () => {
    const context = buildContext({ progress: { quizBest: 1, quizCorrect: 1, quizTotal: 5 } });
    const result = nextQuizProgress(context, true, "2024-01-01T00:00:00.000Z", "A");
    expect(result.quizBest).toBe(2);
  });

  it("records quizStartedAt on first answer", () => {
    const now = "2024-01-01T00:00:00.000Z";
    const context = buildContext({ progress: { quizAnswered: 0 } });
    const result = nextQuizProgress(context, true, now, "A");
    expect(result.quizStartedAt).toBe(now);
  });

  it("uses existing quizStartedAt for subsequent answers", () => {
    const startedAt = "2024-01-01T00:00:00.000Z";
    const later = "2024-01-01T00:01:00.000Z";
    const context = buildContext({ progress: { quizAnswered: 1, quizStartedAt: startedAt } });
    const result = nextQuizProgress(context, true, later, "A");
    expect(result.quizStartedAt).toBe(startedAt);
  });

  it("uses quizStartedAt as checkpoint attempt startedAt", () => {
    const startedAt = "2024-01-01T00:00:00.000Z";
    const completedAt = "2024-01-01T00:01:00.000Z";
    const context = buildContext({ progress: { quizAnswered: 1, quizStartedAt: startedAt }, isLast: true, autoTotal: 2 });
    const result = nextQuizProgress(context, true, completedAt, "A");
    expect(result.checkpointAttempts).toHaveLength(1);
    expect(result.checkpointAttempts![0].startedAt).toBe(startedAt);
    expect(result.checkpointAttempts![0].completedAt).toBe(completedAt);
  });
});

describe("retryQuiz", () => {
  it("does not reset quizBest", async () => {
    const saveProgress = vi.fn();
    await retryQuiz("M01", saveProgress);
    const patch = saveProgress.mock.calls[0][1] as ModuleProgress;
    expect(patch.quizBest).toBeUndefined();
  });

  it("clears quizStartedAt and quizCompletedAt", async () => {
    const saveProgress = vi.fn();
    await retryQuiz("M01", saveProgress);
    const patch = saveProgress.mock.calls[0][1] as ModuleProgress;
    expect(patch.quizStartedAt).toBeUndefined();
    expect(patch.quizCompletedAt).toBeUndefined();
  });
});

describe("removeWeakSpot / nextWeakSpotState", () => {
  it("removes weak spot when answer is correct", () => {
    const weakSpots: ModuleProgress["weakSpots"] = {
      1: { text: "q1", misses: 1 },
      2: { text: "q2", misses: 2 },
    };
    const context = buildContext({ progress: { weakSpots } });
    const result = nextWeakSpotState(context, true, "A");
    expect(result).toEqual({ 2: { text: "q2", misses: 2 } });
  });

  it("adds weak spot when answer is wrong", () => {
    const context = buildContext({ progress: {} });
    const result = nextWeakSpotState(context, false, "B");
    expect(result?.[1]).toBeDefined();
    expect(result?.[1].misses).toBe(1);
  });

  it("returns undefined when removing from empty weak spots", () => {
    expect(removeWeakSpot(undefined, 1)).toBeUndefined();
  });
});

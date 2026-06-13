import {
  completedCount,
  getNextLearningAction,
  isCheckpointPassed,
  type LearningAction,
} from "./learningPath";
import type { AppState, CourseModule, ProgressMap, TodayAction } from "./types";

export { completedCount };

export function nextModule(modules: CourseModule[], progress: ProgressMap): CourseModule | null {
  return modules.find((module) => !isModuleComplete(progress[module.id])) || null;
}

export function isModuleComplete(progress?: ProgressMap[string]): boolean {
  return isCheckpointPassed(progress);
}

export function quizScoreLabel(progress?: ProgressMap[string]): string {
  if (!progress?.quizTotal) return "нет результата";
  return `${progress.quizBest ?? 0}/${progress.quizTotal}`;
}

export function buildTodayAction(modules: CourseModule[], progress: ProgressMap, appState: AppState, now = new Date()): TodayAction {
  return toTodayAction(getNextLearningAction(modules, progress, appState, now));
}

function toTodayAction(action: LearningAction): TodayAction {
  if (action.type === "review") return { kind: "review", label: action.label, reason: action.reason, reviewItems: action.reviewItems };
  if (action.type === "course_complete") return { kind: "journal", label: action.label, reason: action.reason };
  return { kind: "station", label: action.label, reason: action.reason, moduleId: action.blockId, step: action.step };
}

import { completedCount, getNextLearningAction, type LearningAction } from "./learningPath";
import type { AppState, CourseModule, ProgressMap, TodayAction } from "./types";
import { quizScoreLabel } from "../shared/utils/quizScoreLabel";

export { completedCount, quizScoreLabel };

export function buildTodayAction(modules: CourseModule[], progress: ProgressMap, appState: AppState, now = new Date()): TodayAction {
  return toTodayAction(getNextLearningAction(modules, progress, appState, now));
}

function toTodayAction(action: LearningAction): TodayAction {
  if (action.type === "review") return { kind: "review", label: action.label, reason: action.reason, reviewItems: action.reviewItems };
  if (action.type === "fix_failed_checkpoint") return { kind: "remediation", label: action.label, reason: action.reason, moduleId: action.blockId, step: action.step };
  if (action.type === "course_complete") return { kind: "journal", label: action.label, reason: action.reason };
  return { kind: "station", label: action.label, reason: action.reason, moduleId: action.blockId, step: action.step };
}

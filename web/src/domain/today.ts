import { dueReviewItems } from "./review";
import type { AppState, CourseModule, ProgressMap, ReviewItem, TodayAction } from "./types";

export function nextModule(modules: CourseModule[], progress: ProgressMap): CourseModule | null {
  return modules.find((module) => !isModuleComplete(progress[module.id])) || null;
}

export function isModuleComplete(progress?: ProgressMap[string]): boolean {
  return Boolean(progress?.theoryRead && progress.takeaway && progress.quizAttemptStatus === "complete");
}

export function completedCount(modules: CourseModule[], progress: ProgressMap): number {
  return modules.filter((module) => isModuleComplete(progress[module.id])).length;
}

export function quizScoreLabel(progress?: ProgressMap[string]): string {
  if (!progress?.quizTotal) return "нет результата";
  return `${progress.quizBest ?? 0}/${progress.quizTotal}`;
}

export function buildTodayAction(modules: CourseModule[], progress: ProgressMap, appState: AppState, now = new Date()): TodayAction {
  const due = dueReviewItems(appState.review, now, 5);
  if (due.length) return reviewAction(due);
  const module = nextModule(modules, progress);
  if (module) return stationAction(module.id, progress[module.id]);
  return { kind: "journal", label: "Открыть журнал", reason: "Курс пройден. Сейчас полезнее перечитать свои выводы." };
}

function reviewAction(items: ReviewItem[]): TodayAction {
  return { kind: "review", label: "Начать повторение", reason: `${items.length} ${pluralize(items.length, "сигнал", "сигнала", "сигналов")} памяти готовы к короткой сессии.`, reviewItems: items };
}

function stationAction(moduleId: string, progress?: ProgressMap[string]): TodayAction {
  const label = progress?.theoryRead ? "Продолжить станцию" : "Начать";
  return { kind: "station", label, reason: "Следующий лучший шаг - одна короткая учебная станция.", moduleId };
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

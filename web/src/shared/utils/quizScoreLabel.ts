import type { ProgressMap } from "../../domain/types";

export function quizScoreLabel(progress?: ProgressMap[string]): string {
  if (!progress?.quizTotal) return "нет результата";
  return `${progress.quizBest ?? 0}/${progress.quizTotal}`;
}

import { dueReviewItems } from "./review";
import type { AppState, CourseModule, ModuleProgress, ProgressMap, ReviewItem, StationStepKey } from "./types";

const PASS_RATIO = 0.7;

export type BlockState = "locked" | "available" | "in_progress" | "checkpoint_ready" | "checkpoint_failed" | "checkpoint_passed" | "course_complete";
export type BlockAccessReason = "previous_checkpoint_failed" | "previous_checkpoint_required";

export interface BlockAccess {
  blockId: string;
  state: BlockState;
  canOpen: boolean;
  reason: BlockAccessReason | null;
  requiredBlockId: string | null;
}

export interface CourseBlockViewModel {
  id: string;
  title: string;
  state: BlockState;
  progressLabel: string;
  canOpen: boolean;
  reason: BlockAccessReason | null;
  requiredBlockId: string | null;
}

export type LearningActionType = "fix_failed_checkpoint" | "review" | "take_checkpoint" | "continue_block" | "start_block" | "course_complete";

export interface LearningAction {
  type: LearningActionType;
  label: string;
  reason: string;
  blockId?: string;
  step?: StationStepKey;
  reviewItems?: ReviewItem[];
}

export function getPreviousBlock(blockId: string, course: CourseModule[]): CourseModule | null {
  const index = blockIndex(blockId, course);
  return index > 0 ? course[index - 1] : null;
}

export function getBlockAccess(blockId: string, course: CourseModule[], progress: ProgressMap): BlockAccess {
  const currentState = getBlockState(progress[blockId]);
  const previous = getPreviousBlock(blockId, course);
  if (!previous || isCheckpointPassed(progress[previous.id])) return openAccess(blockId, currentState);
  return lockedAccess(blockId, previous.id, progress[previous.id]);
}

export function canOpenBlock(blockId: string, course: CourseModule[], progress: ProgressMap): boolean {
  return getBlockAccess(blockId, course, progress).canOpen;
}

export function getBlockAccessReason(blockId: string, course: CourseModule[], progress: ProgressMap): BlockAccessReason | null {
  return getBlockAccess(blockId, course, progress).reason;
}

export function getCourseBlockViewModels(course: CourseModule[], progress: ProgressMap): CourseBlockViewModel[] {
  return course.map((block) => blockViewModel(block, getBlockAccess(block.id, course, progress)));
}

export function getBlockState(progress?: ModuleProgress): BlockState {
  if (isCheckpointPassed(progress)) return "checkpoint_passed";
  if (isCheckpointFailed(progress)) return "checkpoint_failed";
  if (isCheckpointReady(progress)) return "checkpoint_ready";
  if (isBlockStarted(progress)) return "in_progress";
  return "available";
}

export function isCheckpointPassed(progress?: ModuleProgress): boolean {
  if (!hasCheckpointResult(progress) || !progress?.quizTotal) return false;
  return (progress.quizBest || 0) / progress.quizTotal >= PASS_RATIO;
}

export function isCheckpointFailed(progress?: ModuleProgress): boolean {
  return hasCheckpointResult(progress) && !isCheckpointPassed(progress);
}

export function completedCount(course: CourseModule[], progress: ProgressMap): number {
  return course.filter((block) => isCheckpointPassed(progress[block.id])).length;
}

export function getNextLearningAction(course: CourseModule[], progress: ProgressMap, appState: AppState, now = new Date()): LearningAction {
  const failed = firstOpenBlockWithState(course, progress, "checkpoint_failed");
  if (failed) return blockAction({ type: "fix_failed_checkpoint", blockId: failed.id, label: "Разобрать ошибки", reason: "Контрольная блока не сдана. Дальше пока закрыто.", step: "check" });

  const due = dueReviewItems(appState.review, now, 5);
  if (due.length) return reviewAction(due);

  const checkpoint = firstOpenBlockWithState(course, progress, "checkpoint_ready");
  if (checkpoint) return blockAction({ type: "take_checkpoint", blockId: checkpoint.id, label: "Пройти контрольную", reason: "Материалы блока прочитаны. Нужно подтвердить понимание.", step: "check" });

  const current = firstOpenReadableBlock(course, progress);
  if (current) return blockAction({ type: blockActionType(progress[current.id]), blockId: current.id, label: labelForBlock(progress[current.id]), reason: "Следующий лучший шаг - один короткий учебный блок.", step: "understand" });

  return { type: "course_complete", label: "Открыть журнал", reason: "Курс пройден. Сейчас полезнее перечитать свои выводы." };
}

function blockIndex(blockId: string, course: CourseModule[]): number {
  return course.findIndex((block) => block.id === blockId);
}

function openAccess(blockId: string, state: BlockState): BlockAccess {
  return { blockId, state, canOpen: true, reason: null, requiredBlockId: null };
}

function lockedAccess(blockId: string, requiredBlockId: string, previous?: ModuleProgress): BlockAccess {
  const reason = isCheckpointFailed(previous) ? "previous_checkpoint_failed" : "previous_checkpoint_required";
  return { blockId, state: "locked", canOpen: false, reason, requiredBlockId };
}

function blockViewModel(block: CourseModule, access: BlockAccess): CourseBlockViewModel {
  return { id: block.id, title: block.title, state: access.state, progressLabel: progressLabel(access), canOpen: access.canOpen, reason: access.reason, requiredBlockId: access.requiredBlockId };
}

function progressLabel(access: BlockAccess): string {
  if (access.state === "locked") return `Откроется после контрольной ${access.requiredBlockId}`;
  if (access.state === "checkpoint_passed") return "Контрольная сдана";
  if (access.state === "checkpoint_failed") return "Контрольная не сдана";
  if (access.state === "checkpoint_ready") return "Нужна контрольная";
  if (access.state === "in_progress") return "В работе";
  return "Можно начать";
}

function hasCheckpointResult(progress?: ModuleProgress): boolean {
  return Boolean(progress?.quizAttemptStatus === "complete" || progress?.quizCompletedAt);
}

function isCheckpointReady(progress?: ModuleProgress): boolean {
  return Boolean(progress?.theoryRead || progress?.quizAttemptStatus === "in-progress");
}

function isBlockStarted(progress?: ModuleProgress): boolean {
  return Boolean(progress?.takeawayDraft || progress?.takeaway || progress?.quizAnswered);
}

function firstOpenBlockWithState(course: CourseModule[], progress: ProgressMap, state: BlockState): CourseModule | null {
  return course.find((block) => canOpenBlock(block.id, course, progress) && getBlockState(progress[block.id]) === state) || null;
}

function firstOpenReadableBlock(course: CourseModule[], progress: ProgressMap): CourseModule | null {
  return course.find((block) => canOpenBlock(block.id, course, progress) && getBlockState(progress[block.id]) !== "checkpoint_passed") || null;
}

function labelForBlock(progress?: ModuleProgress): string {
  return isBlockStarted(progress) ? "Продолжить блок" : "Начать";
}

function reviewAction(items: ReviewItem[]): LearningAction {
  return { type: "review", label: "Начать повторение", reason: `${items.length} ${pluralize(items.length, "сигнал", "сигнала", "сигналов")} памяти готовы к короткой сессии.`, reviewItems: items };
}

function blockAction(action: LearningAction): LearningAction {
  return action;
}

function blockActionType(progress?: ModuleProgress): LearningActionType {
  return isBlockStarted(progress) ? "continue_block" : "start_block";
}

function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

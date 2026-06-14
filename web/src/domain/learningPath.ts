import { dueReviewItems } from "./review";
import { pluralize } from "../shared/utils/pluralize";
import { deriveCheckpointStatus as deriveCheckpointStatusFromMachine, getState as getStateFromMachine } from "./blockStateMachine";
import type {
  AppState,
  CheckpointAttempt,
  CheckpointStatus,
  CourseModule,
  FailedCheckpointAnswer,
  ModuleProgress,
  ProgressMap,
  RemediationAction,
  RemediationPlan,
  ReviewItem,
  ReviewState,
  StationStepKey,
} from "./types";

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

export interface CheckpointOutcome {
  blockId: string;
  status: CheckpointStatus;
  score: {
    correct: number;
    total: number;
    ratio: number | null;
  };
  failedQuestionIds: string[];
  isBlocking: boolean;
  failureDate: string | null;
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

export function getCheckpointStatus(blockId: string, progress: ProgressMap): CheckpointStatus {
  return deriveCheckpointStatusFromProgress(progress[blockId]);
}

export function getCheckpointOutcome(blockId: string, progress: ProgressMap, now = new Date()): CheckpointOutcome {
  const blockProgress = progress[blockId];
  const attempt = latestCheckpointAttempt(blockProgress);
  const status = deriveCheckpointStatusFromProgress(blockProgress);
  const score = checkpointScore(blockProgress, attempt);
  return {
    blockId,
    status,
    score,
    failedQuestionIds: failedQuestionIdsForOutcome(blockProgress, attempt),
    isBlocking: status === "failed",
    failureDate: outcomeFailureDate(blockProgress, attempt, now),
  };
}

export function getBlockingCheckpoint(course: CourseModule[], progress: ProgressMap): CourseModule | null {
  return course.find((block) => getCheckpointOutcome(block.id, progress).status === "failed") || null;
}

export const RETAKE_COOLDOWN_MS = 20 * 60 * 1000;

export function canRetakeCheckpoint(blockId: string, progress: ProgressMap, _reviewState?: ReviewState, now = new Date()): boolean {
  const outcome = getCheckpointOutcome(blockId, progress, now);
  if (outcome.status !== "failed") return false;
  if (!outcome.failureDate) return true;
  return now.getTime() - new Date(outcome.failureDate).getTime() >= RETAKE_COOLDOWN_MS;
}

export function getRemediationPlan(blockId: string, progress: ProgressMap, reviewState?: ReviewState): RemediationPlan | null {
  const outcome = getCheckpointOutcome(blockId, progress);
  if (outcome.status !== "failed") return null;
  const blockProgress = progress[blockId];
  const attempt = latestCheckpointAttempt(blockProgress);
  const failedAnswers = collectFailedAnswers(blockId, blockProgress?.weakSpots, attempt, outcome.failedQuestionIds);
  const actions = buildRemediationActions(blockId, reviewState, failedAnswers.length > 0);
  return {
    blockId,
    failedAt: outcome.failureDate,
    score: outcome.score,
    failedAnswers,
    actions,
    canRetake: canRetakeCheckpoint(blockId, progress, reviewState),
  };
}

function buildRemediationActions(blockId: string, reviewState: ReviewState | undefined, hasWeakSpots: boolean): RemediationAction[] {
  const actions: RemediationAction[] = [];
  actions.push("review_failed_questions");
  if (hasWeakSpots && hasRelatedReview(blockId, reviewState)) actions.push("read_related_fragments");
  actions.push("retake_checkpoint");
  return actions;
}

function hasRelatedReview(blockId: string, reviewState?: ReviewState): boolean {
  if (!reviewState?.items) return false;
  return reviewState.items.some((item) => item.moduleId === blockId);
}

export function getBlockAccess(blockId: string, course: CourseModule[], progress: ProgressMap): BlockAccess {
  const currentState = getBlockState(progress[blockId]);
  const previous = getPreviousBlock(blockId, course);
  if (!previous || isCheckpointPassed(progress[previous.id]) || isCheckpointPassedWithoutAutoQuestions(progress[previous.id])) {
    return openAccess(blockId, currentState);
  }
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
  return getStateFromMachine(progress);
}

export function isCheckpointPassed(progress?: ModuleProgress): boolean {
  return deriveCheckpointStatusFromProgress(progress) === "passed";
}

export function isCheckpointFailed(progress?: ModuleProgress): boolean {
  return deriveCheckpointStatusFromProgress(progress) === "failed";
}

export function completedCount(course: CourseModule[], progress: ProgressMap): number {
  return course.filter((block) => isCheckpointPassed(progress[block.id])).length;
}

export function getNextLearningAction(course: CourseModule[], progress: ProgressMap, appState: AppState, now = new Date()): LearningAction {
  const failed = getBlockingCheckpoint(course, progress);
  if (failed) return blockAction({ type: "fix_failed_checkpoint", blockId: failed.id, label: "Разобрать ошибки", reason: "Контрольная блока не сдана. Дальше пока закрыто.", step: "check" });

  const unfinished = firstOpenBlockWithCheckpointStatuses(course, progress, ["not_started", "in_progress"]);
  if (unfinished) return blockAction({ type: blockActionType(progress[unfinished.id]), blockId: unfinished.id, label: "Продолжить", reason: "Сначала нужно закрыть текущий блок.", step: "understand" });

  const checkpoint = firstOpenBlockWithStatus(course, progress, "ready");
  if (checkpoint) return blockAction({ type: "take_checkpoint", blockId: checkpoint.id, label: "Начать контрольную", reason: "Доступен к выполнению. Можно пройти контрольную сейчас.", step: "check" });

  const due = dueReviewItems(appState.review, now, 5);
  if (due.length) return reviewAction(due);

  const next = firstOpenReadableBlock(course, progress);
  if (next) return blockAction({ type: blockActionType(progress[next.id]), blockId: next.id, label: "Продолжить", reason: "Следующий доступный блок обучения. Пройдите его и откройте проверку.", step: "understand" });

  return { type: "course_complete", label: "Смотреть итоги", reason: "Курс закрыт. Сохранились результаты по всем блокам." };
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
  if (access.state === "locked") return `Блок закрыт из-за блока ${access.requiredBlockId}`;
  if (access.state === "checkpoint_passed") return "Контрольная сдана";
  if (access.state === "checkpoint_failed") return "Контрольная не сдана";
  if (access.state === "checkpoint_ready") return "Готово к сдаче";
  if (access.state === "in_progress") return "В процессе";
  return "Доступен";
}

function deriveCheckpointStatusFromProgress(progress?: ModuleProgress): CheckpointStatus {
  return deriveCheckpointStatusFromMachine(progress);
}

function latestCheckpointAttempt(progress?: ModuleProgress): CheckpointAttempt | null {
  const attempts = (progress?.checkpointAttempts || []).filter(isScoredAttempt);
  if (!attempts.length) return null;
  return attempts.sort((left, right) => attemptEndedAt(right) - attemptEndedAt(left))[0] || null;
}

function isScoredAttempt(attempt: CheckpointAttempt): boolean {
  return Number.isFinite(attempt.correct) && Number.isFinite(attempt.total);
}

function attemptEndedAt(attempt: CheckpointAttempt): number {
  const completed = Date.parse(attempt.completedAt || "");
  if (!Number.isNaN(completed)) return completed;
  const started = Date.parse(attempt.startedAt || "");
  return Number.isNaN(started) ? 0 : started;
}

function isCheckpointPassedWithoutAutoQuestions(progress?: ModuleProgress): boolean {
  if (!progress) return false;
  if (typeof progress.quizTotal === "number" && progress.quizTotal > 0) return false;
  return progress.quizAttemptStatus === "complete";
}

function isBlockStarted(progress?: ModuleProgress): boolean {
  return Boolean(progress?.takeawayDraft || progress?.takeaway || progress?.quizAnswered);
}

function checkpointScore(progress?: ModuleProgress, attempt?: CheckpointAttempt | null): CheckpointOutcome["score"] {
  if (attempt) {
    return {
      correct: attempt.correct,
      total: attempt.total,
      ratio: attempt.total > 0 ? attempt.correct / attempt.total : null,
    };
  }
  if (!progress || typeof progress.quizBest !== "number" || typeof progress.quizTotal !== "number" || progress.quizTotal <= 0) {
    return { correct: 0, total: 0, ratio: null };
  }
  return { correct: progress.quizBest, total: progress.quizTotal, ratio: progress.quizBest / progress.quizTotal };
}

function failedQuestionIds(progress?: ModuleProgress): string[] {
  if (!progress?.weakSpots) return [];
  return Object.keys(progress.weakSpots).sort((left, right) => Number(left) - Number(right));
}

function failedQuestionIdsForOutcome(progress: ModuleProgress | undefined, attempt: CheckpointAttempt | null): string[] {
  if (attempt?.failedQuestionIds?.length) return [...attempt.failedQuestionIds];
  return failedQuestionIds(progress);
}

function outcomeFailureDate(progress?: ModuleProgress, attempt?: CheckpointAttempt | null, now = new Date()): string | null {
  if (!progress) return null;
  if (attempt && attempt.failedQuestionIds.length > 0) return attempt.completedAt || progress.checkpointFailedAt || progress.quizCompletedAt || now.toISOString();
  return progress.checkpointFailedAt || progress.quizCompletedAt || null;
}

function collectFailedAnswers(
  blockId: string,
  weakSpots: ModuleProgress["weakSpots"],
  attempt: CheckpointAttempt | null,
  fallbackFailedQuestionIds: string[] = [],
): FailedCheckpointAnswer[] {
  const ids = deriveFailedQuestionIds(weakSpots, attempt, fallbackFailedQuestionIds);
  if (!ids.length) return [];
  return ids
    .map((id, index) => buildFailedAnswerFromId(blockId, id, weakSpots, index))
    .sort((left, right) => left.questionNumber - right.questionNumber);
}

function deriveFailedQuestionIds(
  weakSpots: ModuleProgress["weakSpots"],
  attempt: CheckpointAttempt | null,
  fallback: string[],
): string[] {
  if (attempt?.failedQuestionIds?.length) return [...attempt.failedQuestionIds];
  if (fallback.length) return [...fallback];
  return weakSpots ? Object.keys(weakSpots).sort((left, right) => Number(left) - Number(right)) : [];
}

// eslint-disable-next-line complexity -- builds answer from spot fields with explicit per-field fallbacks
function buildFailedAnswerFromId(
  blockId: string,
  id: string,
  weakSpots: ModuleProgress["weakSpots"],
  orderIndex: number,
): FailedCheckpointAnswer {
  const key = normalizeFailedQuestionId(id);
  const spot = weakSpots?.[key];
  if (!spot) {
    const fallbackNumber = Number.isFinite(Number(key)) ? Number(key) : orderIndex + 1;
    return {
      questionId: `${blockId}-${key}`,
      questionNumber: fallbackNumber,
      questionText: "Текст вопроса не сохранён",
      chosenOptionKey: null,
      chosenOptionText: null,
      correctOptionKey: null,
      correctOptionText: null,
      explanation: "Ответ по этому вопросу не найден. Откройте материал блока и повторите связанный фрагмент.",
      sourceBlock: null,
      sourceLesson: blockId,
      sourceFragment: "check",
    };
  }
  const numberFromKeys = Number(spot.questionNumber) || Number(key);
  const questionNumber = Number.isFinite(numberFromKeys) ? numberFromKeys : orderIndex + 1;
  return {
    questionId: `${blockId}-q${questionNumber}`,
    questionNumber,
    questionText: spot.questionText || spot.text || "Текст вопроса не сохранён",
    chosenOptionKey: spot.chosenOptionKey ?? null,
    chosenOptionText: spot.chosenOptionText ?? null,
    correctOptionKey: spot.correctOptionKey ?? null,
    correctOptionText: spot.correctOptionText ?? null,
    explanation: spot.shortExplanation || "Пояснение по этой ошибке отсутствует.",
    sourceBlock: spot.sourceBlock || null,
    sourceLesson: spot.sourceLesson || null,
    sourceFragment: spot.sourceFragment || null,
  };
}

function normalizeFailedQuestionId(value: string): string {
  const match = String(value).match(/^\s*q?(\d+)/i);
  return match ? match[1] : String(value);
}
function firstOpenBlockWithCheckpointStatuses(course: CourseModule[], progress: ProgressMap, statuses: CheckpointStatus[]): CourseModule | null {
  return course.find((block) => canOpenBlock(block.id, course, progress) && statuses.includes(getCheckpointStatus(block.id, progress))) || null;
}

function firstOpenBlockWithStatus(course: CourseModule[], progress: ProgressMap, status: CheckpointStatus): CourseModule | null {
  return course.find((block) => canOpenBlock(block.id, course, progress) && getCheckpointStatus(block.id, progress) === status) || null;
}

function firstOpenReadableBlock(course: CourseModule[], progress: ProgressMap): CourseModule | null {
  return course.find((block) => canOpenBlock(block.id, course, progress) && getBlockState(progress[block.id]) !== "checkpoint_passed") || null;
}

function reviewAction(items: ReviewItem[]): LearningAction {
  return {
    type: "review",
    label: "Сделать повторы",
    reason: `${items.length} ${pluralize(items.length, "опрос", "опроса", "опросов")} на повторение. Проверить снова и закрепить.`,
    reviewItems: items,
  };
}

function blockAction(action: LearningAction): LearningAction {
  return action;
}

function blockActionType(progress?: ModuleProgress): LearningActionType {
  return isBlockStarted(progress) ? "continue_block" : "start_block";
}

import type { CheckpointAttempt, CheckpointStatus, ModuleProgress } from "./types";

export const PASS_RATIO = 0.8;
// Threshold used before checkpointAttempts were introduced. Kept at 0.7 so
// that legacy quizBest/quizTotal scores are not retroactively invalidated.
const LEGACY_PASS_RATIO = 0.7;

export type BlockState = "locked" | "available" | "in_progress" | "checkpoint_ready" | "checkpoint_failed" | "checkpoint_passed" | "course_complete";

export const BLOCK_TRANSITIONS: Record<BlockState, readonly BlockState[]> = {
  locked: ["available"],
  available: ["in_progress", "checkpoint_ready"],
  in_progress: ["checkpoint_ready", "checkpoint_failed", "checkpoint_passed"],
  checkpoint_ready: ["in_progress", "checkpoint_failed", "checkpoint_passed"],
  checkpoint_failed: ["in_progress", "checkpoint_passed"],
  checkpoint_passed: ["course_complete"],
  course_complete: [],
};

export function canTransition(from: BlockState, to: BlockState): boolean {
  return BLOCK_TRANSITIONS[from].includes(to);
}

export function getState(progress?: ModuleProgress): BlockState {
  const status = deriveCheckpointStatus(progress);
  if (status === "passed") return "checkpoint_passed";
  if (status === "failed") return "checkpoint_failed";
  if (status === "ready") return "checkpoint_ready";
  if (status === "in_progress") return "in_progress";
  return "available";
}

// eslint-disable-next-line complexity -- explicit ordered legacy/current checkpoint fallbacks
export function deriveCheckpointStatus(progress?: ModuleProgress): CheckpointStatus {
  if (!progress) return "not_started";
  if ((progress.quizTotal || 0) === 0 && progress.quizAttemptStatus === "complete") return "passed";
  if ((progress.quizTotal || 0) === 0 && progress.quizAttemptStatus === "in-progress") return "in_progress";

  const attempt = latestCheckpointAttempt(progress);
  if (attempt) return attempt.passed ? "passed" : "failed";

  const legacyScore = legacyScoredStatus(progress);
  if (legacyScore) return legacyScore.passed ? "passed" : "failed";

  const legacyStatus = normalizeLegacyStatus(progress.checkpointStatus);
  if (legacyStatus) return legacyStatus;

  if (progress.quizAttemptStatus === "in-progress" || (progress.quizAnswered || 0) > 0 || isBlockStarted(progress)) return "in_progress";
  if (progress.theoryRead) return "ready";
  return "not_started";
}

function legacyScoredStatus(progress: ModuleProgress): { passed: boolean } | null {
  if (typeof progress.quizBest !== "number" || typeof progress.quizTotal !== "number") return null;
  if (progress.quizTotal === 0) return { passed: true };
  if (progress.quizAttemptStatus === "in-progress") return null;
  return { passed: progress.quizBest / progress.quizTotal >= LEGACY_PASS_RATIO };
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

function isBlockStarted(progress?: ModuleProgress): boolean {
  return Boolean(progress?.takeawayDraft || progress?.takeaway || progress?.quizAnswered);
}

function normalizeLegacyStatus(status?: CheckpointStatus): CheckpointStatus | null {
  if (status === "not_started" || status === "ready" || status === "in_progress" || status === "failed" || status === "passed") return status;
  return null;
}

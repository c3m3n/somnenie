import { COURSE_ID, SCHEMA_VERSION, type AppState, type ModuleProgress, type ProgressMap } from "../domain/types";
import { defaultReviewState, defaultSessionsState, normalizeReviewState, normalizeSessionsState } from "../domain/review";

export function migrateAppState(state: unknown, targetVersion = SCHEMA_VERSION): AppState {
  const source = isRecord(state) ? state : {};
  return {
    schemaVersion: targetVersion,
    review: normalizeReviewState(source.review),
    sessions: normalizeSessionsState(source.sessions),
  };
}

export function migrateProgress(progress: unknown, _targetVersion = SCHEMA_VERSION): ProgressMap {
  if (!isRecord(progress)) return {};
  return Object.fromEntries(
    Object.entries(progress)
      .filter(([, value]) => isRecord(value))
      .map(([moduleId, value]) => [moduleId, migrateModuleProgress(value)]),
  );
}

export function migrateModuleProgress(progress: unknown, _targetVersion = SCHEMA_VERSION): ModuleProgress {
  if (!isRecord(progress)) return {};
  const next: ModuleProgress = { ...progress };

  if (typeof next.quizTotal !== "number" && typeof next.quizTotalQuestions === "number") {
    next.quizTotal = next.quizTotalQuestions;
  }
  if (next.weakSpots && isRecord(next.weakSpots)) {
    next.weakSpots = Object.fromEntries(
      Object.entries(next.weakSpots)
        .filter(([, value]) => isRecord(value))
        .map(([key, value]) => [key, migrateWeakSpot(value, key)]),
    );
  }

  return next;
}

export function defaultAppState(): AppState {
  return { schemaVersion: SCHEMA_VERSION, review: defaultReviewState(), sessions: defaultSessionsState() };
}

export function appStateWithDefaults(value: unknown): AppState {
  const migrated = migrateAppState(value);
  return {
    schemaVersion: SCHEMA_VERSION,
    review: migrated.review || defaultReviewState(),
    sessions: migrated.sessions || { courseId: COURSE_ID, todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 },
  };
}

function migrateWeakSpot(value: unknown, key: string): NonNullable<ModuleProgress["weakSpots"]>[string] {
  const next = { ...(isRecord(value) ? value : { text: "" }) } as unknown as NonNullable<ModuleProgress["weakSpots"]>[string];
  if (typeof next.questionNumber !== "number" && typeof next.number === "number") next.questionNumber = next.number;
  if (!next.levelKey && next.level) next.levelKey = next.level;
  if (!next.diagnosticType && next.mistakeType) next.diagnosticType = next.mistakeType;
  if (typeof next.questionNumber !== "number") {
    const fromKey = Number(key);
    if (Number.isFinite(fromKey)) next.questionNumber = fromKey;
  }
  return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

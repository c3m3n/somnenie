import { COURSE_ID, SCHEMA_VERSION, type AppState, type CourseAppState, type CourseId, type ModuleProgress, type MultiCourseAppState, type ProgressMap } from "../domain/types";
import { defaultReviewState, defaultSessionsState, normalizeReviewState, normalizeSessionsState } from "../domain/review";

const DEFAULT_COURSE_ID: CourseId = COURSE_ID;

export function migrateAppState(state: unknown, targetVersion = SCHEMA_VERSION): MultiCourseAppState {
  const source = isRecord(state) ? state : {};
  const activeCourseId = typeof source.activeCourseId === "string" ? source.activeCourseId : DEFAULT_COURSE_ID;

  if (isLegacyAppState(source)) {
    return migrateLegacyAppState(source, activeCourseId, targetVersion);
  }

  return migrateMultiCourseAppState(source, activeCourseId, targetVersion);
}

function isLegacyAppState(source: Record<string, unknown>): boolean {
  return !isRecord(source.courses) && Boolean(source.review || source.sessions);
}

function migrateLegacyAppState(source: Record<string, unknown>, activeCourseId: string, targetVersion: number): MultiCourseAppState {
  return {
    schemaVersion: targetVersion,
    activeCourseId: activeCourseId,
    courses: {
      [DEFAULT_COURSE_ID]: buildCourseAppState(DEFAULT_COURSE_ID, source),
    },
  };
}

function migrateMultiCourseAppState(source: Record<string, unknown>, activeCourseId: string, targetVersion: number): MultiCourseAppState {
  const courses = isRecord(source.courses) ? source.courses : {};
  const migratedCourses = migrateCourseStates(courses);

  if (!migratedCourses[DEFAULT_COURSE_ID]) {
    migratedCourses[DEFAULT_COURSE_ID] = {
      review: defaultReviewState(),
      sessions: defaultSessionsState(),
    };
  }

  return {
    schemaVersion: targetVersion,
    activeCourseId: activeCourseId,
    courses: migratedCourses,
  };
}

function migrateCourseStates(courses: Record<string, unknown>): Record<CourseId, CourseAppState> {
  const migratedCourses: Record<CourseId, CourseAppState> = {};
  for (const [courseId, courseState] of Object.entries(courses)) {
    if (!isRecord(courseState)) continue;
    migratedCourses[courseId] = buildCourseAppState(courseId, courseState);
  }
  return migratedCourses;
}

function buildCourseAppState(courseId: string, source: Record<string, unknown>): CourseAppState {
  return {
    review: normalizeReviewState(source.review, courseId),
    sessions: normalizeSessionsState(source.sessions, undefined, courseId),
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

export function defaultAppState(): MultiCourseAppState {
  return {
    schemaVersion: SCHEMA_VERSION,
    activeCourseId: DEFAULT_COURSE_ID,
    courses: {
      [DEFAULT_COURSE_ID]: {
        review: defaultReviewState(DEFAULT_COURSE_ID),
        sessions: defaultSessionsState(undefined, DEFAULT_COURSE_ID),
      },
    },
  };
}

export function appStateWithDefaults(value: unknown): AppState {
  const migrated = migrateAppState(value);
  const courseState = migrated.courses[DEFAULT_COURSE_ID] || {
    review: defaultReviewState(DEFAULT_COURSE_ID),
    sessions: defaultSessionsState(undefined, DEFAULT_COURSE_ID),
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    review: courseState.review || defaultReviewState(DEFAULT_COURSE_ID),
    sessions: courseState.sessions || defaultSessionsState(undefined, DEFAULT_COURSE_ID),
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

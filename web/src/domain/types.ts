export const COURSE_ID = "nutrition";
export const SCHEMA_VERSION = 3;
export const REVIEW_SCHEMA_VERSION = 2;
export const QUIZ_PROGRESS_VERSION = 2;
export const DEFAULT_MODULE_FILES = ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"] as const;

export type CourseId = string;
export type ModuleFileName = string;
export type StationStepKey = "understand" | "apply" | "check" | "anchor";
export type CheckpointStatus = "not_started" | "ready" | "in_progress" | "failed" | "passed";
export type RemediationAction = "review_failed_questions" | "read_related_fragments" | "retake_checkpoint";

export interface ContentCatalog {
  schemaVersion: number;
  courses: { id: CourseId; title: string; description?: string; manifest: string }[];
}

export interface ContentManifestModule {
  id: string;
  title: string;
}

export interface ContentManifest {
  schemaVersion: number;
  contentVersion: string;
  courseId: CourseId;
  course: string;
  claims: string;
  moduleFiles: ModuleFileName[];
  modules: ContentManifestModule[];
}

export interface CoursePhase {
  id: string;
  title: string;
  subtitle?: string;
  modules: string[];
}

export interface CourseMap {
  title: string;
  phases: CoursePhase[];
}

export interface ClaimSource {
  sourceId: string;
  title: string;
  url: string;
  jurisdiction: string;
  reviewedAt: string;
}

export interface ClaimItem {
  claimId: string;
  moduleId: string;
  kind: string;
  claim: string;
  sourceId: string;
  supportingSourceIds?: string[];
  jurisdiction: string;
  reviewedAt: string;
  files: string[];
}

export interface ClaimsContract {
  schemaVersion: number;
  reviewedAt: string;
  sources: ClaimSource[];
  claims: ClaimItem[];
}

export interface CourseModule {
  id: string;
  title: string;
  phaseId: string;
  phaseTitle: string;
  files: Record<ModuleFileName, string>;
}

export interface CourseBundle {
  courseId: CourseId;
  manifest: ContentManifest;
  course: CourseMap;
  claims: ClaimsContract;
  modules: CourseModule[];
}

export interface LearnerProfile {
  id?: string;
  name?: string;
  goal?: string;
  level?: string;
  startedAt?: string;
  updatedAt?: string;
  quietMode?: boolean;
  activeCourseId?: CourseId;
}

export interface WeakSpot {
  number?: number;
  questionNumber?: number;
  text: string;
  questionText?: string;
  level?: string;
  levelKey?: string;
  mistakeType?: string;
  diagnosticType?: string;
  userLabel?: string;
  shortExplanation?: string;
  reviewStrategy?: string;
  misses?: number;
  updatedAt?: string;
  sourceBlock?: string | null;
  sourceLesson?: string | null;
  sourceFragment?: string | null;
  chosenOptionKey?: string | null;
  chosenOptionText?: string | null;
  correctOptionKey?: string | null;
  correctOptionText?: string | null;
}

export interface FailedCheckpointAnswer {
  questionId: string;
  questionNumber: number;
  questionText: string;
  chosenOptionKey: string | null;
  chosenOptionText: string | null;
  correctOptionKey: string | null;
  correctOptionText: string | null;
  explanation: string;
  sourceBlock: string | null;
  sourceLesson: string | null;
  sourceFragment: string | null;
}

export interface CheckpointAttempt {
  blockId: string;
  startedAt: string;
  completedAt: string | null;
  correct: number;
  total: number;
  passed: boolean;
  failedQuestionIds: string[];
}

export interface RemediationPlan {
  blockId: string;
  failedAt: string | null;
  score: {
    correct: number;
    total: number;
    ratio: number | null;
  };
  failedAnswers: FailedCheckpointAnswer[];
  actions: RemediationAction[];
  canRetake: boolean;
}

export interface ModuleProgress {
  theoryRead?: boolean;
  readerPageIndex?: number;
  takeaway?: string;
  takeawayDraft?: string;
  takeawayUpdatedAt?: string;
  quizAttemptStatus?: "not-started" | "in-progress" | "complete";
  quizStartedAt?: string;
  quizCompletedAt?: string;
  quizAnswered?: number;
  quizTotalQuestions?: number;
  quizCorrect?: number;
  quizMistakes?: number;
  quizBest?: number;
  quizTotal?: number;
  quizOpenTotal?: number;
  quizVersion?: number;
  quizSeed?: number;
  weakSpots?: Record<string, WeakSpot>;
  checkpointAttempts?: CheckpointAttempt[];
  checkpointStatus?: CheckpointStatus;
  checkpointPassedAt?: string;
  checkpointFailedAt?: string;
}

export type ProgressMap = Record<string, ModuleProgress>;

export interface ReviewItem {
  id: string;
  courseId: string;
  moduleId: string;
  kind: "question" | "concept";
  text: string;
  questionNumber?: number;
  diagnosticType?: string;
  userLabel?: string;
  shortExplanation?: string;
  reviewStrategy?: string;
  interval: number;
  due: string | null;
  lastResult?: "right" | "wrong";
  errors: number;
  streak: number;
  createdAt: string;
  updatedAt: string;
  retired: boolean;
}

export interface ReviewState {
  schemaVersion: number;
  courseId: string;
  items: ReviewItem[];
}

export interface SessionsState {
  courseId: string;
  todayDone: Record<string, number>;
  activeDays: string[];
  lastDate: string | null;
  streakDays: number;
  bestStreakDays: number;
}

export interface AppState {
  schemaVersion: number;
  review: ReviewState;
  sessions: SessionsState;
}

export interface CourseAppState {
  review: ReviewState;
  sessions: SessionsState;
}

export interface MultiCourseAppState {
  schemaVersion: number;
  activeCourseId: CourseId;
  courses: Record<CourseId, CourseAppState>;
}

export interface ExportPayload {
  schemaVersion: number;
  exportedAt: string;
  courseId: CourseId;
  profile: LearnerProfile | null;
  progress: ProgressMap;
  review: ReviewState;
  sessions: SessionsState;
}

export interface ChoiceOption {
  key: string;
  text: string;
}

export interface QuizQuestion {
  number: number;
  type: string;
  kind: "auto" | "application";
  text: string;
  options: ChoiceOption[];
  answer: string | boolean | null;
  explain: string;
  sourceBlock: string;
}

export interface TodayAction {
  kind: "review" | "station" | "journal" | "remediation";
  label: string;
  reason: string;
  moduleId?: string;
  step?: StationStepKey;
  reviewItems?: ReviewItem[];
}

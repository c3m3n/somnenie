import { addDaysISO, toISODate } from "./date";
import { COURSE_ID, REVIEW_SCHEMA_VERSION, type ReviewItem, type ReviewState, type SessionsState, type WeakSpot } from "./types";

export const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60] as const;
export const DAILY_REVIEW_LIMIT = 10;
export const TODAY_REVIEW_LIMIT = 5;

export function defaultReviewState(): ReviewState {
  return { schemaVersion: REVIEW_SCHEMA_VERSION, courseId: COURSE_ID, items: [] };
}

export function defaultSessionsState(today = toISODate()): SessionsState {
  return { courseId: COURSE_ID, todayDone: {}, activeDays: [], lastDate: today, streakDays: 0, bestStreakDays: 0 };
}

export function normalizeReviewState(review: unknown): ReviewState {
  const source = isRecord(review) ? review : {};
  const rawItems = Array.isArray(source.items) ? source.items : [];
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    courseId: COURSE_ID,
    items: rawItems.map((item) => normalizeReviewItem(item)).filter(Boolean) as ReviewItem[],
  };
}

export function normalizeSessionsState(sessions: unknown, today = toISODate()): SessionsState {
  const source = isRecord(sessions) ? sessions : {};
  const activeDays = Array.isArray(source.activeDays) ? source.activeDays.map(String) : [];
  return {
    courseId: COURSE_ID,
    todayDone: isRecord(source.todayDone) ? numberRecord(source.todayDone) : {},
    activeDays,
    lastDate: typeof source.lastDate === "string" ? source.lastDate : today,
    streakDays: numberOr(source.streakDays, 0),
    bestStreakDays: numberOr(source.bestStreakDays, 0),
  };
}

export function questionReviewId(moduleId: string, questionNumber: number | string): string {
  return `${moduleId}-q${questionNumber}`;
}

export function upsertWrongQuestion(review: ReviewState, payload: {
  moduleId: string;
  questionNumber: number;
  questionText: string;
  explanation: string;
  diagnosticType?: string;
  userLabel?: string;
  reviewStrategy?: string;
}, now = new Date()): ReviewState {
  const state = normalizeReviewState(review);
  const today = toISODate(now);
  const id = questionReviewId(payload.moduleId, payload.questionNumber);
  const previous = state.items.find((item) => item.id === id);
  const next = buildWrongQuestionItem(payload, previous, today);
  return replaceReviewItem(state, next);
}

export function itemFromWeakSpot(moduleId: string, spot: WeakSpot, now = new Date()): ReviewItem {
  const today = toISODate(now);
  const number = spot.number ?? spot.questionNumber ?? "x";
  return normalizeReviewItem({
    id: questionReviewId(moduleId, number),
    courseId: COURSE_ID,
    moduleId,
    kind: "question",
    questionNumber: Number(number) || undefined,
    text: spot.text,
    diagnosticType: spot.diagnosticType,
    userLabel: spot.userLabel,
    shortExplanation: spot.shortExplanation,
    reviewStrategy: spot.reviewStrategy,
    interval: 1,
    due: today,
    errors: spot.misses || 1,
    streak: 0,
    createdAt: spot.updatedAt || new Date().toISOString(),
    updatedAt: spot.updatedAt || new Date().toISOString(),
    retired: false,
  }) as ReviewItem;
}

export function applyReviewAnswer(item: ReviewItem, isRight: boolean, now = new Date()): ReviewItem {
  const today = toISODate(now);
  const source = normalizeReviewItem(item) as ReviewItem;
  if (!isRight) return wrongReviewItem(source, today);
  return rightReviewItem(source, today);
}

export function applyReviewResult(review: ReviewState, itemId: string, isRight: boolean, now = new Date()): ReviewState {
  const state = normalizeReviewState(review);
  return {
    ...state,
    items: state.items.map((item) => item.id === itemId ? applyReviewAnswer(item, isRight, now) : item),
  };
}

export function dueReviewItems(review: ReviewState, now = new Date(), limit = DAILY_REVIEW_LIMIT): ReviewItem[] {
  const today = toISODate(now);
  return sortDueItems(activeItems(review).filter((item) => item.due && item.due <= today)).slice(0, limit);
}

export function recordSessionActivity(sessions: SessionsState, activity: { reviews?: number; moduleStep?: boolean }, now = new Date()): SessionsState {
  const today = toISODate(now);
  const state = normalizeSessionsState(sessions, today);
  const didWork = Boolean(activity.moduleStep) || numberOr(activity.reviews, 0) > 0;
  const activeDays = didWork && !state.activeDays.includes(today) ? [...state.activeDays, today] : state.activeDays;
  const streakDays = didWork ? nextStreak(state, today) : state.streakDays;
  return {
    ...state,
    todayDone: { ...state.todayDone, reviews: numberOr(state.todayDone.reviews, 0) + numberOr(activity.reviews, 0) },
    activeDays,
    lastDate: didWork ? today : state.lastDate,
    streakDays,
    bestStreakDays: Math.max(state.bestStreakDays, streakDays),
  };
}

function buildWrongQuestionItem(payload: Parameters<typeof upsertWrongQuestion>[1], previous: ReviewItem | undefined, today: string): ReviewItem {
  const nowIso = new Date().toISOString();
  return normalizeReviewItem({
    id: questionReviewId(payload.moduleId, payload.questionNumber),
    courseId: COURSE_ID,
    moduleId: payload.moduleId,
    kind: "question",
    questionNumber: payload.questionNumber,
    text: payload.questionText,
    diagnosticType: firstString(payload.diagnosticType, previous?.diagnosticType, "quiz_mistake"),
    userLabel: firstString(payload.userLabel, previous?.userLabel, "Слабое место"),
    shortExplanation: firstString(payload.explanation, previous?.shortExplanation, ""),
    reviewStrategy: firstString(payload.reviewStrategy, previous?.reviewStrategy, "Ответить на похожий вопрос."),
    interval: 1,
    due: addDaysISO(today, 1),
    lastResult: "wrong",
    errors: (previous?.errors || 0) + 1,
    streak: 0,
    createdAt: previous?.createdAt || nowIso,
    updatedAt: nowIso,
    retired: false,
  }) as ReviewItem;
}

function normalizeReviewItem(item: unknown): ReviewItem | null {
  if (!isRecord(item) || !item.id || !item.moduleId) return null;
  const nowIso = new Date().toISOString();
  return {
    id: stringValue(item.id, ""),
    courseId: COURSE_ID,
    moduleId: stringValue(item.moduleId, ""),
    kind: item.kind === "concept" ? "concept" : "question",
    text: firstString(item.text, item.shortExplanation, "Повторить материал"),
    questionNumber: item.questionNumber == null ? undefined : Number(item.questionNumber),
    diagnosticType: stringOrUndefined(item.diagnosticType),
    userLabel: stringOrUndefined(item.userLabel),
    shortExplanation: stringOrUndefined(item.shortExplanation),
    reviewStrategy: stringOrUndefined(item.reviewStrategy),
    interval: validInterval(item.interval),
    due: item.due === null ? null : stringValue(item.due, toISODate()),
    lastResult: item.lastResult === "right" || item.lastResult === "wrong" ? item.lastResult : undefined,
    errors: numberOr(item.errors, 0),
    streak: numberOr(item.streak, 0),
    createdAt: stringValue(item.createdAt, nowIso),
    updatedAt: stringValue(item.updatedAt, nowIso),
    retired: Boolean(item.retired),
  };
}

function activeItems(review: ReviewState): ReviewItem[] {
  return normalizeReviewState(review).items.filter((item) => !item.retired);
}

function sortDueItems(items: ReviewItem[]): ReviewItem[] {
  return [...items].sort((a, b) => b.errors - a.errors || String(a.due).localeCompare(String(b.due)));
}

function replaceReviewItem(state: ReviewState, item: ReviewItem): ReviewState {
  const items = state.items.filter((candidate) => candidate.id !== item.id);
  return { ...state, items: [...items, item] };
}

function rightReviewItem(item: ReviewItem, today: string): ReviewItem {
  const interval = nextIntervalAfter(item.interval);
  const retired = item.interval >= 60;
  return { ...item, interval, due: retired ? null : addDaysISO(today, interval), lastResult: "right", streak: item.streak + 1, updatedAt: new Date().toISOString(), retired };
}

function wrongReviewItem(item: ReviewItem, today: string): ReviewItem {
  return { ...item, interval: 1, due: addDaysISO(today, 1), lastResult: "wrong", errors: item.errors + 1, streak: 0, updatedAt: new Date().toISOString(), retired: false };
}

function nextIntervalAfter(interval: number): number {
  const index = REVIEW_INTERVALS.indexOf(interval as (typeof REVIEW_INTERVALS)[number]);
  return REVIEW_INTERVALS[Math.min(index + 1, REVIEW_INTERVALS.length - 1)] || 1;
}

function nextStreak(state: SessionsState, today: string): number {
  if (!state.lastDate || state.lastDate === today) return Math.max(1, state.streakDays);
  return state.lastDate === addDaysISO(today, -1) ? state.streakDays + 1 : 1;
}

function validInterval(value: unknown): number {
  const numeric = Number(value);
  return REVIEW_INTERVALS.includes(numeric as (typeof REVIEW_INTERVALS)[number]) ? numeric : 1;
}

function numberRecord(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).map(([key, raw]) => [key, numberOr(raw, 0)]));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstString(...values: unknown[]): string {
  return values.find((value) => typeof value === "string" && value.trim()) as string || "";
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

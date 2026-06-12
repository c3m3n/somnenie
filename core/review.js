(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NutrioReview = api;
  if (root && root.window) root.window.NutrioReview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const COURSE_ID = "nutrition";
  const REVIEW_SCHEMA_VERSION = 2;
  const REVIEW_INTERVALS = [1, 3, 7, 14, 30, 60];
  // DAILY_REVIEW_LIMIT — максимум, который очередь готова выдать за день.
  // TODAY_REVIEW_LIMIT — сколько показываем в дневной карточке/сеансе (короткая сессия).
  const DAILY_REVIEW_LIMIT = 10;
  const TODAY_REVIEW_LIMIT = 5;

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function toISODate(input = new Date()) {
    if (typeof input === "string") return input.slice(0, 10);
    const date = input instanceof Date ? input : new Date(input);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function dateFromISO(iso) {
    const [year, month, day] = String(iso || toISODate()).slice(0, 10).split("-").map(Number);
    return new Date(year || 1970, (month || 1) - 1, day || 1);
  }

  function addDaysISO(input, days) {
    const date = dateFromISO(toISODate(input));
    date.setDate(date.getDate() + Number(days || 0));
    return toISODate(date);
  }

  function daysBetweenISO(a, b) {
    const start = dateFromISO(a).getTime();
    const end = dateFromISO(b).getTime();
    return Math.round((end - start) / 86400000);
  }

  function numberOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function diagnosticTypeFrom(value) {
    const clean = String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
    return clean || "mixed_reasoning";
  }

  function normalizeReviewState(review, today = toISODate()) {
    const source = review && typeof review === "object" && !Array.isArray(review) ? review : {};
    return {
      courseId: source.courseId || COURSE_ID,
      schemaVersion: REVIEW_SCHEMA_VERSION,
      items: Array.isArray(source.items)
        ? source.items.map((item) => normalizeReviewItem(item, today)).filter(Boolean)
        : [],
    };
  }

  function normalizeReviewItem(item, today = toISODate()) {
    if (!item || typeof item !== "object") return null;
    const moduleId = String(item.moduleId || "").trim();
    const id = String(item.id || "").trim();
    if (!moduleId || !id) return null;

    const interval = REVIEW_INTERVALS.includes(Number(item.interval)) ? Number(item.interval) : 1;
    return {
      id,
      courseId: item.courseId || COURSE_ID,
      moduleId,
      kind: item.kind === "concept" ? "concept" : "question",
      questionNumber: item.questionNumber ?? item.number ?? null,
      text: String(item.text || item.prompt || "").slice(0, 320),
      level: item.level || null,
      levelKey: item.levelKey || null,
      mistakeType: item.mistakeType || "Смешение уровней анализа",
      diagnosticType: item.diagnosticType || diagnosticTypeFrom(item.mistakeType || item.userLabel),
      userLabel: item.userLabel || item.mistakeType || "Смешение уровней анализа",
      shortExplanation: item.shortExplanation || item.repair || "",
      reviewStrategy: item.reviewStrategy || "",
      repair: item.repair || item.shortExplanation || "",
      errors: Math.max(0, numberOr(item.errors ?? item.misses, 0)),
      streak: Math.max(0, numberOr(item.streak, 0)),
      due: item.retired ? null : (item.due || today),
      interval,
      addedAt: item.addedAt || item.updatedAt || today,
      updatedAt: item.updatedAt || item.addedAt || today,
      lastResult: item.lastResult === "right" || item.lastResult === "wrong" ? item.lastResult : null,
      retired: Boolean(item.retired),
    };
  }

  function questionReviewId(moduleId, questionNumber) {
    return `${moduleId}-q${questionNumber}`;
  }

  function conceptReviewId(moduleId, slug) {
    return `${moduleId}-concept-${String(slug || "signal").replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`;
  }

  function upsertWrongQuestion(review, payload, now = new Date()) {
    const today = toISODate(now);
    const state = normalizeReviewState(review, today);
    const question = payload.question || {};
    const diagnosis = payload.diagnosis || {};
    const moduleId = String(payload.moduleId || "").trim();
    const questionNumber = question.number ?? payload.questionNumber;
    const id = payload.id || questionReviewId(moduleId, questionNumber);
    const index = state.items.findIndex((item) => item.id === id && item.courseId === COURSE_ID);
    const previous = index >= 0 ? state.items[index] : {};
    const mistakeType = diagnosis.mistakeType || payload.mistakeType || previous.mistakeType || "Смешение уровней анализа";
    const repair = diagnosis.repair || payload.repair || previous.repair || previous.shortExplanation || "";
    const item = {
      id,
      courseId: COURSE_ID,
      moduleId,
      kind: "question",
      questionNumber,
      text: String(payload.text || question.text || previous.text || "").slice(0, 320),
      level: diagnosis.level?.label || payload.level || previous.level || null,
      levelKey: diagnosis.level?.key || payload.levelKey || previous.levelKey || null,
      mistakeType,
      diagnosticType: payload.diagnosticType || previous.diagnosticType || diagnosticTypeFrom(mistakeType),
      userLabel: payload.userLabel || previous.userLabel || mistakeType,
      shortExplanation: payload.shortExplanation || previous.shortExplanation || repair,
      reviewStrategy: payload.reviewStrategy || previous.reviewStrategy || "Ответить на новый вопрос с тем же типом рассуждения.",
      repair,
      errors: Math.max(0, numberOr(previous.errors, 0)) + 1,
      streak: 0,
      due: addDaysISO(today, 1),
      interval: 1,
      addedAt: previous.addedAt || today,
      updatedAt: today,
      lastResult: "wrong",
      retired: false,
    };
    if (index >= 0) state.items[index] = item;
    else state.items.push(item);
    return state;
  }

  function itemFromWeakSpot(moduleId, spot, now = new Date()) {
    const today = toISODate(now);
    const number = spot?.number ?? spot?.questionNumber ?? "x";
    return normalizeReviewItem({
      id: questionReviewId(moduleId, number),
      courseId: COURSE_ID,
      moduleId,
      kind: "question",
      questionNumber: number,
      text: spot?.text || "",
      level: spot?.level || null,
      levelKey: spot?.levelKey || null,
      mistakeType: spot?.mistakeType || "Смешение уровней анализа",
      diagnosticType: spot?.diagnosticType || diagnosticTypeFrom(spot?.mistakeType),
      userLabel: spot?.userLabel || spot?.mistakeType || "Смешение уровней анализа",
      shortExplanation: spot?.shortExplanation || spot?.repair || "",
      reviewStrategy: spot?.reviewStrategy || "Ответить на новый вопрос с тем же типом рассуждения.",
      repair: spot?.repair || spot?.shortExplanation || "",
      errors: Math.max(1, numberOr(spot?.errors ?? spot?.misses, 1)),
      streak: 0,
      due: today,
      interval: 1,
      addedAt: toISODate(spot?.updatedAt || now),
      updatedAt: toISODate(spot?.updatedAt || now),
      lastResult: "wrong",
      retired: false,
    }, today);
  }

  function nextIntervalAfter(interval) {
    const current = REVIEW_INTERVALS.includes(Number(interval)) ? Number(interval) : 1;
    const index = REVIEW_INTERVALS.indexOf(current);
    return REVIEW_INTERVALS[Math.min(index + 1, REVIEW_INTERVALS.length - 1)];
  }

  function applyReviewAnswer(item, isRight, now = new Date()) {
    const today = toISODate(now);
    const current = normalizeReviewItem(item, today);
    if (!current) return null;

    if (isRight) {
      if (current.interval >= REVIEW_INTERVALS[REVIEW_INTERVALS.length - 1]) {
        return Object.assign({}, current, {
          streak: current.streak + 1,
          updatedAt: today,
          lastResult: "right",
          retired: true,
          due: null,
          interval: REVIEW_INTERVALS[REVIEW_INTERVALS.length - 1],
        });
      }
      const interval = nextIntervalAfter(current.interval);
      return Object.assign({}, current, {
        streak: current.streak + 1,
        updatedAt: today,
        lastResult: "right",
        retired: false,
        interval,
        due: addDaysISO(today, interval),
      });
    }

    return Object.assign({}, current, {
      errors: current.errors + 1,
      streak: 0,
      updatedAt: today,
      lastResult: "wrong",
      retired: false,
      interval: 1,
      due: addDaysISO(today, 1),
    });
  }

  function applyReviewResult(review, itemId, isRight, now = new Date()) {
    const today = toISODate(now);
    const state = normalizeReviewState(review, today);
    const index = state.items.findIndex((item) => item.id === itemId);
    if (index < 0) return state;
    state.items[index] = applyReviewAnswer(state.items[index], isRight, today);
    return state;
  }

  function activeItems(review, today = toISODate()) {
    return normalizeReviewState(review, today).items.filter((item) => !item.retired);
  }

  function sortDueItems(items) {
    return items.slice().sort((a, b) =>
      (b.errors - a.errors) ||
      String(a.due || "").localeCompare(String(b.due || "")) ||
      String(a.addedAt || "").localeCompare(String(b.addedAt || "")) ||
      String(a.id).localeCompare(String(b.id))
    );
  }

  function dueReviewItems(review, now = new Date(), limit = DAILY_REVIEW_LIMIT) {
    const today = toISODate(now);
    return sortDueItems(activeItems(review, today).filter((item) => item.due && item.due <= today)).slice(0, limit);
  }

  function groupReviewItems(review, now = new Date()) {
    const today = toISODate(now);
    const items = normalizeReviewState(review, today).items;
    return {
      today: sortDueItems(items.filter((item) => !item.retired && item.due && item.due <= today)),
      soon: items
        .filter((item) => !item.retired && item.due && item.due > today)
        .sort((a, b) => String(a.due).localeCompare(String(b.due)) || (b.errors - a.errors)),
      retired: items
        .filter((item) => item.retired)
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))),
    };
  }

  function reviewStats(review, now = new Date()) {
    const grouped = groupReviewItems(review, now);
    return {
      dueToday: grouped.today.length,
      soon: grouped.soon.length,
      retired: grouped.retired.length,
      active: grouped.today.length + grouped.soon.length,
    };
  }

  function normalizeSessionsState(sessions, today = toISODate()) {
    const source = sessions && typeof sessions === "object" && !Array.isArray(sessions) ? sessions : {};
    const todayDone = source.todayDone && typeof source.todayDone === "object" ? source.todayDone : {};
    return {
      courseId: source.courseId || COURSE_ID,
      schemaVersion: REVIEW_SCHEMA_VERSION,
      lastDate: source.lastDate || null,
      streakDays: Math.max(0, numberOr(source.streakDays, 0)),
      bestStreakDays: Math.max(0, numberOr(source.bestStreakDays, source.streakDays || 0)),
      todayDone: {
        date: todayDone.date === today ? today : today,
        reviews: todayDone.date === today ? Math.max(0, numberOr(todayDone.reviews, 0)) : 0,
        moduleStep: todayDone.date === today ? Boolean(todayDone.moduleStep) : false,
      },
      activeDays: Array.isArray(source.activeDays) ? source.activeDays.filter(Boolean).slice(-120) : [],
    };
  }

  function recordSessionActivity(sessions, activity = {}, now = new Date()) {
    const today = toISODate(now);
    const state = normalizeSessionsState(sessions, today);
    const hadActivity = Boolean(activity.moduleStep) || numberOr(activity.reviews, 0) > 0;
    if (!hadActivity) return state;

    let streak = state.streakDays;
    if (state.lastDate === today) {
      streak = Math.max(1, streak);
    } else if (state.lastDate && daysBetweenISO(state.lastDate, today) === 1) {
      streak = streak + 1;
    } else {
      streak = 1;
    }

    const activeDays = state.activeDays.includes(today)
      ? state.activeDays.slice()
      : state.activeDays.concat(today).slice(-120);

    return Object.assign({}, state, {
      lastDate: today,
      streakDays: streak,
      bestStreakDays: Math.max(state.bestStreakDays || 0, streak),
      todayDone: {
        date: today,
        reviews: Math.max(0, numberOr(state.todayDone.reviews, 0)) + Math.max(0, numberOr(activity.reviews, 0)),
        moduleStep: Boolean(state.todayDone.moduleStep || activity.moduleStep),
      },
      activeDays,
    });
  }

  function buildSessionPlan({ review, sessions, nextModule, now = new Date(), reviewOnly = false } = {}) {
    const today = toISODate(now);
    const sessionState = normalizeSessionsState(sessions, today);
    const longBreak = sessionState.lastDate && daysBetweenISO(sessionState.lastDate, today) > 7;
    const limit = longBreak ? 3 : DAILY_REVIEW_LIMIT;
    const reviews = dueReviewItems(review, today, limit);
    const moduleStep = reviewOnly ? null : (nextModule ? {
      moduleId: nextModule.id,
      title: nextModule.title || nextModule.id,
      courseId: COURSE_ID,
    } : null);
    return {
      courseId: COURSE_ID,
      date: today,
      reviewOnly: Boolean(reviewOnly),
      longBreak: Boolean(longBreak),
      reviews,
      moduleStep,
      estimatedMinutes: Math.max(3, Math.min(15, reviews.length + (moduleStep ? 10 : 0))),
    };
  }

  return {
    COURSE_ID,
    REVIEW_SCHEMA_VERSION,
    REVIEW_INTERVALS,
    DAILY_REVIEW_LIMIT,
    TODAY_REVIEW_LIMIT,
    toISODate,
    addDaysISO,
    daysBetweenISO,
    normalizeReviewState,
    normalizeReviewItem,
    diagnosticTypeFrom,
    questionReviewId,
    conceptReviewId,
    upsertWrongQuestion,
    itemFromWeakSpot,
    nextIntervalAfter,
    applyReviewAnswer,
    applyReviewResult,
    dueReviewItems,
    groupReviewItems,
    reviewStats,
    normalizeSessionsState,
    recordSessionActivity,
    buildSessionPlan,
    clone,
  };
});

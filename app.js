/* Нутрициология — тренажёр. Движок читает папки content/MXX с md-файлами. */

const TABS = [
  { file: "theory.md",   label: "Главная мысль" },
  { file: "terms.md",    label: "Термины" },
  { file: "practice.md", label: "Пример" },
  { file: "diagrams.md", label: "Схемы" },
  { file: "quiz.md",     label: "Проверить" },
  { file: "summary.md",  label: "Закрепить" },
];
const MATERIAL_FILES = ["theory.md", "terms.md", "practice.md", "diagrams.md"];
// Линейный маршрут станции. step связывает вкладку с моделью прогресса
// (stationProgressForModule), чтобы показывать её как stepper, а не равные вкладки.
const MODULE_ROUTE_TABS = [
  { file: "theory.md", label: "Понять", files: ["theory.md", "terms.md"], icon: "book", tone: "info", step: "understand" },
  { file: "practice.md", label: "Применить", files: ["practice.md", "diagrams.md"], icon: "practice", tone: "next", step: "apply" },
  { file: "quiz.md", label: "Проверить", files: ["quiz.md"], icon: "quiz", tone: "next", step: "check" },
  { file: "summary.md", label: "Закрепить", files: ["summary.md"], icon: "summary", tone: "success", step: "anchor" },
];
const CONTENT_MANIFEST_PATH = "content/manifest.json";
// Источник истины общих констант — core/constants.js (загружается раньше app.js).
const NUTRIO_CONST = (window.NutrioConst || globalThis.NutrioConst) || {};
const QUIZ_PROGRESS_VERSION = NUTRIO_CONST.QUIZ_PROGRESS_VERSION ?? 2;
const REVIEW_SCHEMA_VERSION = NUTRIO_CONST.REVIEW_SCHEMA_VERSION ?? 2;
const COURSE_ID = NUTRIO_CONST.COURSE_ID ?? "nutrition";
const MIGRATION_TIMEOUT_MS = 4000;
const CONTENT_FETCH_TIMEOUT_MS = 4000;
// Источник истины — core/review.js (review.js загружается раньше app.js).
const TODAY_REVIEW_LIMIT = (window.NutrioReview || globalThis.NutrioReview)?.TODAY_REVIEW_LIMIT ?? 5;
const SAFETY_NOTE = "Учебный материал. Не заменяет врача, диагностику, лечение или индивидуальные рекомендации по питанию.";
const PROFILE_LEVELS = {
  beginner: "Новичок",
  familiar: "Уже изучал",
  review: "Повторяю",
};

const $screen = document.getElementById("screen");
const $tabs = document.getElementById("tabs");
const $title = document.getElementById("title");
const $back = document.getElementById("back-btn");
const $profile = document.getElementById("profile-btn");

let homeEffectsCleanup = null;
let modules = [];          // [{ id: "M01", title: "...", files: { "theory.md": text } }]
let current = null;        // открытый модуль
let course = null;         // карта фаз из content/course.json (опционально)
let contentManifest = null; // индекс модулей и файлов из content/manifest.json (опционально)
let readingProgressCleanup = null;
let appStateCache = defaultAppState();
let deferredInstallPrompt = null;
let pwaStatusTimer = null;

function setScreenMode(mode) {
  if (!document.body?.classList) return;
  for (const className of ["mode-home", "mode-module", "mode-profile", "mode-session", "mode-atlas"]) {
    document.body.classList.remove(className);
  }
  if (mode) document.body.classList.add(`mode-${mode}`);
}

// A11y: при смене экрана переводим фокус на его заголовок, иначе фокус остаётся
// в body и навигация с клавиатуры/скринридера теряет контекст.
function focusScreenStart() {
  if (!$screen || typeof $screen.querySelector !== "function") return;
  const target = $screen.querySelector("h1, h2") || $screen;
  if (!target || typeof target.focus !== "function") return;
  if (typeof target.setAttribute === "function" &&
      (typeof target.getAttribute !== "function" || !target.getAttribute("tabindex"))) {
    target.setAttribute("tabindex", "-1");
  }
  target.focus({ preventScroll: true });
}

function cleanupHomeEffects() {
  if (homeEffectsCleanup) homeEffectsCleanup();
  homeEffectsCleanup = null;
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function effectsReduced() {
  return prefersReducedMotion() || Boolean(profileCache?.quietMode);
}

function applyQuietMode() {
  if (document.body?.classList) document.body.classList.toggle("quiet", Boolean(profileCache?.quietMode));
}

function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return "не спится?";
  if (hour < 12) return "доброе утро.";
  if (hour < 18) return "добрый день.";
  return "добрый вечер.";
}

function liveClockText() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

function todayISO() {
  return reviewApi().toISODate(new Date());
}

async function withTimeoutFallback(promise, timeoutMs, fallback, label = "operation") {
  if (!promise || typeof promise.then !== "function") return promise;
  const timeout = new Promise((resolve) => {
    setTimeout(() => {
      console.warn(`Nutrio timeout: ${label}`);
      resolve(fallback);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (error) {
    console.warn(`Nutrio ${label} failed`, error);
    return fallback;
  }
}

async function fetchWithTimeout(path, timeoutMs = CONTENT_FETCH_TIMEOUT_MS) {
  if (!globalThis.fetch) return null;
  if (typeof AbortController === "undefined") {
    try {
      return await fetch(path, { cache: "no-cache" });
    } catch {
      return null;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(path, { cache: "no-cache", signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function moduleSignalNumber(mod) {
  const index = modules.findIndex((item) => item.id === mod?.id);
  return index >= 0 ? index + 1 : 1;
}

function startHomeEffects(root, summary, nextModule, sessionPlan) {
  cleanupHomeEffects();
  const cleanups = [];
  const reduced = effectsReduced();

  const clock = root.querySelector?.("[data-instrument-clock]");
  if (clock) {
    const tick = () => { clock.textContent = liveClockText(); };
    tick();
    if (typeof setInterval === "function") {
      const timer = setInterval(tick, 1000);
      cleanups.push(() => clearInterval(timer));
    }
  }

  const consoleHost = root.querySelector?.("[data-console-lines]");
  if (consoleHost) {
    const lines = machineSpeechLines(summary, nextModule, sessionPlan);
    typeConsoleLines(consoleHost, lines, reduced);
  }

  const organism = root.querySelector?.("#organism");
  if (organism) {
    const stop = startAsciiOrganism(organism, reduced);
    if (stop) cleanups.push(stop);
  }

  homeEffectsCleanup = () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function typeConsoleLines(host, lines, reduced) {
  host.innerHTML = "";
  const cursor = document.createElement("span");
  cursor.className = "cursor";

  const addLine = (index) => {
    if (index >= lines.length) {
      cursor.remove?.();
      return;
    }

    const p = document.createElement("p");
    if (index === lines.length - 1) p.className = "accent";
    const textNode = document.createElement("span");
    p.appendChild(textNode);
    p.appendChild(cursor);
    host.appendChild(p);

    const text = lines[index];
    if (reduced) {
      textNode.textContent = text;
      addLine(index + 1);
      return;
    }

    let cursorIndex = 0;
    const step = () => {
      textNode.textContent = text.slice(0, cursorIndex);
      cursorIndex += 1;
      if (cursorIndex <= text.length) setTimeout(step, 34 + Math.random() * 28);
      else setTimeout(() => addLine(index + 1), 320);
    };
    step();
  };

  addLine(0);
}

function markdownApi() {
  return window.marked || globalThis.marked;
}

function quizApi() {
  return window.NutrioQuiz || globalThis.NutrioQuiz;
}

// Единственный слой защиты HTML. marked не санитизирует сам — весь его вывод
// проходит здесь. Правило простое: allowlist безопасных тегов, всё остальное
// вырезается. Каждый шаг отвечает за один класс угроз, поэтому слой легко аудировать.
const SANITIZE_ALLOWED_TAGS = "p|br|strong|em|code|pre|ul|ol|li|blockquote|h[1-6]|hr|table|thead|tbody|tr|th|td|a|del";
const SANITIZE_DISALLOWED_TAG = new RegExp(`<\\/?(?!\\/?(${SANITIZE_ALLOWED_TAGS})\\b)[a-z][^>]*>`, "gi");

function sanitizeHtml(html) {
  let safe = String(html || "");
  // 1. Активные/встраиваемые элементы целиком (парные и одиночные теги).
  safe = safe.replace(/<\s*(script|iframe|object|embed|form|input|button|textarea|select|style|meta|link|base|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  safe = safe.replace(/<\s*(script|iframe|object|embed|form|input|button|textarea|select|style|meta|link|base|svg|math)\b[^>]*\/?\s*>/gi, "");
  // 2. Любой тег вне allowlist (например <img>, <div onclick>).
  safe = safe.replace(SANITIZE_DISALLOWED_TAG, "");
  // 3. Обработчики событий и инлайновые стили.
  safe = safe.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  safe = safe.replace(/\s+style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // 4. Опасные протоколы в ссылках/источниках и в сыром markdown.
  safe = safe.replace(/\s+(href|src|xlink:href)\s*=\s*(['"]?)\s*(javascript|data|vbscript|file):[^'"\s>]*/gi, "");
  safe = safe.replace(/\]\(\s*(javascript|data|vbscript|file):[^)]*\)/gi, "]()");
  return safe;
}

function renderMarkdown(text) {
  return sanitizeHtml(markdownApi().parse(String(text || "")));
}

function renderMarkdownInline(text) {
  return sanitizeHtml(markdownApi().parseInline(String(text || "")));
}

function startAsciiOrganism(pre, reduced) {
  const width = window.innerWidth && window.innerWidth <= 520 ? 24 : 46;
  const height = window.innerWidth && window.innerWidth <= 520 ? 10 : 15;
  const chars = " ··::;+oxX%#@";
  let t = 0;

  const frame = () => {
    const mood = pre.dataset.mood || "calm";
    const pulseUntil = Number(pre.dataset.pulseUntil || 0);
    const pulse = Math.max(0, Math.min(1, (pulseUntil - Date.now()) / 1800));
    const moodSpeed = mood === "focus" ? 0.034 : mood === "glad" ? 0.068 : 0.055;
    const moodAmp = mood === "focus" ? 0.62 : mood === "dim" ? 0.48 : mood === "glad" ? 1.16 : 1;
    const density = mood === "glad" ? 18 : mood === "dim" ? 13 : 16;
    t += moodSpeed;
    let out = "";
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = ((x - width / 2) / (width / 2)) * 1.9;
        const dy = (y - height / 2) / (height / 2);
        const r = Math.sqrt(dx * dx + dy * dy);
        const a = Math.atan2(dy, dx);
        const wobble = moodAmp * (
          0.16 * Math.sin(3 * a + 1.25 * t) +
          0.11 * Math.sin(5 * a - 0.8 * t) +
          0.05 * Math.sin(8 * a + 0.5 * t)
        );
        const breathBase = mood === "focus" ? 0.70 : mood === "glad" ? 0.82 : mood === "dim" ? 0.64 : 0.74;
        const breath = breathBase + (0.10 + pulse * 0.12) * Math.sin(0.6 * t);
        const value = breath + wobble - r;
        const index = Math.max(0, Math.min(chars.length - 1, Math.floor(value * (density + pulse * 5))));
        out += chars[index];
      }
      out += "\n";
    }
    pre.textContent = out;
  };

  frame();
  if (reduced || typeof setInterval !== "function") return null;

  let timer = setInterval(frame, 90);
  const onVisibility = () => {
    if (document.hidden) {
      if (timer) clearInterval(timer);
      timer = null;
    } else if (!timer) {
      timer = setInterval(frame, 90);
    }
  };

  if (document.addEventListener) document.addEventListener("visibilitychange", onVisibility);
  return () => {
    if (timer) clearInterval(timer);
    if (document.removeEventListener) document.removeEventListener("visibilitychange", onVisibility);
  };
}

const instrumentOrganism = {
  mood(name = "calm", duration = 0) {
    const targets = document.querySelectorAll?.("#organism, .mini-organism");
    if (!targets) return;
    for (const target of targets) target.dataset.mood = name;
    if (duration > 0) {
      setTimeout(() => {
        for (const target of document.querySelectorAll?.("#organism, .mini-organism") || []) {
          if (target.dataset.mood === name) target.dataset.mood = "calm";
        }
      }, duration);
    }
  },
  pulse() {
    const until = String(Date.now() + 1800);
    for (const target of document.querySelectorAll?.("#organism, .mini-organism") || []) {
      target.dataset.pulseUntil = until;
    }
  },
};

function pluralizeSignals(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "сигнал";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сигнала";
  return "сигналов";
}

function ordinalSignal(number) {
  const words = [
    "первый", "второй", "третий", "четвёртый", "пятый", "шестой",
    "седьмой", "восьмой", "девятый", "десятый", "одиннадцатый", "двенадцатый",
    "тринадцатый", "четырнадцатый", "пятнадцатый", "шестнадцатый", "семнадцатый",
    "восемнадцатый", "девятнадцатый", "двадцатый", "двадцать первый", "двадцать второй",
    "двадцать третий", "двадцать четвёртый",
  ];
  return words[number - 1] || `${number}-й`;
}

/* ---------- storage (IndexedDB) ---------- */

let progressCache = {};
let profileCache = defaultProfile();

function storageApi() {
  if (!window.NutrioStorage) throw new Error("NutrioStorage is not loaded");
  return window.NutrioStorage;
}

function reviewApi() {
  if (!window.NutrioReview) throw new Error("NutrioReview is not loaded");
  return window.NutrioReview;
}

function setElementAttr(element, name, value) {
  if (!element) return;
  if (typeof element.setAttribute === "function") element.setAttribute(name, value);
  else element[name] = value;
}

function removeElementAttr(element, name) {
  if (!element) return;
  if (typeof element.removeAttribute === "function") element.removeAttribute(name);
  else delete element[name];
}

function defaultProfile() {
  return { name: "", goal: "", level: "beginner", startedAt: new Date().toISOString().slice(0, 10), updatedAt: "", quietMode: false };
}

function defaultAppState() {
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    review: reviewApi().normalizeReviewState(null),
    sessions: reviewApi().normalizeSessionsState(null),
  };
}

function normalizeProfile(profile) {
  const fallback = defaultProfile();
  const source = profile && typeof profile === "object" ? profile : {};
  return {
    name: source.name || "",
    goal: source.goal || "",
    level: PROFILE_LEVELS[source.level] ? source.level : fallback.level,
    startedAt: source.startedAt || fallback.startedAt,
    updatedAt: source.updatedAt || "",
    quietMode: Boolean(source.quietMode),
  };
}

function normalizeProgress(progress) {
  return progress && typeof progress === "object" && !Array.isArray(progress) ? progress : {};
}

function normalizeAppState(state) {
  const source = state && typeof state === "object" && !Array.isArray(state) ? state : {};
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    review: reviewApi().normalizeReviewState(source.review),
    sessions: reviewApi().normalizeSessionsState(source.sessions),
  };
}

async function refreshProfileCache() {
  profileCache = normalizeProfile(await storageApi().getProfile());
  return profileCache;
}

async function refreshProgressCache() {
  progressCache = normalizeProgress(await storageApi().getAllProgress());
  return progressCache;
}

async function refreshStorageCache() {
  const [profile, progress, appState] = await Promise.all([
    storageApi().getProfile(),
    storageApi().getAllProgress(),
    storageApi().getAppState(),
  ]);
  profileCache = normalizeProfile(profile);
  progressCache = normalizeProgress(progress);
  appStateCache = normalizeAppState(appState);
  applyQuietMode();
}

function loadProgress() {
  return progressCache;
}

function loadProfile() {
  return profileCache;
}

function loadReviewState() {
  return appStateCache.review || reviewApi().normalizeReviewState(null);
}

function loadSessionState() {
  return appStateCache.sessions || reviewApi().normalizeSessionsState(null);
}

async function saveProfile(profile) {
  const next = normalizeProfile({
    name: String(profile.name || "").trim(),
    goal: String(profile.goal || "").trim(),
    level: profile.level,
    startedAt: profile.startedAt,
    updatedAt: new Date().toISOString(),
    quietMode: profile.quietMode,
  });
  await storageApi().saveProfile(next);
  profileCache = next;
  applyQuietMode();
}

async function saveAppState(nextState) {
  const normalized = normalizeAppState(nextState);
  appStateCache = await storageApi().saveAppState(normalized);
  appStateCache = normalizeAppState(appStateCache);
  return appStateCache;
}

async function saveReviewState(review) {
  return saveAppState(Object.assign({}, appStateCache, { review }));
}

async function saveSessionState(sessions) {
  return saveAppState(Object.assign({}, appStateCache, { sessions }));
}

async function recordLearningActivity(activity) {
  const sessions = reviewApi().recordSessionActivity(loadSessionState(), activity, new Date());
  await saveSessionState(sessions);
}

async function migrateReviewStateFromProgress() {
  const existingIds = new Set(loadReviewState().items.map((item) => item.id));
  const migrated = loadReviewState();
  let changed = false;

  for (const [moduleId, moduleProgress] of Object.entries(loadProgress())) {
    const spots = moduleProgress?.weakSpots;
    if (!spots || typeof spots !== "object") continue;
    for (const spot of Object.values(spots)) {
      const item = reviewApi().itemFromWeakSpot(moduleId, spot, new Date());
      if (!item || existingIds.has(item.id)) continue;
      migrated.items.push(item);
      existingIds.add(item.id);
      changed = true;
    }
  }

  if (
    changed ||
    migrated.schemaVersion !== REVIEW_SCHEMA_VERSION ||
    migrated.courseId !== COURSE_ID
  ) {
    await saveReviewState(migrated);
  }
}

async function resetProfile() {
  if (!confirm("Сбросить локальный профиль? Прогресс курса останется на месте.")) return;
  await storageApi().resetProfile();
  profileCache = defaultProfile();
  await showProfile();
}

function modProgress(id) {
  return loadProgress()[id] || {};
}

async function setModProgress(id, patch) {
  await storageApi().saveModuleProgress(id, patch);
  progressCache = Object.assign({}, progressCache, { [id]: await storageApi().getModuleProgress(id) });
}

async function replaceModProgress(id, nextModProgress) {
  await storageApi().replaceModuleProgress(id, nextModProgress);
  progressCache = Object.assign({}, progressCache, { [id]: await storageApi().getModuleProgress(id) });
}

function getWeakSpots(id) {
  return modProgress(id).weakSpots || {};
}

function getWeakSpotCount(id) {
  return Object.keys(getWeakSpots(id)).length;
}

function getModuleReviewItems(id, options = {}) {
  const today = todayISO();
  return loadReviewState().items
    .filter((item) => item.courseId === COURSE_ID && item.moduleId === id)
    .filter((item) => options.includeRetired || !item.retired)
    .filter((item) => !options.dueOnly || (item.due && item.due <= today));
}

function getActiveReviewCount(id) {
  return getModuleReviewItems(id).length;
}

function getDueReviewCount(id) {
  return getModuleReviewItems(id, { dueOnly: true }).length;
}

function isQuizCompletedProgress(pr) {
  return pr?.quizBest != null && pr.quizVersion === QUIZ_PROGRESS_VERSION;
}

function isQuizInProgress(pr) {
  return pr?.quizAttemptStatus === "in-progress";
}

function getVisibleWeakSpotCount(id) {
  const pr = modProgress(id);
  if (!isQuizCompletedProgress(pr)) return 0;
  return getActiveReviewCount(id) || getWeakSpotCount(id);
}

async function updateWeakSpot(id, q, isRight, chosenKey = null) {
  const mp = Object.assign({}, modProgress(id));
  const spots = Object.assign({}, mp.weakSpots || {});
  const key = String(q.number);
  const diagnosis = diagnoseQuestion(q, chosenKey, isRight);

  if (isRight) {
    delete spots[key];
  } else {
    const prev = spots[key] || {};
    const mistakeType = diagnosis.mistakeType;
    const diagnosticType = diagnosticTypeFromText(mistakeType);
    const reviewStrategy = "Ответить на новый вопрос с тем же типом рассуждения.";
    spots[key] = {
      number: q.number,
      text: plainText(q.text).slice(0, 220),
      level: diagnosis.level.label,
      levelKey: diagnosis.level.key,
      mistakeType,
      diagnosticType,
      userLabel: mistakeType,
      shortExplanation: diagnosis.repair,
      reviewStrategy,
      repair: diagnosis.repair,
      misses: (prev.misses || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
  }

  mp.weakSpots = spots;
  await replaceModProgress(id, mp);

  if (!isRight) {
    const nextReview = reviewApi().upsertWrongQuestion(loadReviewState(), {
      moduleId: id,
      question: q,
      diagnosis,
      text: plainText(q.text).slice(0, 260),
      diagnosticType: diagnosticTypeFromText(diagnosis.mistakeType),
      userLabel: diagnosis.mistakeType,
      shortExplanation: diagnosis.repair,
      reviewStrategy: "Ответить на новый вопрос с тем же типом рассуждения.",
      repair: diagnosis.repair,
    }, new Date());
    await saveReviewState(nextReview);
  }
}

/* ---------- загрузка контента ---------- */

async function fetchText(path) {
  const res = await fetchWithTimeout(path);
  if (!res || !res.ok) return null;
  try {
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchJson(path) {
  const txt = await fetchText(path);
  if (!txt) return null;
  try { return JSON.parse(txt); } catch { return null; }
}

async function loadCourse() {
  return await fetchJson("content/course.json");
}

async function loadContentManifest() {
  return await fetchJson(CONTENT_MANIFEST_PATH);
}

function moduleIdsFromCourse(courseMap) {
  const ids = [];
  const seen = new Set();
  for (const phase of courseMap?.phases || []) {
    for (const id of phase.modules || []) {
      if (typeof id === "string" && !seen.has(id)) {
        ids.push(id);
        seen.add(id);
      }
    }
  }
  return ids;
}

function normalizeManifestModules(manifest, courseMap) {
  if (manifest && Array.isArray(manifest.modules)) {
    return manifest.modules
      .filter((item) => item && typeof item.id === "string")
      .map((item) => ({
        id: item.id,
        title: item.title || item.id,
        files: {},
      }));
  }

  return moduleIdsFromCourse(courseMap).map((id) => ({ id, title: id, files: {} }));
}

async function discoverModules(manifest, courseMap) {
  const indexed = normalizeManifestModules(manifest, courseMap);

  for (const mod of indexed) {
    if (mod.title && mod.title !== mod.id) continue;
    const theory = await fetchText(`content/${mod.id}/theory.md`);
    if (!theory) continue;
    const m = theory.match(/^#\s*M\d+\s*[—-]\s*(.+)$/m);
    mod.title = m ? m[1].trim() : mod.id;
    mod.files["theory.md"] = theory;
  }

  return indexed;
}

// Группирует найденные модули по фазам из course.json.
// Модули вне карты фаз не теряются — попадают в группу «Другие модули».
function getModuleGroups() {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const groups = [];
  const used = new Set();

  if (course && Array.isArray(course.phases)) {
    for (const phase of course.phases) {
      const mods = (phase.modules || []).map((id) => byId.get(id)).filter(Boolean);
      if (!mods.length) continue;
      for (const m of mods) used.add(m.id);
      groups.push({ title: phase.title, subtitle: phase.subtitle || "", modules: mods });
    }
  }

  const leftovers = modules.filter((m) => !used.has(m.id));
  if (leftovers.length) {
    groups.push({ title: groups.length ? "Другие модули" : "Модули", subtitle: "", modules: leftovers });
  }
  return groups;
}

function phaseProgressLabel(mods) {
  let startedStations = 0;
  let completedStations = 0;
  let quizzes = 0;
  let ratioSum = 0;
  for (const m of mods) {
    const score = moduleCompletionScore(m);
    const pr = modProgress(m.id);
    if (score > 0 || isQuizInProgress(pr)) startedStations++;
    if (score === 3) completedStations++;
    if (isQuizCompletedProgress(pr) && pr.quizTotal) {
      quizzes++;
      ratioSum += pr.quizBest / pr.quizTotal;
    }
  }
  const parts = [`станции ${completedStations}/${mods.length}`];
  if (startedStations > completedStations) parts.push(`в работе ${startedStations - completedStations}`);
  if (quizzes) parts.push(`проверка ${quizzes}/${mods.length} · ${Math.round((ratioSum / quizzes) * 100)}%`);
  return parts.join(" · ");
}

function moduleCompletionScore(mod) {
  const pr = modProgress(mod.id);
  let done = 0;
  if (pr.theoryRead) done++;
  if (pr.takeaway) done++;
  if (isQuizCompletedProgress(pr)) done++;
  return done;
}

function moduleCompletionPercent(mod) {
  return Math.round((moduleCompletionScore(mod) / 3) * 100);
}

function phaseCompletionSteps(mods) {
  return mods.reduce((sum, mod) => sum + moduleCompletionScore(mod), 0);
}

function phaseCompletionPercent(mods) {
  if (!mods.length) return 0;
  const total = phaseCompletionSteps(mods);
  return Math.round((total / (mods.length * 3)) * 100);
}

function findNextModule() {
  return modules.find((mod) => {
    const pr = modProgress(mod.id);
    return !pr.theoryRead ||
      !pr.takeaway ||
      !isQuizCompletedProgress(pr);
  }) || null;
}

function primaryActionLabel(mod) {
  const pr = modProgress(mod.id);
  if (getDueReviewCount(mod.id)) return `Закрепить ${mod.id}`;
  if (isQuizInProgress(pr)) return `Продолжить проверку ${mod.id}`;
  if (pr.theoryRead || pr.takeaway || isQuizCompletedProgress(pr)) return `Продолжить станцию ${mod.id}`;
  return `Начать станцию ${mod.id}`;
}

function moduleStateLabel(mod) {
  const pr = modProgress(mod.id);
  const weakCount = getDueReviewCount(mod.id);
  if (weakCount) return `Закрепить ${weakCount}`;
  if (moduleCompletionScore(mod) === 3) return "Закреплено";
  if (isQuizInProgress(pr)) return "Проверка";
  if (pr.theoryRead || pr.takeaway || isQuizCompletedProgress(pr)) return "В работе";
  return "Не начат";
}

function iconSvg(name, className = "ui-icon") {
  const icons = {
    arrow: `<path d="M5 12h13"/><path d="m13 6 6 6-6 6"/>`,
    book: `<path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21V5.5Z"/><path d="M5 5.5V21"/><path d="M9 7h6"/><path d="M9 10h7"/>`,
    terms: `<path d="M4 6h16"/><path d="M7 6v12"/><path d="M4 18h10"/><path d="M14 12h6"/><path d="M16 9v6"/>`,
    quiz: `<path d="M8 4h8l3 3v13H5V4h3Z"/><path d="M15 4v4h4"/><path d="m8 13 2 2 4-5"/><path d="M8 18h7"/>`,
    practice: `<path d="M5 19 19 5"/><path d="m14 5 5 5"/><path d="M5 19l4-1 10-10-3-3L6 15l-1 4Z"/>`,
    diagram: `<circle cx="6" cy="7" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 8.5 11 16"/><path d="M16 8.5 13 16"/><path d="M8 7h8"/>`,
    summary: `<path d="M5 5h14v14H5z"/><path d="M8 9h8"/><path d="M8 13h6"/><path d="M8 17h4"/>`,
    review: `<path d="M7 7h7a4 4 0 1 1-3.2 6.4"/><path d="M7 7h4"/><path d="M7 7v4"/><path d="M8 17h8"/>`,
    check: `<path d="m5 12 4 4L19 6"/>`,
    alert: `<path d="M12 4 3 20h18L12 4Z"/><path d="M12 9v5"/><path d="M12 17h.01"/>`,
    idea: `<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8 14a6 6 0 1 1 8 0c-.7.6-1 1.4-1 2H9c0-.6-.3-1.4-1-2Z"/>`,
    nutrient: `<circle cx="12" cy="12" r="3"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="m18.4 5.6-2.1 2.1"/><path d="m7.7 16.3-2.1 2.1"/>`,
    plate: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M19 5v14"/><path d="M5 5v14"/>`,
    profile: `<circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/>`,
    target: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/>`,
  };
  return `<svg class="${className}" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.book}</svg>`;
}

function brandMarkSvg(className = "brand-mark-svg") {
  return `<svg class="${className}" aria-hidden="true" viewBox="0 0 72 72" fill="none">` +
    `<rect x="4" y="4" width="64" height="64" rx="18" fill="currentColor" opacity=".12"/>` +
    `<path d="M19 45c13 2 27-5 33-23-17-1-31 6-33 23Z" fill="currentColor" opacity=".18"/>` +
    `<path d="M20 45c13 2 26-5 32-22-17-1-30 6-32 22Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="M25 42c7-5 14-10 22-14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="22" cy="24" r="4" fill="currentColor"/>` +
    `<circle cx="50" cy="49" r="4" fill="currentColor"/>` +
    `<path d="M23 24c8 5 17 13 27 25" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".55"/>` +
    `</svg>`;
}

function heroDiagramSvg() {
  return `<svg class="hero-diagram" aria-hidden="true" viewBox="0 0 280 170" fill="none">` +
    `<path class="hero-diagram-path" d="M64 86c30-56 122-56 152 0 18 34-8 62-76 62S46 120 64 86Z"/>` +
    `<circle class="hero-node hero-node-info" cx="72" cy="88" r="26"/>` +
    `<circle class="hero-node hero-node-success" cx="140" cy="48" r="26"/>` +
    `<circle class="hero-node hero-node-review" cx="208" cy="88" r="26"/>` +
    `<path class="hero-line" d="M97 77c16-16 27-23 43-29 16 6 27 13 43 29"/>` +
    `<path class="hero-line" d="M96 101c28 25 60 25 88 0"/>` +
    `<path class="hero-mark" d="M65 89h14"/><path class="hero-mark" d="M72 82v14"/>` +
    `<path class="hero-mark" d="m132 48 6 6 12-14"/>` +
    `<path class="hero-mark" d="M199 88h18"/><path class="hero-mark" d="M204 81l-5 7 5 7"/><path class="hero-mark" d="M212 81l5 7-5 7"/>` +
    `</svg>`;
}

function setButtonContent(button, label, iconName = "arrow") {
  button.textContent = label;
  button.innerHTML = `${iconSvg(iconName, "btn-icon")}<span>${escapeHtml(label)}</span>`;
}

function safetyNoteHtml() {
  return `<p class="safety-note">${escapeHtml(SAFETY_NOTE)}</p>`;
}

function tabVisual(file) {
  return {
    "theory.md": { icon: "book", tone: "info" },
    "terms.md": { icon: "terms", tone: "info" },
    "quiz.md": { icon: "quiz", tone: "next" },
    "practice.md": { icon: "practice", tone: "next" },
    "diagrams.md": { icon: "diagram", tone: "info" },
    "summary.md": { icon: "summary", tone: "success" },
    "__review__": { icon: "review", tone: "review" },
  }[file] || { icon: "book", tone: "next" };
}

function tabIconHtml(visual) {
  const tone = escapeHtmlAttribute(visual?.tone || "next");
  return `<span class="tab-glyph tab-glyph-${tone}" aria-hidden="true">${iconSvg(visual?.icon || "book", "tab-icon")}</span>`;
}

function isMaterialFile(file) {
  return MATERIAL_FILES.includes(file);
}

function contentTabByFile(file) {
  return TABS.find((tab) => tab.file === file) || { file, label: file };
}

function firstAvailableRouteFile(mod, routeTab) {
  return routeTab.files.find((file) => mod?.files?.[file] !== null) || routeTab.file;
}

function moduleRouteTabForFile(file) {
  if (file === "__review__") return { file: "__review__", label: "Память", files: ["__review__"], icon: "review", tone: "review" };
  return MODULE_ROUTE_TABS.find((tab) => tab.files.includes(file)) || contentTabByFile(file);
}

function availableMaterialTabs(mod) {
  return TABS.filter((tab) => isMaterialFile(tab.file) && mod?.files?.[tab.file] !== null);
}

function availableStationBlockTabs(mod, file) {
  const routeTab = moduleRouteTabForFile(file);
  const files = routeTab.files || [file];
  return TABS.filter((tab) => files.includes(tab.file) && mod?.files?.[tab.file] !== null);
}

function stationCompletionFile(mod) {
  const materialTabs = availableMaterialTabs(mod);
  return materialTabs.at(-1)?.file || "theory.md";
}

function shouldShowStationCompletionControls(mod, file) {
  return isMaterialFile(file) && file === stationCompletionFile(mod);
}

function stripMarkdownSyntax(text) {
  return plainText(String(text || "")
    .replace(/\|/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/#+\s*/g, "")
  );
}

function suggestedTakeawayFromSummary(mod) {
  const source = mod?.files?.["summary.md"] || "";
  const lines = String(source).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const blockquote = lines
    .filter((line) => line.startsWith(">"))
    .map((line) => stripMarkdownSyntax(line))
    .find((line) => line.length >= 48);
  if (blockquote) return compactLearningNoteText(blockquote, 220);

  const bodyLine = lines
    .filter((line) => !line.startsWith("#") && !/^\|?\s*-{3,}/.test(line))
    .map((line) => stripMarkdownSyntax(line))
    .find((line) => line.length >= 48);
  if (bodyLine) return compactLearningNoteText(bodyLine, 220);

  return `${mod?.title || mod?.id || "Станция"}: главный вывод сохранён для повторного просмотра.`;
}

function metricHtml(tone, iconName, value, label) {
  return `<div class="metric ${tone}">${iconSvg(iconName, "metric-icon")}<strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
}

function progressActiveModuleHtml(mod, sessionPlan = null) {
  if (!mod) {
    return `<section class="progress-active-module is-complete">` +
      `<div><span>Курс</span><strong>Все станции закрыты</strong></div>` +
      `<p>Новые темы для закрепления появятся здесь, если после повторения останутся ошибки.</p>` +
    `</section>`;
  }

  const pr = modProgress(mod.id);
  const steps = [
    { label: "Понять", done: Boolean(pr.theoryRead), active: !pr.theoryRead },
    { label: "Применить", done: Boolean(pr.theoryRead), active: pr.theoryRead && !isQuizCompletedProgress(pr) },
    { label: "Проверить", done: isQuizCompletedProgress(pr), active: pr.theoryRead && !isQuizCompletedProgress(pr) },
    { label: "Закрепить", done: Boolean(pr.takeaway), active: isQuizCompletedProgress(pr) && !pr.takeaway },
  ];
  const state = moduleCompletionScore(mod) > 0 || isQuizInProgress(pr) ? "в работе" : "следующий";
  const planText = sessionPlan ? sessionMetaText(sessionPlan, mod) : continueLabel(mod);
  return `<section class="progress-active-module">` +
    `<div><span>${escapeHtml(mod.id)} · ${escapeHtml(state)}</span><strong>${escapeHtml(mod.title)}</strong></div>` +
    `<p>${escapeHtml(planText)}</p>` +
    `<div class="progress-active-steps">` +
      steps.map((step) => `<span class="${step.done ? "done" : step.active ? "active" : ""}">${escapeHtml(step.label)}</span>`).join("") +
    `</div>` +
  `</section>`;
}

const CONCEPT_LEVELS = [
  {
    key: "nutrient",
    label: "Нутриент",
    note: "вещество",
    description: "Что именно делает молекула или класс веществ.",
  },
  {
    key: "product",
    label: "Продукт",
    note: "матрица",
    description: "Как вещество находится в реальной пище.",
  },
  {
    key: "ration",
    label: "Рацион",
    note: "паттерн",
    description: "Как выбор повторяется в общей картине питания.",
  },
];

function ConceptTrail(activeKey = "product", options = {}) {
  const activeIndex = Math.max(0, CONCEPT_LEVELS.findIndex((item) => item.key === activeKey));
  const classes = ["concept-trail"];
  if (options.compact) classes.push("concept-trail-compact");
  if (options.className) classes.push(options.className);

  return `<div class="${classes.join(" ")}" aria-label="Нутриент, продукт, рацион">` +
    CONCEPT_LEVELS.map((item, index) => {
      const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "idle";
      return `<span class="concept-node concept-${item.key} ${state}">` +
        `<strong>${escapeHtml(item.label)}</strong>` +
        `<small>${escapeHtml(item.note)}</small>` +
      `</span>`;
    }).join("") +
    `</div>`;
}

function LearningNote({ title, body, tone = "note", className = "" }) {
  const note = document.createElement("div");
  note.className = ["learning-note", `learning-note-${tone}`, className].filter(Boolean).join(" ");
  note.innerHTML =
    `<div class="learning-note-title">${escapeHtml(title)}</div>` +
    `<p>${escapeHtml(body)}</p>`;
  return note;
}

function KeyIdeaBlock(text) {
  return LearningNote({
    title: "Ключевой сигнал",
    body: text,
    tone: "key",
    className: "key-idea-block section-memory",
  });
}

function TypicalMistakeBlock(text) {
  return LearningNote({
    title: "Типичная ошибка",
    body: text,
    tone: "mistake",
    className: "typical-mistake-block section-memory",
  });
}

function RememberBlock(text) {
  return LearningNote({
    title: "Запомнить",
    body: text,
    tone: "remember",
    className: "section-memory",
  });
}

function SourceCards(items) {
  if (!items.length) return null;

  const wrap = document.createElement("div");
  wrap.className = "source-cards";
  for (const item of items) {
    const card = document.createElement("a");
    card.className = "source-card";
    card.href = item.url;
    card.target = "_blank";
    card.rel = "noopener noreferrer";
    card.innerHTML =
      `<span>${escapeHtml(item.source)}</span>` +
      `<strong>${escapeHtml(item.title)}</strong>` +
      `<small>${escapeHtml(item.host)}</small>`;
    wrap.appendChild(card);
  }
  return wrap;
}

function QuizDiagnosis({ question, chosenKey, isRight }) {
  const diagnosis = diagnoseQuestion(question, chosenKey, isRight);
  const chosen = question.options?.find((opt) => opt.key === chosenKey);
  const correct = question.options?.find((opt) => opt.key === question.answer);
  const block = document.createElement("div");
  block.className = `quiz-diagnosis ${isRight ? "is-right" : "is-wrong"}`;
  setElementAttr(block, "role", "status");
  setElementAttr(block, "aria-live", "polite");
  const icon = isRight ? "✓" : "×";
  const verdict = isRight ? "Верно" : "Не совсем";
  const head =
    `<div class="quiz-diagnosis-head">` +
      `<span class="feedback-mark" aria-hidden="true">${icon}</span>` +
      `<div>` +
        `<span>${verdict}</span>` +
        `<strong>${escapeHtml(diagnosis.summary)}</strong>` +
      `</div>` +
    `</div>`;
  const grid =
    `<div class="quiz-diagnosis-grid">` +
      `<div><span>Уровень вопроса</span><strong>${escapeHtml(diagnosis.level.label)}</strong><p>${escapeHtml(diagnosis.level.description)}</p></div>` +
      `<div><span>${isRight ? "Что закрепить" : "Что спуталось"}</span><strong>${escapeHtml(diagnosis.mistakeType)}</strong><p>${escapeHtml(diagnosis.repair)}</p></div>` +
    `</div>`;
  const answerCompare = !isRight
    ? `<div class="quiz-diagnosis-compare">` +
        `<div><span>Ваш ответ</span><strong>${chosen ? renderMarkdownInline(chosen.text) : "—"}</strong></div>` +
        `<div><span>Правильный ответ</span><strong>${correct ? renderMarkdownInline(correct.text) : "—"}</strong></div>` +
        `<div class="quiz-diagnosis-why"><span>Почему</span><p>${escapeHtml(diagnosis.repair)}</p></div>` +
      `</div>`
    : "";
  const explain = question.explain.trim()
    ? `<div class="quiz-diagnosis-explain-body">${renderMarkdown(question.explain.trim())}</div>`
    : "";
  if (isRight) {
    // Верный ответ — короткая фиксация, подробный разбор спрятан под раскрытие.
    block.innerHTML = head +
      `<details class="quiz-diagnosis-more"><summary>Разбор и что закрепить</summary>${grid}${explain}</details>`;
  } else {
    block.innerHTML = head + answerCompare + grid +
      (explain ? `<details class="quiz-diagnosis-explain"><summary>Подробнее</summary>${explain}</details>` : "");
  }
  return block;
}

function ReviewAddedLine() {
  const line = document.createElement("div");
  line.className = "review-added-line";
  setElementAttr(line, "role", "status");
  setElementAttr(line, "aria-live", "polite");
  line.textContent = "→ сохранено в очередь повторения. вернётся завтра.";
  return line;
}

function courseMapSegments(nextModule = null, interactive = true) {
  return modules.map((mod, index) => {
    const score = moduleCompletionScore(mod);
    const weakCount = getDueReviewCount(mod.id);
    const state = weakCount ? "review" : score === 3 ? "complete" : score > 0 ? "active" : "idle";
    const isNext = nextModule?.id === mod.id && state === "idle";
    const hint = `${mod.id} · ${mod.title} · ${isNext ? "Следующий" : moduleStateLabel(mod)}`;
    const attrs = `class="course-map-segment ${state}${isNext ? " next" : ""}" data-module-id="${escapeHtml(mod.id)}" style="--segment-delay: ${index * 10}ms" title="${escapeHtml(hint)}" aria-label="${escapeHtml(hint)}"`;
    return interactive
      ? `<button type="button" ${attrs}></button>`
      : `<span ${attrs} role="img"></span>`;
  }).join("");
}

function bindCourseMap(root) {
  const map = typeof root?.querySelector === "function" ? root.querySelector(".course-map") : null;
  if (!map) return;
  map.onclick = runAsync((event) => {
    const segment = event?.target?.closest?.(".course-map-segment");
    const mod = segment ? modules.find((m) => m.id === segment.dataset.moduleId) : null;
    if (mod) return showModule(mod);
  });
}

function moduleTheme(mod) {
  const index = Math.max(0, Number(String(mod?.id || "").replace(/\D/g, "")) - 1);
  const themes = [
    { icon: "nutrient", tone: "info" },
    { icon: "target", tone: "success" },
    { icon: "plate", tone: "next" },
    { icon: "diagram", tone: "info" },
    { icon: "practice", tone: "review" },
    { icon: "summary", tone: "success" },
  ];
  return themes[index % themes.length];
}

function formatScore(score) {
  if (score === "—") return "—";
  if (typeof score === "string" && score.includes("%")) return score;
  return `${score}%`;
}

function completedSignalCount() {
  return modules.filter((mod) => moduleCompletionScore(mod) === 3).length;
}

function signalCounterText(count) {
  return `${String(count).padStart(2, "0")}/${String(modules.length || 0).padStart(2, "0")}`;
}

function phaseMiniCells(mods, nextModule) {
  return mods.map((mod) => {
    const score = moduleCompletionScore(mod);
    const state = getDueReviewCount(mod.id) ? "review" : score === 3 ? "on" : nextModule?.id === mod.id ? "now" : "";
    return `<i class="${state}" aria-hidden="true"></i>`;
  }).join("");
}

function phaseLedgerRows(nextModule) {
  return getModuleGroups().map((group, index) => {
    const done = group.modules.filter((mod) => moduleCompletionScore(mod) === 3).length;
    const isDone = done === group.modules.length;
    const isActive = !isDone && group.modules.some((mod) => mod.id === nextModule?.id || moduleCompletionScore(mod) > 0);
    const stateText = isDone ? "закрыта" : isActive ? `идёт · ${done}/${group.modules.length}` : `0/${group.modules.length}`;
    return (
      `<div class="phase instrument-phase ${isActive ? "is-active" : ""}">` +
        `<span class="phase-num">${String(index + 1).padStart(2, "0")}</span>` +
        `<span>${escapeHtml(String(group.title || "").replace(/^Фаза\s*\d+\s*[—-]\s*/i, "").toLowerCase())}</span>` +
        `<span class="phase-state ${isDone ? "done" : isActive ? "now" : ""}">` +
          `<span class="phase-cells">${phaseMiniCells(group.modules, nextModule)}</span>${escapeHtml(stateText)}` +
        `</span>` +
      `</div>`
    );
  }).join("");
}

const SPEECH_POOLS = {
  morning: [
    "доброе утро.",
    "утро тихое. можно начать мягко.",
    "свет включён не полностью.",
    "память проснулась раньше нас.",
    "прибор слушает утро.",
  ],
  day: [
    "добрый день.",
    "день держит ровный сигнал.",
    "можно идти без спешки.",
    "прибор на месте.",
    "сигналы лежат спокойно.",
  ],
  evening: [
    "добрый вечер.",
    "вечер подходит для короткого сеанса.",
    "свет стал ниже.",
    "прибор говорит тише.",
    "день можно закрыть малым шагом.",
  ],
  night: [
    "не спится?",
    "ночной режим. мягко.",
    "прибор почти шепчет.",
    "темнота держит контур.",
    "один короткий сигнал и хватит.",
  ],
  queue: [
    "память чиста. можно вперёд.",
    "сигналы ждут своей минуты.",
    "несколько сигналов хотят вернуться.",
    "очередь памяти видна.",
    "повторение просит немного света.",
  ],
  progress: [
    "фаза идёт. спокойно.",
    "след курса ровный.",
    "шаги собираются без шума.",
    "карта курса не торопит.",
    "прибор помнит маршрут.",
  ],
  streak: [
    "серия идёт одной строкой.",
    "ты вернулся. это главное.",
    "след дня зафиксирован.",
    "малый шаг тоже светится.",
    "начнём заново.",
  ],
  break: [
    "давно не виделись. начнём мягко.",
    "сначала три старых сигнала.",
    "пыль не страшна. просто снимем её.",
    "прибор не упрекает.",
    "вернёмся с малого.",
  ],
  complete: [
    "двадцать четыре из двадцати четырёх.",
    "курс закрыт. прибор греется тише.",
    "маршрут собран полностью.",
    "сигналы курса стоят ровно.",
    "прибор горд, насколько умеет.",
  ],
};

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function speechPick(poolName, seedParts = "") {
  const pool = SPEECH_POOLS[poolName] || SPEECH_POOLS.day;
  const seed = `${todayISO()}|${poolName}|${seedParts}`;
  return pool[hashString(seed) % pool.length];
}

function timeSpeechPool() {
  const hour = new Date().getHours();
  if (hour < 5) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "day";
  return "evening";
}

function machineSpeechLines(summary, nextModule, sessionPlan) {
  const sessions = loadSessionState();
  const daysSinceLast = sessions.lastDate ? reviewApi().daysBetweenISO(sessions.lastDate, todayISO()) : 0;
  const stationCount = `${summary.completedStations}/${summary.totalStations}`;
  const lines = [`> маршрут: ${stationCount} станций закрыто${nextModule ? `, следующий ${nextModule.id}` : ""}.`];

  if (!nextModule && !summary.weakSpotTotal) {
    lines.push("> память: слабых мест нет, курс можно поддерживать короткими повторами.");
  } else if (daysSinceLast > 7) {
    lines.push(`> пауза: ${daysSinceLast} дней. начнём с короткого шага без долга.`);
  } else if (sessionPlan?.reviews?.length) {
    lines.push(`> память: ${sessionPlan.reviews.length} ${pluralizeSignals(sessionPlan.reviews.length)} на сегодня, не больше короткой сессии.`);
  } else {
    lines.push("> память: на сегодня чисто.");
  }

  if (sessions.streakDays > 1) {
    lines.push(`> ритм: ${sessions.streakDays}-й день подряд. следующий шаг уже выбран.`);
  } else if (nextModule) {
    lines.push(`> фокус: ${stationIdForModule(nextModule)} — понять, проверить, сохранить вывод.`);
  } else {
    lines.push("> фокус: вернуться к журналу или поддерживающему повторению.");
  }
  return lines.slice(0, 3);
}

function homeRouteStatusHtml(summary, nextModule, sessionPlan) {
  const completed = signalCounterText(summary.completedStations || 0);
  const memory = summary.dueReviewTotal
    ? `${summary.dueReviewTotal} ${pluralizeWeakSpots(summary.dueReviewTotal)} сегодня`
    : "память чиста";
  const next = sessionPlan?.reviews?.length
    ? `короткая сессия памяти · до ${TODAY_REVIEW_LIMIT} сигналов`
    : nextModule
      ? `${stationIdForModule(nextModule)} · ${nextModule.title}`
      : "курс закрыт · поддерживать ритм";
  return `<div class="organism-caption">` +
    `<span>контур маршрута</span>` +
    `<strong>${escapeHtml(completed)} · ${escapeHtml(memory)}</strong>` +
    `<small>${escapeHtml(next)}</small>` +
  `</div>`;
}

function buildCurrentSessionPlan(nextModule = findNextModule(), reviewOnly = false) {
  return reviewApi().buildSessionPlan({
    review: loadReviewState(),
    sessions: loadSessionState(),
    nextModule,
    now: new Date(),
    reviewOnly,
  });
}

function sessionButtonLabel(plan, nextModule) {
  const count = plan?.reviews?.length || 0;
  if (count && plan.moduleStep) return `сеанс: ${count} ${pluralizeRepeats(count)} + ${plan.moduleStep.moduleId} ▸`;
  if (count) return `повторить ${count} ${pluralizeWeakSpots(count)} ▸`;
  if (nextModule) return `${moduleCompletionScore(nextModule) > 0 || isQuizInProgress(modProgress(nextModule.id)) ? "продолжить" : "начать"} ${nextModule.id} ▸`;
  return "курс завершён";
}

function sessionMetaText(plan, nextModule) {
  const count = plan?.reviews?.length || 0;
  if (count && plan.moduleStep) return `${count} ${pluralizeWeakSpots(count)} на повторение, затем ${plan.moduleStep.moduleId} · ~${plan.estimatedMinutes} мин`;
  if (count) return `${count} ${pluralizeWeakSpots(count)} на повторение · новая станция не нужна`;
  if (nextModule) return `Повторов пока нет. Следующий шаг — ${nextModule.id}.`;
  return "курс пройден · слабые места можно повторять в любой момент";
}

function stationIdForModule(mod) {
  return `${mod?.id || "M00"}.1`;
}

function stationForModule(mod) {
  if (!mod) return null;
  return {
    id: stationIdForModule(mod),
    moduleId: mod.id,
    title: mod.title || mod.id,
    estimatedMinutes: 6,
    sourceContent: mod.files || {},
  };
}

function stationStepForModule(mod) {
  const pr = modProgress(mod.id);
  if (!pr.theoryRead) return { key: "understand", label: "Понять", detail: "прочитать короткий учебный блок" };
  if (!isQuizCompletedProgress(pr)) return { key: "check", label: "Проверить", detail: "ответить на вопросы проверки" };
  if (!pr.takeaway) return { key: "anchor", label: "Закрепить", detail: "сформулировать итог станции" };
  return { key: "completed", label: "Завершено", detail: "станция закрыта" };
}

function stationProgressForModule(mod) {
  const pr = modProgress(mod.id);
  const completedSteps = [];
  if (pr.theoryRead) completedSteps.push("understand", "apply");
  if (isQuizCompletedProgress(pr)) completedSteps.push("check");
  if (pr.takeaway) completedSteps.push("anchor");
  return {
    stationId: stationIdForModule(mod),
    currentStep: stationStepForModule(mod).key,
    completedSteps,
    checkCompleted: isQuizCompletedProgress(pr),
    takeawaySaved: Boolean(pr.takeaway),
    weakSpotIds: Object.keys(pr.weakSpots || {}),
    completedAt: pr.takeawayUpdatedAt || null,
  };
}

function stationIsStarted(mod) {
  const pr = modProgress(mod.id);
  return Boolean(pr.theoryRead || pr.takeaway || isQuizInProgress(pr) || isQuizCompletedProgress(pr));
}

function stationIsCompleted(mod) {
  return moduleCompletionScore(mod) === 3;
}

function completedStationCount() {
  return modules.filter(stationIsCompleted).length;
}

function diagnosticTypeFromText(value) {
  if (typeof reviewApi().diagnosticTypeFrom === "function") return reviewApi().diagnosticTypeFrom(value);
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "mixed_reasoning";
}

function weakSpotLearningCard(item) {
  const text = plainText(item?.text || "");
  const level = item?.level || conceptLevelFromText(text).label;
  const mistakeType = item?.mistakeType || item?.userLabel || "Смешение уровней анализа";
  const userLabel = item?.userLabel || mistakeType;
  const shortExplanation = item?.shortExplanation || item?.repair ||
    (level
      ? `Проверьте, на каком уровне сделан вывод: ${level.toLowerCase()}.`
      : "Сначала определите уровень вопроса, затем делайте вывод.");
  const reviewStrategy = item?.reviewStrategy ||
    (item?.kind === "concept"
      ? "Сформулировать правило своими словами и проверить, где оно применяется."
      : "Ответить на новый вопрос с тем же типом рассуждения.");

  return {
    diagnosticType: item?.diagnosticType || diagnosticTypeFromText(mistakeType),
    userLabel,
    shortExplanation,
    reviewStrategy,
    sourceText: text,
    level,
  };
}

function weakSpotLabel(item) {
  return weakSpotLearningCard(item).userLabel || "слабое место";
}

function buildAtlasNodes(nextModule = findNextModule()) {
  const nodes = [];
  for (const group of getModuleGroups()) {
    nodes.push({
      id: group.title,
      type: "phase",
      title: group.title,
      subtitle: group.subtitle || "",
      progress: phaseCompletionPercent(group.modules),
    });
    for (const mod of group.modules) {
      const station = stationForModule(mod);
      const due = getDueReviewCount(mod.id);
      const weak = getVisibleWeakSpotCount(mod.id);
      const completed = stationIsCompleted(mod);
      const inProgress = stationIsStarted(mod);
      nodes.push({
        id: station.id,
        type: "station",
        moduleId: mod.id,
        title: station.title,
        status: due ? "repeat_today" : weak ? "has_weak_spots" : completed ? "completed" : inProgress ? "in_progress" : nextModule?.id === mod.id ? "next" : "not_started",
        progress: moduleCompletionPercent(mod),
      });
    }
  }
  return nodes;
}

function buildTodayAction(summary = getProgressSummary(), nextModule = findNextModule()) {
  const dueReviews = reviewApi().dueReviewItems(loadReviewState(), new Date(), TODAY_REVIEW_LIMIT);
  const nextStation = stationForModule(nextModule);

  if (dueReviews.length) {
    const labels = dueReviews.slice(0, 3).map(weakSpotLabel);
    return {
      type: "repeat",
      title: `Повторить ${dueReviews.length} ${pluralizeWeakSpots(dueReviews.length)}`,
      description: "Срок повторения наступил. Сначала закрепляем то, что уже возвращалось с ошибкой.",
      estimatedTime: approxMinutes(Math.max(4, Math.min(6, dueReviews.length * 2))),
      primaryCta: "Начать повторение",
      reason: "Повторение важнее нового материала, когда срок уже наступил.",
      reviews: dueReviews,
      targetRoute: "memory",
      weakLabels: labels,
      afterAction: nextStation ? `После этого: ${nextStation.id} · ${nextStation.title}` : "После этого: курс можно поддерживать через память и журнал",
    };
  }

  if (nextModule && nextStation) {
    const started = stationIsStarted(nextModule);
    const step = stationStepForModule(nextModule);
    return {
      type: started ? "continue_station" : "start_station",
      title: `${started ? "Продолжить" : "Начать"} ${nextStation.id} · ${nextStation.title}`,
      description: `${step.label}: ${step.detail}.`,
      estimatedTime: approxMinutes(nextStation.estimatedMinutes),
      primaryCta: started ? "Продолжить" : "Начать",
      reason: started ? "Есть незавершённая учебная станция." : "Повторов на сегодня нет, можно открыть следующий учебный шаг.",
      module: nextModule,
      station: nextStation,
      stationProgress: stationProgressForModule(nextModule),
      targetRoute: "station",
    };
  }

  return {
    type: "course_complete",
    title: "Курс завершён",
    description: summary.weakSpotTotal
      ? "Основной маршрут закрыт. Сейчас полезнее поддерживать слабые места."
      : "Основной маршрут закрыт. Можно пересмотреть журнал выводов или вернуться к карте курса.",
    estimatedTime: "свободный режим",
    primaryCta: summary.weakSpotTotal ? "Открыть память" : "Открыть журнал",
    reason: "Новых обязательных станций нет.",
    targetRoute: summary.weakSpotTotal ? "memory" : "journal",
  };
}

async function runTodayAction(action) {
  if (action?.type === "repeat") {
    return startLearningSession({ reviewOnly: true, items: action.reviews || [] });
  }
  if ((action?.type === "continue_station" || action?.type === "start_station") && action.module) {
    return showModule(action.module);
  }
  if (action?.targetRoute === "memory") {
    const firstWeak = getProgressSummary().weakModules[0];
    const mod = firstWeak ? modules.find((item) => item.id === firstWeak.id) : null;
    if (mod) return openModuleReview(mod);
  }
  if (action?.targetRoute === "journal") {
    return showProfile({ focus: "journal" });
  }
  return showProfile();
}

function todayWeakListHtml(action) {
  if (!action?.weakLabels?.length) return "";
  const rows = action.weakLabels.map((label, index) =>
    `<li><span>${index + 1}</span>${escapeHtml(label)}</li>`
  ).join("");
  return `<ol class="today-weak-list">${rows}</ol>`;
}

function formatShortDate(iso) {
  if (!iso) return "";
  const [year, month, day] = String(iso).slice(0, 10).split("-");
  if (!year || !month || !day) return String(iso);
  return `${day}.${month}`;
}

function signalReturnText(item) {
  if (!item || item.retired) return "→ усвоено: вопрос ушёл из очереди повторения.";
  if (item.interval === 1) return "→ вернётся завтра.";
  return `→ вернётся через ${item.interval} ${pluralizeDays(item.interval)}.`;
}

// Дата возврата + текущий интервал — карточка слабого места как объект с ритмом.
function memoryReturnLabel(item) {
  if (!item || item.retired) return "усвоено · ушло из очереди";
  const interval = item.interval || 1;
  return `вернётся ${formatShortDate(item.due)} · интервал ${interval} ${pluralizeDays(interval)}`;
}

function pluralizeDays(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "дня";
  return "дней";
}

function pluralizeRepeats(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "повторение";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "повторения";
  return "повторений";
}

/* ---------- экран: Today ---------- */

async function showHome() {
  resetReadingProgress();
  cleanupHomeEffects();
  setScreenMode("home");
  current = null;
  $title.textContent = "Сегодня";
  $back.classList.add("hidden");
  $profile.classList.remove("hidden");
  $profile.classList.remove("active");
  $tabs.classList.add("hidden");
  await refreshStorageCache();
  $screen.innerHTML = "";

  if (!modules.length) {
    $screen.innerHTML = `<div class="loading">Модули не найдены. Запустите приложение через локальный HTTP-сервер из папки проекта.</div>`;
    return;
  }

  const summary = getProgressSummary();
  const nextModule = findNextModule();
  const sessionPlan = buildCurrentSessionPlan(nextModule);
  const todayAction = buildTodayAction(summary, nextModule);
  const stationTotal = modules.length;
  const stationCompleted = completedStationCount();
  updateProfileButton(summary);

  const intro = document.createElement("section");
  intro.className = "intro-card today-screen";
  intro.innerHTML =
    `<section class="home-learning-lead rise">` +
      `<p class="home-product-label">SOMNENIE · маршрут</p>` +
      `<h2>Сегодня</h2>` +
      `<p>Следующий короткий шаг уже выбран: понять тему, проверить себя или вернуться к слабому месту.</p>` +
    `</section>` +
    `<section class="next next-step-card today-card rise">` +
      `<p class="ask">${escapeHtml(todayAction.reason)}</p>` +
      `<h3>${escapeHtml(todayAction.title)}</h3>` +
      `<p class="meta">${escapeHtml(todayAction.description)}</p>` +
      todayWeakListHtml(todayAction) +
      `<p class="today-estimate">${escapeHtml(todayAction.estimatedTime)}</p>` +
      (todayAction.afterAction ? `<p class="next-step-why">${escapeHtml(todayAction.afterAction)}</p>` : "") +
    `</section>` +
    `<header class="instrument-statusbar rise">` +
      `<span class="led" aria-hidden="true"></span>` +
      `<span class="instrument-brand">SOMNENIE</span>` +
      `<span class="instrument-path">маршрут/сегодня/следующий-шаг</span>` +
      `<span class="instrument-clock" data-instrument-clock>--:--:--</span>` +
    `</header>` +
    `<div class="organism-wrap rise" aria-label="Контур учебного маршрута"><pre id="organism" aria-hidden="true"></pre>${homeRouteStatusHtml(summary, nextModule, sessionPlan)}</div>` +
    `<section class="console rise" aria-live="polite" aria-label="Состояние прибора"><div data-console-lines></div></section>` +
    `<nav class="home-atlas-foot rise" aria-label="Карта курса">` +
      `<button type="button" class="atlas-link home-atlas-link">Карта курса · ${stationCompleted}/${stationTotal} учебных станций</button>` +
    `</nav>` +
    safetyNoteHtml();

  const actions = document.createElement("div");
  actions.className = "home-actions";

  const actionBtn = document.createElement("button");
  actionBtn.className = "btn compact btn-with-icon today-primary-action";
  setButtonContent(actionBtn, todayAction.primaryCta, "arrow");
  actionBtn.onclick = runAsync(() => runTodayAction(todayAction));
  actions.appendChild(actionBtn);

  const nextStepCard = typeof intro.querySelector === "function"
    ? intro.querySelector(".next-step-card")
    : null;
  if (nextStepCard) {
    const secondary = nextStepCard.querySelector(".next-step-why");
    nextStepCard.insertBefore(actions, secondary || null);
  }
  else intro.appendChild(actions);

  const atlasLink = intro.querySelector?.(".atlas-link");
  if (atlasLink) atlasLink.onclick = runAsync(showAtlas);

  $screen.appendChild(intro);
  startHomeEffects(intro, summary, nextModule, sessionPlan);
  focusScreenStart();
}

async function showAtlas() {
  resetReadingProgress();
  cleanupHomeEffects();
  setScreenMode("atlas");
  current = null;
  $title.textContent = "Карта курса";
  $back.classList.remove("hidden");
  $profile.classList.remove("hidden");
  $profile.classList.remove("active");
  $tabs.classList.add("hidden");
  await refreshStorageCache();
  $screen.innerHTML = "";

  const summary = getProgressSummary();
  const nextModule = findNextModule();
  const stationTotal = modules.length;
  const stationCompleted = completedStationCount();
  const stationPercent = stationTotal ? Math.round((stationCompleted / stationTotal) * 100) : 0;
  updateProfileButton(summary);
  const atlasNodes = buildAtlasNodes(nextModule);

  const head = document.createElement("section");
  head.className = "intro-card atlas-screen";
  head.innerHTML =
    `<section class="home-learning-lead rise">` +
      `<p class="home-product-label">ATLAS</p>` +
      `<h2>Карта курса</h2>` +
      `<p>Ориентация по маршруту. Следующее действие всё равно выбирает экран «Сегодня».</p>` +
    `</section>` +
    `<section class="matrix-block home-progress-compact rise" aria-label="Карта курса">` +
      `<div class="course-map instrument-matrix" aria-label="Карта прогресса по станциям: клик открывает станцию">${courseMapSegments(nextModule, true)}</div>` +
      `<div class="matrix-foot">` +
        `<span class="map-legend"><i class="legend-complete"></i>завершён <i class="legend-active"></i>в работе <i class="legend-review"></i>повторить <i class="legend-idle"></i>не начат</span>` +
      `</div>` +
      `<div class="home-progress-text${stationPercent ? "" : " is-empty"}"><strong>${stationPercent}%</strong><span>${stationCompleted}/${stationTotal} учебных станций завершено</span></div>` +
      `<div class="course-progress" aria-label="Прогресс курса по завершённым станциям"><span style="width: ${stationPercent}%"></span></div>` +
    `</section>` +
    `<p class="atlas-meta">${atlasNodes.filter((node) => node.type === "station" && node.status === "repeat_today").length} станций требуют повторения сегодня · ${summary.weakSpotTotal} слабых мест в памяти</p>`;
  $screen.appendChild(head);
  bindCourseMap(head);

  let phaseNumber = 0;
  for (const group of getModuleGroups()) {
    phaseNumber++;
    const phasePercent = phaseCompletionPercent(group.modules);
    const doneModules = group.modules.filter((mod) => moduleCompletionScore(mod) === 3).length;
    const header = document.createElement("section");
    header.className = "phase-header";
    header.innerHTML =
      `<div class="phase-kicker">Фаза ${phaseNumber} · ${doneModules}/${group.modules.length} станций</div>` +
      `<h2>${escapeHtml(group.title)}</h2>` +
      (group.subtitle ? `<p class="phase-subtitle">${escapeHtml(group.subtitle)}</p>` : "") +
      `<div class="phase-progressbar" aria-hidden="true"><span style="width: ${phasePercent}%"></span></div>`;
    $screen.appendChild(header);

    for (const mod of group.modules) $screen.appendChild(moduleCard(mod, nextModule));
  }
  focusScreenStart();
}

function moduleCard(mod, nextModule = null) {
  const pr = modProgress(mod.id);
  const parts = [];
  const weakCount = getVisibleWeakSpotCount(mod.id);
  const rawWeakCount = getWeakSpotCount(mod.id);
  const completion = moduleCompletionPercent(mod);
  const theme = moduleTheme(mod);
  const isNext = nextModule?.id === mod.id;
  if (pr.theoryRead) parts.push("понять/применить ✓");
  if (isQuizCompletedProgress(pr)) parts.push(`проверка ${pr.quizBest}/${pr.quizTotal}`);
  else if (isQuizInProgress(pr)) parts.push(`проверка ${pr.quizAnswered || 0}/${pr.quizTotalQuestions || "?"}`);
  if (pr.takeaway) parts.push("закрепить ✓");
  if (weakCount) parts.push(`закрепить ${weakCount}`);
  else if (rawWeakCount && isQuizInProgress(pr)) parts.push(`${rawWeakCount} ошибка сохранена`);

  const card = document.createElement("button");
  const stateClass = weakCount
    ? "module-card-review"
    : completion === 100
      ? "module-card-complete"
      : completion > 0
        ? "module-card-active"
        : isNext
          ? "module-card-next"
          : "";
  card.className = "module-card";
  if (stateClass) card.classList.add(stateClass);
  card.classList.add(`module-theme-${theme.tone}`);
  card.innerHTML =
    `<div class="module-card-head">` +
    `<span class="module-visual module-visual-${theme.tone}">${iconSvg(theme.icon, "module-visual-icon")}</span>` +
    `<div class="module-title-block">` +
    `<div class="module-card-top">` +
    `<span class="mod-id">${mod.id}</span>` +
    `<span class="module-state">${isNext && moduleStateLabel(mod) === "Не начат" ? "Следующий" : moduleStateLabel(mod)}</span>` +
    `</div>` +
    `<div class="mod-title">${escapeHtml(mod.title)}</div>` +
    `</div>` +
    `</div>` +
    `<div class="module-steps" aria-hidden="true">` +
    `<span class="${pr.theoryRead ? "done" : ""}">${iconSvg("book", "step-icon")}Понять</span>` +
    `<span class="${pr.theoryRead ? "done" : ""}">${iconSvg("practice", "step-icon")}Применить</span>` +
    `<span class="${isQuizCompletedProgress(pr) ? "done" : isQuizInProgress(pr) ? "active" : ""}">${iconSvg("quiz", "step-icon")}Проверить</span>` +
    `<span class="${pr.takeaway ? "done" : ""}">${iconSvg("summary", "step-icon")}Закрепить</span>` +
    `</div>` +
    (parts.length ? `<div class="mod-progress">${parts.join(" · ")}</div>` : "") +
    `<div class="module-progressbar" aria-hidden="true"><span style="width: ${completion}%"></span></div>`;
  card.onclick = runAsync(() => showModule(mod));
  return card;
}

function appendHomeReview(summary) {
  if (!summary.weakModules.length) return;

  const section = document.createElement("section");
  section.className = "home-review";
  section.innerHTML =
    `<div class="section-kicker">Memory</div>` +
    `<h2>Память слабых мест</h2>` +
    `<p class="muted">Слабые места возвращаются по расписанию. Сегодняшние попадают в короткую сессию, остальные ждут своей даты.</p>`;

  const list = document.createElement("div");
  list.className = "review-module-list";

  for (const item of summary.weakModules.slice(0, 4)) {
    const mod = modules.find((m) => m.id === item.id);
    if (!mod) continue;

    const button = document.createElement("button");
    button.className = "review-module";
    button.innerHTML =
      `<span>${escapeHtml(item.id)}</span>` +
      `<strong>${escapeHtml(item.title)}</strong>` +
      `<em>${item.dueCount ? `${item.dueCount} сегодня · ` : ""}${item.count} ${pluralizeWeakSpots(item.count)} в памяти</em>` +
      (item.topMistake ? `<span class="review-mistake">слабое место: ${escapeHtml(item.topMistake.toLowerCase())}</span>` : "");
    button.onclick = runAsync(() => openModuleReview(mod));
    list.appendChild(button);
  }

  section.appendChild(list);
  $screen.appendChild(section);
}

function pluralizeQuestions(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "вопрос";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "вопроса";
  return "вопросов";
}

function pluralizeWeakSpots(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "слабое место";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "слабых места";
  return "слабых мест";
}

function pluralizeMinutes(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "минута";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "минуты";
  return "минут";
}

function approxMinutes(count) {
  return `≈ ${count} ${pluralizeMinutes(count)}`;
}

function streakLine(sessions) {
  const days = sessions.streakDays || 0;
  const best = sessions.bestStreakDays || days || 0;
  if (!days) return `серия: начнём заново · лучший след: ${best}`;
  return `серия: ${days} ${pluralizeDays(days)} · лучший след: ${best}`;
}

function memoryDayCells(sessions) {
  const active = new Set(sessions.activeDays || []);
  const today = todayISO();
  let html = "";
  for (let i = 29; i >= 0; i--) {
    const day = reviewApi().addDaysISO(today, -i);
    const state = active.has(day) ? "on" : day === today ? "today" : "";
    html += `<i class="${state}" title="${escapeHtml(day)}" aria-hidden="true"></i>`;
  }
  return html;
}

async function showProfile(options = {}) {
  resetReadingProgress();
  cleanupHomeEffects();
  setScreenMode("profile");
  current = null;
  $title.textContent = "Прогресс обучения";
  $back.classList.remove("hidden");
  $profile.classList.add("hidden");
  $profile.classList.add("active");
  $tabs.classList.add("hidden");
  await refreshStorageCache();
  $screen.innerHTML = "";

  const profile = loadProfile();
  const summary = getProgressSummary();
  const nextModule = findNextModule();
  const sessions = loadSessionState();
  const reviewStats = reviewApi().reviewStats(loadReviewState(), new Date());
  const sessionPlan = buildCurrentSessionPlan(nextModule);

  const form = document.createElement("section");
  form.className = "profile-card";
  form.innerHTML =
    `<h2>Профиль ученика</h2>` +
    `<p class="muted">Локальный учебный профиль. Здесь нет медицинских параметров, рационов и персональных рекомендаций.</p>`;

  const nameLabel = createFieldLabel("Имя или ник");
  const nameInput = document.createElement("input");
  nameInput.className = "profile-input";
  nameInput.value = profile.name;
  nameInput.placeholder = "Например, Diego";

  const goalLabel = createFieldLabel("Цель обучения");
  const goalInput = document.createElement("textarea");
  goalInput.className = "profile-input profile-textarea";
  goalInput.value = profile.goal;
  goalInput.placeholder = "Например, разобраться в доказательной нутрициологии без мифов.";

  const levelLabel = createFieldLabel("Уровень");
  const levelSelect = document.createElement("select");
  levelSelect.className = "profile-input";
  for (const [value, label] of Object.entries(PROFILE_LEVELS)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === profile.level;
    levelSelect.appendChild(option);
  }

  const startLabel = createFieldLabel("Дата старта");
  const startInput = document.createElement("input");
  startInput.className = "profile-input";
  startInput.type = "date";
  startInput.value = profile.startedAt;

  const quietLabel = document.createElement("label");
  quietLabel.className = "profile-label quiet-toggle";
  const quietInput = document.createElement("input");
  quietInput.className = "quiet-checkbox";
  quietInput.type = "checkbox";
  quietInput.checked = Boolean(profile.quietMode);
  const quietText = document.createElement("span");
  quietText.textContent = "Тихий режим: без скан-линий, зерна и анимаций";
  quietLabel.append(quietInput, quietText);

  const save = document.createElement("button");
  save.className = "btn";
  save.textContent = "Сохранить профиль";

  const reset = document.createElement("button");
  reset.className = "btn secondary danger";
  reset.textContent = "Сбросить профиль";
  reset.onclick = runAsync(resetProfile);

  const status = document.createElement("div");
  status.className = "save-status";

  save.onclick = runAsync(async () => {
    await saveProfile({
      name: nameInput.value,
      goal: goalInput.value,
      level: levelSelect.value,
      startedAt: startInput.value,
      quietMode: quietInput.checked,
    });
    status.textContent = "Профиль сохранён";
  });

  form.append(nameLabel, nameInput, goalLabel, goalInput, levelLabel, levelSelect, startLabel, startInput, quietLabel, save, reset, status);

  const dashboard = document.createElement("section");
  dashboard.className = "dashboard-card dashboard-primary";
  const dashboardMetrics = [
    metricHtml(summary.completedStations ? "success" : "empty", "check", `${summary.completedStations}/${summary.totalStations}`, "станций завершено"),
    metricHtml(summary.theoryRead ? "info" : "empty", "book", `${summary.theoryRead}/${summary.totalStations}`, "понять/применить"),
    metricHtml(summary.quizCompleted ? "next" : "empty", "quiz", `${summary.quizCompleted}/${summary.totalStations}`, "проверок"),
  ];
  if (summary.quizCompleted) dashboardMetrics.push(metricHtml("success", "target", summary.averageScore, "средний лучший балл"));
  dashboard.innerHTML =
    `<div class="section-kicker">Где я</div>` +
    `<h2>Прогресс обучения</h2>` +
    `<div class="course-map instrument-matrix profile-matrix" aria-label="Матрица прогресса по станциям: клик открывает станцию">${courseMapSegments(nextModule)}</div>` +
    `<p class="matrix-explain">Каждая клетка — учебная станция. Станция закрыта после маршрута: понять, применить, проверить, закрепить.</p>` +
    progressActiveModuleHtml(nextModule, sessionPlan) +
    `<div class="metric-grid">` +
    dashboardMetrics.join("") +
    `</div>`;

  const dashboardActions = document.createElement("div");
  dashboardActions.className = "dashboard-actions";
  if (nextModule || sessionPlan.reviews.length) {
    const continueBtn = document.createElement("button");
    continueBtn.className = "btn compact btn-with-icon";
    setButtonContent(continueBtn, sessionButtonLabel(sessionPlan, nextModule), "arrow");
    continueBtn.onclick = runAsync(() => startLearningSession());
    const nextLabel = document.createElement("span");
    nextLabel.className = "dashboard-next";
    nextLabel.textContent = `Что дальше: ${sessionMetaText(sessionPlan, nextModule)}`;
    dashboardActions.append(continueBtn, nextLabel);
  } else {
    const complete = document.createElement("div");
    complete.className = "course-complete";
    complete.textContent = "Курс пройден. Новые действия появятся, если останутся темы для закрепления.";
    dashboardActions.appendChild(complete);
  }
  dashboard.appendChild(dashboardActions);

  let phases = null;
  if (course && Array.isArray(course.phases)) {
    phases = document.createElement("section");
    phases.className = "dashboard-card";
    phases.innerHTML = `<h2>Прогресс по фазам</h2>`;
    const list = document.createElement("ol");
    list.className = "cabinet-list";
    for (const group of getModuleGroups()) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(group.title)}</strong><div class="muted">${phaseProgressLabel(group.modules)}</div>`;
      list.appendChild(li);
    }
    phases.appendChild(list);
  }

  const weak = document.createElement("section");
  weak.className = "dashboard-card";
    weak.innerHTML = `<div class="section-kicker">Memory</div><h2>Память слабых мест</h2>`;
  if (summary.weakModules.length) {
    const list = document.createElement("ol");
    list.className = "cabinet-list";
    for (const item of summary.weakModules) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${item.id}</strong> ${escapeHtml(item.title)} <span class="muted">· ${item.count} ${pluralizeWeakSpots(item.count)}${item.topMistake ? ` · ${escapeHtml(item.topMistake.toLowerCase())}` : ""}</span>`;
      list.appendChild(li);
    }
    weak.appendChild(list);
  } else {
    weak.innerHTML += `<p class="muted">Здесь появятся слабые места после проверки: тип ошибки, объяснение и стратегия повторения.</p>`;
  }

  const takeaways = document.createElement("section");
  takeaways.className = "dashboard-card";
  takeaways.id = "journal";
  takeaways.innerHTML = `<h2>История выводов</h2>`;
  if (summary.takeaways.length) {
    const list = document.createElement("ol");
    list.className = "cabinet-list";
    for (const item of summary.takeaways) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${item.id}</strong> ${escapeHtml(item.takeaway)}`;
      list.appendChild(li);
    }
    takeaways.appendChild(list);
  } else {
    takeaways.innerHTML += `<p class="muted">Сохраните первый вывод станции, чтобы собрать здесь свою историю понимания.</p>`;
  }

  const actions = document.createElement("section");
  actions.className = "dashboard-card";
  actions.innerHTML = `<h2>Данные</h2><p class="muted">Экспорт включает профиль и учебный прогресс. Сброс прогресса не удаляет профиль.</p>`;

  const exportBtn = document.createElement("button");
  exportBtn.className = "btn secondary";
  exportBtn.textContent = "Экспортировать данные";
  exportBtn.onclick = runAsync(exportProgress);

  const resetBtn = document.createElement("button");
  resetBtn.className = "btn secondary danger";
  resetBtn.textContent = "Сбросить прогресс";
  resetBtn.onclick = runAsync(resetProgress);

  actions.append(exportBtn, resetBtn);
  const pwaCard = buildPwaCard();
  $screen.appendChild(dashboard);
  bindCourseMap(dashboard);
  $screen.appendChild(weak);
  $screen.appendChild(takeaways);
  if (phases) $screen.appendChild(phases);
  $screen.appendChild(pwaCard);
  $screen.appendChild(form);
  $screen.appendChild(actions);

  if (options.focus === "journal") {
    takeaways.scrollIntoView?.({ behavior: "smooth", block: "start" });
  } else if (options.focus === "memory") {
    weak.scrollIntoView?.({ behavior: "smooth", block: "start" });
  } else {
    focusScreenStart();
  }
}

function isStandalonePwa() {
  return Boolean(
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator?.standalone === true
  );
}

function pwaConnectionText() {
  return navigator.onLine === false
    ? "Офлайн: сохранённые станции, прогресс и память доступны на этом устройстве."
    : "Онлайн: приложение проверяет обновления курса и держит офлайн-кэш готовым.";
}

function buildPwaCard() {
  const card = document.createElement("section");
  card.className = "dashboard-card pwa-card";
  const installed = isStandalonePwa();
  const canInstall = Boolean(deferredInstallPrompt) && !installed;
  card.innerHTML =
    `<div class="section-kicker">PWA</div>` +
    `<h2>Приложение и офлайн</h2>` +
    `<p class="muted">${escapeHtml(pwaConnectionText())}</p>` +
    `<ul class="pwa-capability-list">` +
      `<li>Открывается как отдельное приложение после установки.</li>` +
      `<li>Кэширует оболочку, шрифты, иконки и учебные материалы.</li>` +
      `<li>Локальный прогресс хранится на устройстве и экспортируется вручную.</li>` +
    `</ul>`;

  const actions = document.createElement("div");
  actions.className = "pwa-actions";

  const install = document.createElement("button");
  install.className = "btn compact btn-with-icon";
  if (installed) {
    setButtonContent(install, "Приложение установлено", "check");
    install.disabled = true;
  } else if (canInstall) {
    setButtonContent(install, "Установить приложение", "arrow");
    install.onclick = runAsync(triggerPwaInstall);
  } else {
    setButtonContent(install, "Установка через меню браузера", "profile");
    install.disabled = true;
  }

  const update = document.createElement("button");
  update.className = "btn secondary compact";
  update.textContent = "Проверить обновления";
  update.onclick = runAsync(checkForPwaUpdate);

  actions.append(install, update);
  card.appendChild(actions);
  return card;
}

function createFieldLabel(text) {
  const label = document.createElement("label");
  label.className = "profile-label";
  label.textContent = text;
  return label;
}

function getProgressSummary() {
  const progress = loadProgress();
  const summary = {
    totalModules: modules.length,
    totalStations: modules.length,
    totalSteps: modules.length * 3,
    completedSteps: 0,
    completedStations: 0,
    coursePercent: 0,
    theoryRead: 0,
    quizCompleted: 0,
    averageScore: "—",
    weakSpotTotal: 0,
    dueReviewTotal: 0,
    retiredReviewTotal: 0,
    weakModules: [],
    takeaways: [],
  };

  let ratioSum = 0;
  const reviewStats = reviewApi().reviewStats(loadReviewState(), new Date());
  summary.dueReviewTotal = reviewStats.dueToday;
  summary.retiredReviewTotal = reviewStats.retired;
  for (const mod of modules) {
    const pr = progress[mod.id] || {};
    const completionScore = moduleCompletionScore(mod);
    summary.completedSteps += completionScore;
    if (completionScore === 3) summary.completedStations++;
    if (pr.theoryRead) summary.theoryRead++;
    if (isQuizCompletedProgress(pr) && pr.quizTotal) {
      summary.quizCompleted++;
      ratioSum += pr.quizBest / pr.quizTotal;
    }

    const moduleReviewItems = isQuizCompletedProgress(pr) ? getModuleReviewItems(mod.id) : [];
    const reviewCount = moduleReviewItems.length;
    const fallbackSpotCount = isQuizCompletedProgress(pr) ? Object.keys(pr.weakSpots || {}).length : 0;
    const count = reviewCount || fallbackSpotCount;
    const dueCount = getDueReviewCount(mod.id);
    if (count) {
      const mistakeFreq = {};
      for (const item of moduleReviewItems) {
        const label = weakSpotLearningCard(item).userLabel;
        if (label) mistakeFreq[label] = (mistakeFreq[label] || 0) + 1;
      }
      for (const spot of Object.values(pr.weakSpots || {})) {
        const label = spot?.userLabel || spot?.mistakeType;
        if (label) mistakeFreq[label] = (mistakeFreq[label] || 0) + 1;
      }
      const topMistake = Object.entries(mistakeFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      summary.weakSpotTotal += count;
      summary.weakModules.push({ id: mod.id, title: mod.title, count, dueCount, topMistake });
    }

    if (pr.takeaway) {
      summary.takeaways.push({
        id: mod.id,
        takeaway: pr.takeaway,
        updatedAt: pr.takeawayUpdatedAt || "",
      });
    }
  }

  if (summary.quizCompleted) {
    summary.averageScore = `${Math.round((ratioSum / summary.quizCompleted) * 100)}%`;
  }
  summary.coursePercent = summary.totalStations ? Math.round((summary.completedStations / summary.totalStations) * 100) : 0;

  summary.takeaways.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  summary.takeaways = summary.takeaways.slice(0, 5);
  return summary;
}

function updateProfileButton(summary = null) {
  if (!$profile || !modules.length) return;
  const data = summary || getProgressSummary();
  const percent = data.coursePercent || 0;
  const due = data.dueReviewTotal || 0;
  if ($profile.style && typeof $profile.style.setProperty === "function") {
    $profile.style.setProperty("--profile-progress", `${percent}%`);
  }
  $profile.dataset.reviewDue = due ? "true" : "false";
  setElementAttr(
    $profile,
    "title",
    due
      ? `Прогресс ${percent}%. На сегодня ${due} ${pluralizeWeakSpots(due)} в памяти.`
      : `Прогресс ${percent}%. Открыть путь, память и журнал.`,
  );
}

async function exportProgress() {
  const data = await storageApi().exportData();
  const payload = {
    exportedAt: data.exportedAt,
    app: data.app || "nutrio-app",
    schemaVersion: data.schemaVersion || REVIEW_SCHEMA_VERSION,
    profile: normalizeProfile(data.profile),
    progress: normalizeProgress(data.progress),
    review: reviewApi().normalizeReviewState(data.review),
    sessions: reviewApi().normalizeSessionsState(data.sessions),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `nutrio-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function resetProgress() {
  if (!confirm("Сбросить весь локальный прогресс по курсу?")) return;
  await storageApi().resetProgress();
  await storageApi().resetAppState();
  progressCache = {};
  appStateCache = defaultAppState();
  if ($profile.classList.contains("active")) await showProfile();
  else await showHome();
}

/* ---------- экран: учебная станция ---------- */

async function showModule(mod) {
  resetReadingProgress();
  cleanupHomeEffects();
  setScreenMode("module");
  current = mod;
  $title.textContent = mod.id;
  if (typeof $title.setAttribute === "function") $title.setAttribute("title", mod.title);
  $back.classList.remove("hidden");
  $profile.classList.remove("hidden");
  $profile.classList.remove("active");
  $tabs.classList.remove("hidden");
  await refreshStorageCache();
  updateProfileButton();
  $tabs.innerHTML = "";
  $screen.innerHTML = `<div class="loading">Загрузка…</div>`;

  // Подгружаем недостающие файлы один раз.
  await Promise.all(TABS.map(async (t) => {
    if (!(t.file in mod.files)) mod.files[t.file] = await fetchText(`content/${mod.id}/${t.file}`);
  }));

  const tabItems = availableModuleTabItems(mod);
  for (const tab of tabItems) appendTabButton(tab);

  queueTabsOverflowHint();
  openTab(tabItems[0]?.file || "theory.md");
}

async function openModuleReview(mod) {
  await showModule(mod);
  if (getVisibleWeakSpotCount(mod.id)) openTab("__review__");
}

function openTab(file) {
  resetReadingProgress();
  syncActiveTab(file);
  window.scrollTo(0, 0);
  if (file === "quiz.md") showQuizIntro(current);
  else if (file === "__review__") showWeakSpots(current);
  else showMarkdown(current, file);
}

function appendTabButton(tab) {
  const visual = tab.icon ? tab : tabVisual(tab.file);
  const button = document.createElement("button");
  button.textContent = tab.label;
  button.className = `tab-button tab-${visual.tone}`;
  const dot = tab.step ? `<i class="tab-step-dot" aria-hidden="true"></i>` : "";
  button.innerHTML = `${dot}${tabIconHtml(visual)}<span>${escapeHtml(tab.label)}</span>`;
  button.onclick = () => openTab(tab.file);
  button.dataset.file = tab.file;
  button.dataset.files = (tab.files || [tab.file]).join("|");
  if (tab.step) button.dataset.step = tab.step;
  $tabs.appendChild(button);
}

function syncActiveTab(file) {
  for (const item of $tabs.children) {
    const tag = String(item.tagName || "").toLowerCase();
    if (tag === "select") {
      item.value = file;
    } else {
      const files = String(item.dataset.files || item.dataset.file || "").split("|");
      const isActive = files.includes(file);
      item.classList.toggle("active", isActive);
      if (isActive) setElementAttr(item, "aria-current", "page");
      else removeElementAttr(item, "aria-current");
    }
  }
  refreshStepperStatus();
}

// Станция — линейный маршрут: пройденные шаги отмечены, текущий активен,
// будущие приглушены (но кликабельны). Статусы берём из модели прогресса.
function refreshStepperStatus() {
  if (!current || !$tabs.children) return;
  const completed = stationProgressForModule(current).completedSteps;
  for (const item of $tabs.children) {
    const step = item.dataset?.step;
    if (!step) continue;
    const isActive = item.classList.contains("active");
    const isDone = completed.includes(step) && !isActive;
    item.classList.toggle("is-done", isDone);
    item.classList.toggle("is-future", !isDone && !isActive);
  }
}

function queueTabsOverflowHint() {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(updateTabsOverflowHint);
  else updateTabsOverflowHint();
}

function updateTabsOverflowHint() {
  const isScrollable = ($tabs.scrollWidth || 0) > ($tabs.clientWidth || 0) + 4;
  $tabs.classList.toggle("is-scrollable", isScrollable);
}

function availableTabs(mod) {
  return TABS.filter((tab) => mod?.files?.[tab.file] !== null);
}

function availableModuleTabItems(mod) {
  const tabs = MODULE_ROUTE_TABS
    .filter((tab) => tab.files.some((file) => mod?.files?.[file] !== null))
    .map((tab) => Object.assign({}, tab, { file: firstAvailableRouteFile(mod, tab) }));
  if (mod && getVisibleWeakSpotCount(mod.id)) return [...tabs, { file: "__review__", label: "Память", files: ["__review__"], icon: "review", tone: "review" }];
  return tabs;
}

function moduleIndex(mod) {
  return modules.findIndex((item) => item.id === mod?.id);
}

function tabStep(tab) {
  return { kind: "tab", file: tab.file, label: tab.label };
}

function moduleStep(mod) {
  return { kind: "module", mod, label: mod.id };
}

function homeStep() {
  return { kind: "home", label: "Курс" };
}

function adjacentLearningStep(mod, file, direction) {
  if (!mod) return null;

  if (file === "__review__") {
    const quiz = availableTabs(mod).find((tab) => tab.file === "quiz.md");
    return direction < 0 && quiz ? tabStep(quiz) : null;
  }

  const tabs = availableTabs(mod);
  const idx = tabs.findIndex((tab) => tab.file === file);
  if (idx === -1) return null;

  if (direction < 0) return idx > 0 ? tabStep(tabs[idx - 1]) : null;
  if (idx < tabs.length - 1) return tabStep(tabs[idx + 1]);

  const nextModule = modules[moduleIndex(mod) + 1];
  return nextModule ? moduleStep(nextModule) : homeStep();
}

async function goToLearningStep(step) {
  if (!step) return;
  if (step.kind === "tab") {
    openTab(step.file);
  } else if (step.kind === "module") {
    await showModule(step.mod);
  } else if (step.kind === "home") {
    await showHome();
  } else if (step.kind === "review") {
    await openModuleReview(step.mod);
  } else if (step.kind === "action") {
    await step.run();
  }
}

function stepButtonText(prefix, step) {
  if (step.kind === "module") return prefix === "Следующая станция" || prefix === "Следующий модуль" ? `Открыть ${step.label}` : `Продолжить ${step.label}`;
  if (step.kind === "home") return "Завершить курс";
  if (step.kind === "review") return "Открыть закрепление";
  if (step.kind === "action") return step.label;
  if (step.kind === "tab") {
    const tab = contentTabByFile(step.file);
    if (prefix === "Назад") return `Назад: ${tab.label}`;
    if (step.file === "quiz.md") return "Перейти к проверке";
    if (step.file === "summary.md") return "Закрепить вывод";
    return `Перейти к ${tabTargetLabel(step.file)}`;
  }
  return step.label || prefix;
}

function learningStepShortLabel(step) {
  if (!step) return "";
  if (step.kind === "tab") return contentTabByFile(step.file).label;
  if (step.kind === "module") return `Станция ${step.mod?.id || step.label}`;
  if (step.kind === "home") return "Сегодня";
  if (step.kind === "review") return "Закрепление";
  return step.label || "";
}

function lessonRouteContextHtml(mod, file, nextStep) {
  const route = moduleRouteTabForFile(file);
  const block = contentTabByFile(file);
  const tabs = availableTabs(mod);
  const total = Math.max(1, tabs.length + (file === "__review__" ? 1 : 0));
  const index = file === "__review__" ? total - 1 : Math.max(0, tabs.findIndex((tab) => tab.file === file));
  const current = file === "__review__"
    ? "Память слабых мест"
    : isMaterialFile(file)
      ? `${route.label} · ${block.label}`
      : route.label || block.label;
  const next = learningStepShortLabel(nextStep) || "Завершение";
  return `<div class="lesson-route">` +
    `<span class="lesson-route-kicker">Маршрут станции</span>` +
    `<strong>${escapeHtml(current)}</strong>` +
    `<span>${escapeHtml(mod.id)} · шаг ${index + 1} из ${total}</span>` +
    `<em>Дальше: ${escapeHtml(next)}</em>` +
  `</div>`;
}

function tabTargetLabel(file) {
  return {
    "theory.md": "главной мысли",
    "terms.md": "терминам",
    "practice.md": "примеру",
    "diagrams.md": "схемам",
  }[file] || contentTabByFile(file).label.toLowerCase();
}

function createLearningStepButton(step, className, prefix) {
  const button = document.createElement("button");
  button.className = className;
  setButtonContent(button, stepButtonText(prefix, step), step.kind === "review" ? "review" : "arrow");
  button.onclick = runAsync(() => goToLearningStep(step));
  return button;
}

function appendModuleNavigation(mod, file, options = {}) {
  const prev = options.includePrev === false ? null : adjacentLearningStep(mod, file, -1);
  const next = options.includeNext === false ? null : options.nextStep || adjacentLearningStep(mod, file, 1);
  const review = getVisibleWeakSpotCount(mod.id) && file !== "__review__"
    ? { kind: "review", mod, label: "Закрепление" }
    : null;
  const mobilePrimary = options.mobilePrimary || next;

  if (!prev && !next && !review && !mobilePrimary) return;

  const nav = document.createElement("section");
  nav.className = "lesson-nav";
  nav.innerHTML = lessonRouteContextHtml(mod, file, next || review || mobilePrimary);

  const actions = document.createElement("div");
  actions.className = "lesson-nav-actions";

  if (prev) actions.appendChild(createLearningStepButton(prev, "btn secondary compact lesson-nav-prev", "Назад"));
  if (review) actions.appendChild(createLearningStepButton(review, "btn secondary compact", "Открыть"));
  if (next) actions.appendChild(createLearningStepButton(next, "btn compact lesson-nav-next", next.kind === "module" ? "Следующая станция" : "Дальше"));

  nav.append(actions);

  if (mobilePrimary) {
    const sticky = createLearningStepButton(
      mobilePrimary,
      "module-next-sticky",
      mobilePrimary.kind === "module" ? "Следующая станция" : "Дальше",
    );
    nav.appendChild(sticky);
  }

  $screen.appendChild(nav);
}

function resetReadingProgress() {
  if (readingProgressCleanup) readingProgressCleanup();
  readingProgressCleanup = null;
}

function enhanceMarkdownSections(container) {
  if (!container || typeof container.querySelectorAll !== "function" || !container.childNodes) return;

  const nodes = Array.from(container.childNodes);
  const hasH2 = nodes.some((node) => isElementTag(node, "H2"));
  const boundaryTags = hasH2 ? ["H2"] : ["H3"];
  if (!nodes.some((node) => boundaryTags.some((tag) => isElementTag(node, tag)))) return;

  container.classList.add("md-sectioned");
  const cards = [];
  const titleCard = document.createElement("section");
  titleCard.className = "lesson-title-card";
  let activeCard = titleCard;

  for (const node of nodes) {
    if (isWhitespaceText(node) && !activeCard.parentNode && activeCard === titleCard) continue;

    if (boundaryTags.some((tag) => isElementTag(node, tag))) {
      activeCard = document.createElement("section");
      activeCard.className = "lesson-section-card";
      activeCard.dataset.section = String(cards.length + 1);
      cards.push(activeCard);
      container.appendChild(activeCard);
    } else if (!activeCard.parentNode) {
      container.appendChild(activeCard);
    }

    activeCard.appendChild(node);
  }

  decorateLessonCards(cards, current);
  if (cards.length) appendReadingProgress(container, cards);
}

function enhanceResponsiveTables(container) {
  if (!container || typeof container.querySelectorAll !== "function") return;

  for (const table of Array.from(container.querySelectorAll("table"))) {
    if (table.classList.contains("has-responsive-cards")) continue;
    const allRows = Array.from(table.querySelectorAll("tr"));
    if (allRows.length < 2) continue;

    const headerRow = table.querySelector("thead tr") || allRows[0];
    const headers = Array.from(headerRow.querySelectorAll("th, td"))
      .map((cell) => plainText(cell.textContent || "").trim())
      .filter(Boolean);
    if (!headers.length) continue;

    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    const rows = (bodyRows.length ? bodyRows : allRows.filter((row) => row !== headerRow))
      .map((row) => Array.from(row.querySelectorAll("th, td")))
      .filter((cells) => cells.length);
    if (!rows.length) continue;

    const cards = document.createElement("div");
    cards.className = "responsive-table-cards";
    setElementAttr(cards, "aria-label", "Таблица в виде карточек");

    for (const cells of rows) {
      const card = document.createElement("article");
      card.className = "responsive-table-card";
      // Первый столбец — ключ строки. Делаем его заголовком карточки, остальные
      // столбцы — парами «подпись: значение». Так карточка читается как объект,
      // а не как повторяющееся «Витамин: A».
      let startIndex = 0;
      if (headers.length >= 2 && cells.length >= 2) {
        const titleEl = document.createElement("h4");
        titleEl.className = "responsive-table-card-title";
        titleEl.innerHTML = cells[0].innerHTML;
        card.appendChild(titleEl);
        startIndex = 1;
      }
      for (let i = startIndex; i < cells.length; i++) {
        const row = document.createElement("div");
        row.className = "responsive-table-row";
        const label = document.createElement("span");
        label.textContent = headers[i] || `Колонка ${i + 1}`;
        const value = document.createElement("strong");
        value.innerHTML = cells[i].innerHTML;
        row.append(label, value);
        card.appendChild(row);
      }
      cards.appendChild(card);
    }

    table.classList.add("has-responsive-cards");
    table.insertAdjacentElement("afterend", cards);
  }
}

function decorateLessonCards(cards, mod) {
  let conceptTrailShown = false;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const heading = firstElementByTags(card, ["H2", "H3"]);
    const visual = lessonSectionVisual(heading?.textContent || "", i);
    if (heading && !heading.id) heading.id = `${mod?.id || "module"}-section-${i + 1}`;
    card.classList.add(`lesson-section-${visual.tone}`);

    if (visual.label === "Источники") {
      enhanceSourceSection(card);
      continue;
    }

    if (shouldShowSectionMeta(visual, i)) {
      const meta = document.createElement("div");
      meta.className = "section-meta";
      meta.textContent = `${visual.label} · Раздел ${i + 1}`;
      card.insertBefore(meta, card.firstChild);
    }

    if (!conceptTrailShown && /нутриент|продукт|рацион/i.test(heading?.textContent || "")) {
      appendConceptTrail(card, conceptLevelFromText(card.textContent).key);
      conceptTrailShown = true;
    }

    const takeaway = lessonTakeawayText(card, heading);
    if (!takeaway || !shouldShowSectionMemory(visual, i)) continue;

    const note = i === 0
      ? KeyIdeaBlock(takeaway)
      : visual.tone === "warning"
        ? TypicalMistakeBlock(takeaway)
        : RememberBlock(takeaway);
    card.appendChild(note);
  }
}

function shouldShowSectionMeta(visual, index) {
  return index === 0 || visual.tone === "warning" || visual.label === "Итог";
}

function shouldShowSectionMemory(visual, index) {
  return visual.tone === "warning" || visual.label === "Итог";
}

function appendConceptTrail(card, activeKey) {
  const holder = document.createElement("div");
  holder.innerHTML = ConceptTrail(activeKey, { compact: true, className: "reader-concept-trail" });
  const trail = holder.firstElementChild;
  if (!trail) return;

  const heading = firstElementByTags(card, ["H2", "H3"]);
  const anchor = heading?.nextSibling || card.firstChild;
  card.insertBefore(trail, anchor);
}

function enhanceSourceSection(card) {
  const list = card.querySelector("ul, ol");
  if (!list) return;

  const items = Array.from(list.querySelectorAll("li"))
    .map((li) => parseSourceItem(li.textContent || ""))
    .filter(Boolean);
  const sourceCards = SourceCards(items);
  if (!sourceCards) return;

  const deck = document.createElement("details");
  deck.className = "source-deck";
  const summary = document.createElement("summary");
  summary.className = "source-deck-summary";
  const uniqueSources = [...new Set(items.map((item) => item.source))];
  const preview = uniqueSources.slice(0, 3).join(", ");
  summary.innerHTML =
    `<span class="source-deck-count">Источники: ${items.length}</span>` +
    `<small>${escapeHtml(preview)}${uniqueSources.length > 3 ? "…" : ""}</small>` +
    `<em class="source-deck-toggle" aria-hidden="true"></em>`;
  deck.append(summary, sourceCards);
  list.replaceWith(deck);
}

function parseSourceItem(text) {
  const clean = plainText(text);
  const urls = clean.match(/https?:\/\/\S+/g) || [];
  if (!urls.length) return null;

  const firstUrl = urls[0].replace(/[.,;]+$/, "");
  const label = clean.replace(/https?:\/\/\S+/g, "").replace(/[·•|-]+\s*$/g, "").trim();
  const parts = label.split(/\s+—\s+|\s+-\s+/).filter(Boolean);
  let host = "";
  try { host = new URL(firstUrl).hostname.replace(/^www\./, ""); }
  catch { host = firstUrl; }

  return {
    source: parts[0] || host,
    title: parts.slice(1).join(" — ") || host,
    host,
    url: firstUrl,
  };
}

function conceptLevelFromText(text) {
  const clean = plainText(text).toLowerCase();
  if (/рацион|паттерн|питани[ея]\s+в\s+целом|привычн|ежедневн|меню/.test(clean)) {
    return CONCEPT_LEVELS[2];
  }
  if (/продукт|пищев|сок|фрукт|этикет|порци|тарелк|блюд/.test(clean)) {
    return CONCEPT_LEVELS[1];
  }
  if (/нутриент|веществ|молекул|витамин|минерал|белок|жир|углевод|вода|аминокислот|сахар/.test(clean)) {
    return CONCEPT_LEVELS[0];
  }
  return CONCEPT_LEVELS[1];
}

function conceptLevelFromAnswerText(text, fallbackText = "") {
  const clean = plainText(text).toLowerCase();
  if (/уровень\s+нутриент|уровень\s+вещест/.test(clean)) return CONCEPT_LEVELS[0];
  if (/уровень\s+продукт|уровень\s+пищев/.test(clean)) return CONCEPT_LEVELS[1];
  if (/уровень\s+рацион|уровень\s+паттерн/.test(clean)) return CONCEPT_LEVELS[2];
  return conceptLevelFromText(`${text || ""} ${fallbackText || ""}`);
}

function diagnoseQuestion(question, chosenKey, isRight) {
  const correct = question.options?.find((opt) => opt.key === question.answer);
  const correctText = plainText(correct?.text || "");
  const combined = `${question.text || ""} ${correctText} ${question.explain || ""}`;
  const level = conceptLevelFromAnswerText(correctText, combined);
  const clean = plainText(combined).toLowerCase();
  const chosen = question.options?.find((opt) => opt.key === chosenKey);
  const chosenText = plainText(chosen?.text || "");
  const chosenLevel = chosenText ? conceptLevelFromAnswerText(chosenText) : null;

  let mistakeType = "Смешение уровней анализа";
  let repair = "Сначала назовите уровень вопроса, потом делайте вывод.";

  if (/порци|serving|этикет/.test(clean)) {
    mistakeType = "Порция принята за рекомендацию";
    repair = "Проверьте, что именно указано: справочная порция, фактически съеденное количество или весь продукт.";
  } else if (/калори|энерг|amdr|rda|ai|диапазон|ккал/.test(clean)) {
    mistakeType = "Перепутаны ориентир и индивидуальная норма";
    repair = "Отделите справочный диапазон от персонального назначения и контекста питания.";
  } else if (/матриц|сок|фрукт|продукт/.test(clean)) {
    mistakeType = "Нутриентный состав принят за весь продукт";
    repair = "Сравните пищевую матрицу продукта, а не только отдельный нутриент.";
  }

  if (!isRight && chosenLevel && chosenLevel.key !== level.key) {
    mistakeType = `${chosenLevel.label} принят за ${level.label.toLowerCase()}`;
    repair = `Вывод сделан на уровне «${chosenLevel.label.toLowerCase()}», хотя вопрос — об уровне «${level.label.toLowerCase()}».`;
  }

  const summary = isRight
    ? `Уровень вопроса: ${level.label.toLowerCase()}.`
    : `Правильный уровень: ${level.label.toLowerCase()}.`;

  return { level, mistakeType, repair, summary };
}

function lessonSectionVisual(title, index) {
  const clean = plainText(title).toLowerCase();
  if (/ошиб|миф|риск|не\s/.test(clean)) return { icon: "alert", tone: "warning", label: "Типичная ошибка" };
  if (/пример|практик|сценар|кейс/.test(clean)) return { icon: "practice", tone: "next", label: "Пример" };
  if (/термин|понят|определ|словар/.test(clean)) return { icon: "terms", tone: "info", label: "Термины" };
  if (/схем|модел|связ|цикл/.test(clean)) return { icon: "diagram", tone: "info", label: "Схема" };
  if (/итог|вывод|резюм|запом/.test(clean)) return { icon: "summary", tone: "success", label: "Итог" };
  if (/источник|литератур|reference|source/.test(clean)) return { icon: "book", tone: "neutral", label: "Источники" };
  if (index === 0) return { icon: "idea", tone: "success", label: "Ключевой сигнал" };
  return { icon: "book", tone: "neutral", label: "Разбор" };
}

function firstElementByTags(parent, tagNames) {
  return Array.from(parent?.children || []).find((child) => tagNames.includes(child.tagName));
}

function lessonTakeawayText(card, heading) {
  const title = plainText(heading?.textContent || "");
  if (!title || /источники|литература|reference|source/i.test(title)) return "";

  const paragraph = Array.from(card.children || [])
    .find((child) => isElementTag(child, "P") && plainText(child.textContent).length >= 48);
  const source = paragraph ? paragraph.textContent : title;
  return compactLearningNoteText(source, 140);
}

function compactLearningNoteText(text, limit) {
  const clean = plainText(text);
  if (!clean) return "";
  if (clean.length <= limit) return clean;
  const sentence = clean.match(/^(.{40,}?[.!?])\s+/);
  if (sentence && sentence[1].length <= limit) return sentence[1];
  const slice = clean.slice(0, limit);
  return slice.replace(/\s+\S*$/, "").trim();
}

function trimLearningText(text, limit) {
  const clean = plainText(text);
  if (!clean) return "";
  if (clean.length <= limit) return clean;

  const slice = clean.slice(0, limit);
  const byWord = slice.replace(/\s+\S*$/, "").trim();
  return `${byWord || slice.trim()}…`;
}

function isElementTag(node, tagName) {
  return node?.nodeType === 1 && node.tagName === tagName;
}

function isWhitespaceText(node) {
  return node?.nodeType === 3 && !String(node.textContent || "").trim();
}

function appendReadingProgress(container, cards) {
  if (!cards.length || typeof container.insertBefore !== "function") return;

  const progress = document.createElement("div");
  progress.className = "reading-progress";
  setElementAttr(progress, "role", "progressbar");
  setElementAttr(progress, "aria-valuemin", "0");
  setElementAttr(progress, "aria-valuemax", "100");

  const label = document.createElement("span");
  label.className = "reading-progress-label";

  const track = document.createElement("div");
  track.className = "reading-progress-track";

  const fill = document.createElement("span");
  track.appendChild(fill);
  progress.append(label, track);
  container.insertBefore(progress, container.firstChild);

  let pending = false;
  const update = () => {
    pending = false;
    let active = 0;
    for (let i = 0; i < cards.length; i++) {
      const rect = typeof cards[i].getBoundingClientRect === "function"
        ? cards[i].getBoundingClientRect()
        : { top: i === 0 ? 0 : 9999 };
      if (rect.top <= 150) active = i;
    }

    const percent = Math.round(((active + 1) / cards.length) * 100);
    label.textContent = `Раздел ${active + 1} из ${cards.length}`;
    fill.style.width = `${percent}%`;
    progress.classList.toggle("is-scrolled", active > 0 || (window.scrollY || 0) > 80);
    setElementAttr(progress, "aria-valuenow", String(percent));
    setElementAttr(progress, "aria-valuetext", `Раздел ${active + 1} из ${cards.length}`);
    for (let i = 0; i < cards.length; i++) cards[i].classList.toggle("active", i === active);
  };

  const onScroll = () => {
    if (pending) return;
    pending = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(update);
    else update();
  };

  label.textContent = `Раздел 1 из ${cards.length}`;
  const initialPercent = Math.round((1 / cards.length) * 100);
  fill.style.width = `${initialPercent}%`;
  setElementAttr(progress, "aria-valuenow", String(initialPercent));
  setElementAttr(progress, "aria-valuetext", `Раздел 1 из ${cards.length}`);
  cards[0]?.classList.add("active");
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(update);
  else setTimeout(update, 0);
  if (window.addEventListener) {
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    readingProgressCleanup = () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }
}

function showMarkdown(mod, file) {
  const text = mod.files[file];
  if (!text) {
    $screen.innerHTML = `<div class="loading">Файл ${escapeHtml(file)} пуст или не найден.</div>`;
    return;
  }

  const div = document.createElement("div");
  div.className = "md";
  div.innerHTML = renderMarkdown(text);
  enhanceMarkdownSections(div);
  enhanceResponsiveTables(div);
  $screen.innerHTML = "";
  if (isMaterialFile(file)) $screen.appendChild(MaterialSubnav(mod, file));
  $screen.appendChild(buildModuleReadingLayout(mod, file, div));

  if (shouldShowStationCompletionControls(mod, file)) appendTheoryControls(mod, file);
  if (file === "summary.md") appendSummaryControls(mod);
  appendModuleNavigation(mod, file);
  focusScreenStart();
}

function MaterialSubnav(mod, activeFile) {
  const nav = document.createElement("nav");
  nav.className = "material-subnav";
  setElementAttr(nav, "aria-label", "Блоки учебной станции");

  const routeTab = moduleRouteTabForFile(activeFile);
  const materialTabs = availableStationBlockTabs(mod, activeFile);
  const activeIndex = Math.max(0, materialTabs.findIndex((tab) => tab.file === activeFile));

  const label = document.createElement("div");
  label.className = "material-subnav-label";
  label.textContent = `${routeTab.label} · блок ${activeIndex + 1} из ${materialTabs.length}`;
  nav.appendChild(label);

  for (const tab of materialTabs) {
    const visual = tabVisual(tab.file);
    const button = document.createElement("button");
    button.className = `material-subtab tab-${visual.tone}`;
    button.dataset.file = tab.file;
    button.innerHTML = `${tabIconHtml(visual)}<span>${escapeHtml(tab.label)}</span>`;
    if (tab.file === activeFile) {
      button.classList.add("active");
      setElementAttr(button, "aria-current", "page");
    }
    button.onclick = () => openTab(tab.file);
    nav.appendChild(button);
  }

  return nav;
}

function buildModuleReadingLayout(mod, file, content) {
  const layout = document.createElement("div");
  layout.className = "module-layout";

  const main = document.createElement("div");
  main.className = "module-main";
  main.appendChild(content);
  layout.appendChild(main);

  const aside = buildModuleSidePanel(mod, file, content);
  if (aside) layout.appendChild(aside);

  return layout;
}

function buildModuleSidePanel(mod, file, content) {
  const aside = document.createElement("aside");
  aside.className = "module-side-panel";

  const routeTab = moduleRouteTabForFile(file);
  const blockTab = contentTabByFile(file);
  const stationBlockTabs = availableStationBlockTabs(mod, file);
  const routeTabs = MODULE_ROUTE_TABS.filter((tab) => tab.files.some((routeFile) => mod?.files?.[routeFile] !== null));
  const currentRouteIndex = Math.max(0, routeTabs.findIndex((tab) => tab.files.includes(file)));
  const currentBlockIndex = Math.max(0, stationBlockTabs.findIndex((tab) => tab.file === file));
  const visual = routeTab.icon ? routeTab : tabVisual(file);
  const stepText = isMaterialFile(file)
    ? `${routeTab.label} · блок ${currentBlockIndex + 1} из ${stationBlockTabs.length}: ${blockTab.label}`
    : `Станция · шаг ${currentRouteIndex + 1} из ${routeTabs.length}`;
  aside.innerHTML =
    `<div class="side-head">` +
    `<span class="side-icon side-icon-${visual.tone}">${iconSvg(visual.icon, "side-icon-svg")}</span>` +
    `<div>` +
    `<div class="side-kicker">${escapeHtml(mod.id)}</div>` +
    `<h2>${escapeHtml(routeTab.label || file)}</h2>` +
    `</div>` +
    `</div>` +
    `<div class="side-step">${escapeHtml(stepText)}</div>` +
    `<div class="trust-note">${iconSvg("book", "trust-icon")}<span>${escapeHtml(SAFETY_NOTE)} Источники и границы применимости — в конце блока.</span></div>`;

  const headings = extractLessonHeadings(content);
  if (headings.length) {
    const tocTitle = document.createElement("div");
    tocTitle.className = "side-section-title";
    tocTitle.textContent = "Оглавление";
    const list = document.createElement("ol");
    list.className = "lesson-toc";

    const tocItems = headings.slice(0, 8);
    for (const item of tocItems) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = item.text;
      item.button = button;
      button.onclick = () => item.target.scrollIntoView({ behavior: "smooth", block: "start" });
      li.appendChild(button);
      list.appendChild(li);
    }

    aside.append(tocTitle, list);
    setupLessonTocObserver(tocItems);
  }

  const next = adjacentLearningStep(mod, file, 1);
  if (next) {
    const nextButton = createLearningStepButton(next, "side-next", next.kind === "module" ? "Следующая станция" : "Дальше");
    aside.appendChild(nextButton);
  }

  return aside;
}

function setupLessonTocObserver(items) {
  if (!items.length) return;

  const setActive = (activeItem) => {
    for (const item of items) {
      const isActive = item === activeItem;
      item.button.classList.toggle("active", isActive);
      if (isActive) setElementAttr(item.button, "aria-current", "location");
      else removeElementAttr(item.button, "aria-current");
    }
  };

  setActive(items[0]);

  if (!("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    const active = items.find((item) => item.target === visible.target);
    if (active) setActive(active);
  }, {
    rootMargin: "-18% 0px -58% 0px",
    threshold: [0.08, 0.18, 0.32],
  });

  for (const item of items) observer.observe(item.target);
}

function extractLessonHeadings(content) {
  if (!content || typeof content.querySelectorAll !== "function") return [];

  return Array.from(content.querySelectorAll(".lesson-section-card"))
    .map((card, index) => {
      const target = card.querySelector("h2, h3");
      const text = trimLearningText(String(target?.textContent || "").replace(/^M\d+\s*[—-]\s*/i, ""), 46);
      if (!target || !text) return null;
      if (!target.id) target.id = `${current?.id || "module"}-section-${index + 1}`;
      return { target: card, text };
    })
    .filter(Boolean);
}

function appendTheoryControls(mod, file) {
  const controls = document.createElement("section");
  controls.className = "study-card";

  if (modProgress(mod.id).theoryRead) {
    const note = document.createElement("div");
    note.className = "done-note";
    note.textContent = "✓ Шаги «Понять» и «Применить» закрыты";
    controls.appendChild(note);
  } else {
    const btn = document.createElement("button");
    btn.className = "btn btn-with-icon";
    setButtonContent(btn, "Завершить чтение и пример", "check");
    btn.onclick = runAsync(async () => {
      await setModProgress(mod.id, { theoryRead: true });
      await recordLearningActivity({ moduleStep: true });
      showMarkdown(mod, file);
    });
    controls.appendChild(btn);
  }

  $screen.appendChild(controls);
}

function appendSummaryControls(mod) {
  const controls = document.createElement("section");
  controls.className = "study-card";
  const progress = modProgress(mod.id);
  const suggestedTakeaway = suggestedTakeawayFromSummary(mod);
  let committedTakeaway = progress.takeaway || "";
  let draftTakeaway = progress.takeawayDraft || "";

  const label = document.createElement("label");
  label.className = "takeaway-label";
  label.textContent = "Вывод станции";

  const hint = document.createElement("p");
  hint.className = "takeaway-hint";
  hint.textContent = "Вывод сохраняется в журнал автоматически. Можно отредактировать его своими словами.";

  const textarea = document.createElement("textarea");
  textarea.className = "takeaway-input";
  textarea.placeholder = "Запишите 1-3 фразы: что теперь понятно, что применить, что повторить.";
  textarea.value = draftTakeaway || committedTakeaway || suggestedTakeaway;

  const continueBtn = document.createElement("button");
  continueBtn.className = "btn btn-with-icon";
  setButtonContent(continueBtn, "Продолжить", "arrow");

  const status = document.createElement("div");
  status.className = "save-status";

  const setStatus = (message) => {
    status.textContent = message;
    status.classList.remove("saved");
    void status.offsetWidth;
    status.classList.add("saved");
  };

  const commitTakeaway = async (value, options = {}) => {
    const takeaway = String(value || "").trim();
    if (!takeaway) return false;

    const currentProgress = modProgress(mod.id);
    const hadCommittedTakeaway = Boolean(currentProgress.takeaway || committedTakeaway);
    const currentTakeaway = currentProgress.takeaway || committedTakeaway;
    const currentDraft = currentProgress.takeawayDraft || draftTakeaway;

    if (takeaway === currentTakeaway && !currentDraft) return true;

    const now = new Date().toISOString();
    const patch = {
      takeaway,
      takeawayDraft: "",
      takeawayDraftUpdatedAt: "",
    };
    if (takeaway !== currentTakeaway || !currentProgress.takeawayUpdatedAt) {
      patch.takeawayUpdatedAt = now;
    }

    await setModProgress(mod.id, patch);
    committedTakeaway = takeaway;
    draftTakeaway = "";
    if (options.recordActivity && !hadCommittedTakeaway) {
      await recordLearningActivity({ moduleStep: true });
    }
    return true;
  };

  const saveDraft = async (value) => {
    const draft = String(value || "").trim();
    if (!draft || draft === committedTakeaway) return false;
    await setModProgress(mod.id, {
      takeawayDraft: draft,
      takeawayDraftUpdatedAt: new Date().toISOString(),
    });
    draftTakeaway = draft;
    return true;
  };

  let draftTimer = null;
  const refreshContinueState = () => {
    continueBtn.disabled = !String(textarea.value || "").trim();
  };

  textarea.oninput = () => {
    refreshContinueState();
    if (draftTimer) clearTimeout(draftTimer);

    const draft = String(textarea.value || "").trim();
    if (!draft) {
      setStatus("Пустой текст не заменяет вывод в журнале.");
      return;
    }

    if (draft === committedTakeaway) {
      setStatus("Вывод сохранён в журнале.");
      return;
    }

    status.textContent = "Сохраняю правку как черновик...";
    draftTimer = setTimeout(() => {
      draftTimer = null;
      void saveDraft(draft).then((saved) => {
        if (saved) setStatus("Правка сохранена как черновик. Нажмите «Продолжить», чтобы обновить журнал.");
      });
    }, 500);
  };

  continueBtn.onclick = runAsync(async () => {
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = null;
    }
    const committed = await commitTakeaway(textarea.value, { recordActivity: true });
    if (!committed) {
      setStatus("Пустой текст не заменяет вывод в журнале.");
      refreshContinueState();
      return;
    }
    await goToLearningStep(adjacentLearningStep(mod, "summary.md", 1));
  });

  refreshContinueState();

  if (committedTakeaway) {
    status.textContent = draftTakeaway
      ? "Есть сохранённая правка. Нажмите «Продолжить», чтобы обновить журнал."
      : "Вывод сохранён в журнале.";
  } else if (textarea.value.trim()) {
    status.textContent = "Сохраняю вывод в журнал...";
    void commitTakeaway(textarea.value, { recordActivity: true }).then((saved) => {
      if (saved) setStatus("Вывод сохранён в журнале. Можно отредактировать своими словами.");
    });
  } else {
    status.textContent = "Добавьте короткий вывод, чтобы закрыть станцию.";
  }

  controls.append(label, hint, textarea, continueBtn, status);
  $screen.appendChild(controls);
}

/* ---------- квиз: парсинг ---------- */

// Разбор тестов вынесен в core/quiz.js (чистые функции). Здесь — тонкие обёртки,
// чтобы сохранить существующие вызовы и доступ из smoke-теста как глобали.
function parseQuiz(md) {
  return quizApi().parseQuiz(md);
}

function parseAutoQuestion(number, type, body) {
  return quizApi().parseAutoQuestion(number, type, body);
}

function parseApplicationQuestion(number, body) {
  return quizApi().parseApplicationQuestion(number, body);
}

/* ---------- сеанс повторения ---------- */

async function ensureModuleFile(mod, file) {
  if (!mod) return null;
  if (!(file in mod.files)) mod.files[file] = await fetchText(`content/${mod.id}/${file}`);
  return mod.files[file];
}

async function reviewQuestionForItem(item) {
  const mod = modules.find((candidate) => candidate.id === item.moduleId);
  if (!mod || item.kind !== "question") return { mod, question: null };
  await ensureModuleFile(mod, "quiz.md");
  const questions = parseQuiz(mod.files["quiz.md"]).filter((question) => question.kind === "auto");
  const question = questions.find((candidate) => String(candidate.number) === String(item.questionNumber));
  return { mod, question };
}

function sessionProgressCells(total, index, results) {
  let html = "";
  for (let i = 0; i < total; i++) {
    const result = results[i];
    const state = result ? (result.isRight ? "done" : "miss") : i === index ? "now" : "";
    html += `<i class="${state}" aria-hidden="true"></i>`;
  }
  return html;
}

function sessionHeader(plan, index, total, results) {
  return (
    `<header class="session-head">` +
      `<pre class="mini-organism" aria-hidden="true"></pre>` +
      `<div>` +
        `<div class="section-kicker">Сеанс памяти</div>` +
        `<h2>${index < total ? `повторение ${index + 1}/${total}` : "повторение завершено"}</h2>` +
        `<p>${plan.moduleStep ? `${total} ${pluralizeRepeats(total)} + ${plan.moduleStep.moduleId}` : `${total} ${pluralizeRepeats(total)}`}</p>` +
        `<div class="session-cells">${sessionProgressCells(total, index, results)}</div>` +
      `</div>` +
    `</header>`
  );
}

function memoryLearningCardHtml(item, options = {}) {
  const memory = weakSpotLearningCard(item);
  const classes = ["memory-learning-note"];
  if (options.compact) classes.push("is-compact");
  return `<div class="${classes.join(" ")}" data-diagnostic-type="${escapeHtml(memory.diagnosticType)}">` +
    `<div class="memory-learning-kicker">слабое место</div>` +
    `<h3>${escapeHtml(memory.userLabel)}</h3>` +
    `<p>${escapeHtml(memory.shortExplanation)}</p>` +
    `<div class="memory-review-strategy">` +
      `<span>Как тренируем</span>` +
      `<strong>${escapeHtml(memory.reviewStrategy)}</strong>` +
    `</div>` +
  `</div>`;
}

function startSessionOrganism(root, mood = "focus") {
  cleanupHomeEffects();
  const mini = root.querySelector?.(".mini-organism");
  if (!mini) return;
  const stop = startAsciiOrganism(mini, effectsReduced());
  mini.dataset.mood = mood;
  homeEffectsCleanup = () => {
    if (stop) stop();
  };
}

async function startLearningSession(options = {}) {
  resetReadingProgress();
  cleanupHomeEffects();
  await refreshStorageCache();
  const nextModule = findNextModule();
  let plan = buildCurrentSessionPlan(nextModule, Boolean(options.reviewOnly));
  plan = Object.assign({}, plan, {
    reviews: plan.reviews.slice(0, TODAY_REVIEW_LIMIT),
    estimatedMinutes: Math.max(3, Math.min(8, Math.min(plan.reviews.length, TODAY_REVIEW_LIMIT) + (plan.moduleStep ? 6 : 0))),
  });

  if (Array.isArray(options.items)) {
    plan = Object.assign({}, plan, {
      reviews: options.items.slice(0, TODAY_REVIEW_LIMIT),
      reviewOnly: Boolean(options.reviewOnly),
      moduleStep: options.reviewOnly ? null : plan.moduleStep,
      estimatedMinutes: Math.max(3, Math.min(8, Math.min(options.items.length, TODAY_REVIEW_LIMIT) + (options.reviewOnly ? 0 : 6))),
    });
  }

  if (!plan.reviews.length) {
    if (!plan.reviewOnly && plan.moduleStep) {
      const mod = modules.find((item) => item.id === plan.moduleStep.moduleId);
      if (mod) return showModule(mod);
    }
    return showHome();
  }

  await showReviewSession(plan);
}

async function showReviewSession(plan) {
  setScreenMode("session");
  current = null;
  $title.textContent = "Сеанс";
  $back.classList.remove("hidden");
  $profile.classList.remove("hidden");
  $profile.classList.remove("active");
  $tabs.classList.add("hidden");
  updateProfileButton();

  const items = plan.reviews.slice(0, TODAY_REVIEW_LIMIT);
  const results = [];
  let index = 0;

  async function renderCurrent() {
    if (index >= items.length) return renderFinal();
    const item = items[index];
    const { mod, question } = await reviewQuestionForItem(item);
    $screen.innerHTML = "";
    window.scrollTo(0, 0);

    const wrap = document.createElement("section");
    wrap.className = "review-session";
    wrap.innerHTML = sessionHeader(plan, index, items.length, results);
    $screen.appendChild(wrap);
    startSessionOrganism(wrap, "focus");

    if (question) renderQuestionItem(wrap, item, mod, question);
    else renderConceptItem(wrap, item, mod);
  }

  function appendSessionNext(card) {
    const next = document.createElement("button");
    let moving = false;
    next.className = "btn quiz-next";
    setButtonContent(next, index + 1 < items.length ? "Следующее повторение" : "Завершить повторение", "arrow");
    next.onclick = runAsync(async () => {
      if (moving) return;
      moving = true;
      next.disabled = true;
      index++;
      await renderCurrent();
    });
    card.appendChild(next);
  }

  async function applySessionAnswer(item, isRight) {
    const nextReview = reviewApi().applyReviewResult(loadReviewState(), item.id, isRight, new Date());
    const updated = nextReview.items.find((candidate) => candidate.id === item.id) || item;
    await saveReviewState(nextReview);
    await recordLearningActivity({ reviews: 1 });
    results[index] = { isRight, item: updated };
    if (isRight) instrumentOrganism.pulse();
    else instrumentOrganism.mood("dim", 1500);
    return updated;
  }

  function renderQuestionItem(root, item, mod, question) {
    const card = document.createElement("article");
    let answeredThisReview = false;
    card.className = "quiz-q session-question";
    card.innerHTML =
      memoryLearningCardHtml(item, { compact: true }) +
      `<div class="weak-meta session-meta">` +
        `<span>${escapeHtml(mod?.id || item.moduleId)}</span>` +
        `<span>уровень: ${escapeHtml(item.level || "не указан")}</span>` +
        `<span>ошибок: ${escapeHtml(item.errors || 0)}</span>` +
      `</div>` +
      `<div class="q-kicker">Тренировочный вопрос</div>` +
      `<div class="q-text">${renderMarkdownInline(question.text)}</div>`;

    const optButtons = [];
    for (const opt of question.options) {
      const b = document.createElement("button");
      b.className = "opt";
      const body = document.createElement("span");
      body.className = "opt-body";
      body.innerHTML = renderMarkdownInline(opt.text);
      const state = document.createElement("span");
      state.className = "opt-state";
      b.append(body, state);
      b.onclick = runAsync(async () => {
        if (answeredThisReview) return;
        answeredThisReview = true;
        for (const [button] of optButtons) button.disabled = true;
        const isRight = opt.key === question.answer;
        try {
          const prevInterval = item.interval;
          const updated = await applySessionAnswer(item, isRight);
          for (const [button, key, mark] of optButtons) {
            if (key === question.answer) {
              button.classList.add("correct");
              if (mark) mark.textContent = key === opt.key ? "✓ Ваш ответ, правильный" : "✓ Правильный ответ";
            } else if (key === opt.key) {
              button.classList.add("wrong");
              if (mark) mark.textContent = "× Ваш ответ";
            } else {
              button.classList.add("dimmed");
              if (mark) mark.textContent = "";
            }
          }
          card.appendChild(sessionFeedbackLine(updated, isRight, prevInterval));
          if (question.explain.trim()) card.appendChild(QuizDiagnosis({ question, chosenKey: opt.key, isRight }));
          appendSessionNext(card);
        } catch (error) {
          answeredThisReview = false;
          for (const [button] of optButtons) button.disabled = false;
          throw error;
        }
      });
      optButtons.push([b, opt.key, state]);
      card.appendChild(b);
    }

    root.appendChild(card);
  }

  function renderConceptItem(root, item, mod) {
    const card = document.createElement("article");
    let answeredThisConcept = false;
    card.className = "quiz-q session-question";
    card.innerHTML =
      memoryLearningCardHtml(item, { compact: true }) +
      `<div class="weak-meta session-meta">` +
        `<span>${escapeHtml(mod?.id || item.moduleId)}</span>` +
        `<span>уровень: ${escapeHtml(item.level || "не указан")}</span>` +
        `<span>ошибок: ${escapeHtml(item.errors || 0)}</span>` +
      `</div>` +
      `<div class="q-kicker">Карточка памяти</div>` +
      `<div class="q-text">объясните себе: ${escapeHtml(weakSpotLearningCard(item).shortExplanation || item.text || item.mistakeType || "что здесь смешалось")}</div>`;

    const remember = document.createElement("button");
    remember.className = "btn";
    remember.textContent = "помню";
    async function choose(isRight) {
      if (answeredThisConcept) return;
      answeredThisConcept = true;
      remember.disabled = true;
      forgot.disabled = true;
      try {
        const prevInterval = item.interval;
        const updated = await applySessionAnswer(item, isRight);
        card.appendChild(sessionFeedbackLine(updated, isRight, prevInterval));
        appendSessionNext(card);
      } catch (error) {
        answeredThisConcept = false;
        remember.disabled = false;
        forgot.disabled = false;
        throw error;
      }
    }

    remember.onclick = runAsync(() => choose(true));

    const forgot = document.createElement("button");
    forgot.className = "btn secondary";
    forgot.textContent = "не помню";
    forgot.onclick = runAsync(() => choose(false));

    card.append(remember, forgot);
    root.appendChild(card);
  }

  function sessionFeedbackLine(item, isRight, prevInterval = null) {
    const line = document.createElement("div");
    line.className = `session-return-line ${isRight ? "is-right" : "is-wrong"}`;
    setElementAttr(line, "role", "status");
    setElementAttr(line, "aria-live", "polite");
    // После верного ответа показываем рост интервала: повторение видно как прогресс,
    // а не бесконечная очередь.
    if (item && !item.retired && item.lastResult === "right" && prevInterval && item.interval > prevInterval) {
      const prevLabel = prevInterval === 1 ? "завтра" : `через ${prevInterval} ${pluralizeDays(prevInterval)}`;
      const nextLabel = item.interval === 1 ? "завтра" : `через ${item.interval} ${pluralizeDays(item.interval)}`;
      line.textContent = `↑ интервал вырос: ${prevLabel} → ${nextLabel}.`;
    } else {
      line.textContent = signalReturnText(item);
    }
    return line;
  }

  async function renderFinal() {
    const right = results.filter((result) => result?.isRight).length;
    const tomorrow = results.filter((result) => result?.item?.lastResult === "wrong").length;
    $screen.innerHTML = "";
    const wrap = document.createElement("section");
    wrap.className = "review-session session-final";
    wrap.innerHTML =
      sessionHeader(plan, items.length, items.length, results) +
      `<div class="quiz-result">` +
        `<div class="score-label">Повторение завершено</div>` +
        `<div class="score">${right} / ${items.length}</div>` +
        `<p>Повторили ${items.length} ${pluralizeRepeats(items.length)}. ${tomorrow} ${tomorrow === 1 ? "слабое место вернётся" : "слабых мест вернутся"} завтра.</p>` +
      `</div>`;
    $screen.appendChild(wrap);
    startSessionOrganism(wrap, "glad");
    instrumentOrganism.mood("glad", 3000);

    const result = wrap.querySelector(".quiz-result");
    if (plan.moduleStep) {
      const mod = modules.find((item) => item.id === plan.moduleStep.moduleId);
      if (mod) {
        const next = document.createElement("button");
        next.className = "btn btn-with-icon";
        setButtonContent(next, `Открыть ${mod.id}`, "arrow");
        next.onclick = runAsync(() => showModule(mod));
        result.appendChild(next);
      }
    }
    const home = document.createElement("button");
    home.className = "btn secondary";
    home.textContent = "На главную";
    home.onclick = runAsync(showHome);
    result.appendChild(home);
  }

  await renderCurrent();
  focusScreenStart();
}

/* ---------- квиз: прохождение ---------- */

function showQuizIntro(mod) {
  const questions = parseQuiz(mod.files["quiz.md"]);
  if (!questions.length) {
    $screen.innerHTML = `<div class="loading">Не удалось разобрать вопросы теста.</div>`;
    return;
  }

  const gradedTotal = questions.filter((q) => q.kind === "auto").length;
  const applicationTotal = questions.length - gradedTotal;
  const card = document.createElement("section");
  card.className = "quiz-intro";
  card.innerHTML =
    `<div class="quiz-intro-head">` +
    `<div>` +
    `<div class="section-kicker">${iconSvg("quiz", "kicker-icon")}<span>Проверка</span></div>` +
    `<h2>${escapeHtml(mod.id)} · Проверить понимание</h2>` +
    `<p>Ответьте на вопросы станции. Проверка засчитается после завершения всех ${questions.length} вопросов.</p>` +
    `</div>` +
    `<div class="quiz-intro-mark" aria-hidden="true">${iconSvg("target", "quiz-intro-icon")}</div>` +
    `</div>` +
    `<div class="quiz-intro-metrics">` +
    metricHtml("next", "quiz", questions.length, `${pluralizeQuestions(questions.length)} всего`) +
    metricHtml("info", "target", "5-8 мин", "обычно на станцию") +
    metricHtml("success", "check", "70%+", "ориентир прохождения") +
    `</div>` +
    safetyNoteHtml() +
    `<details class="quiz-rules"><summary>Как считается результат</summary>` +
    `<p>${gradedTotal} ${pluralizeQuestions(gradedTotal)} идут в автоматический балл. ${applicationTotal} ${pluralizeQuestions(applicationTotal)} используются для самопроверки и не снижают результат.</p>` +
    `<p>Ошибки сохраняются как слабые места и вернутся в короткой сессии памяти.</p>` +
    `</details>`;

  const start = document.createElement("button");
  start.className = "btn btn-with-icon quiz-intro-start";
  setButtonContent(start, "Начать проверку", "arrow");
  start.onclick = runAsync(() => showQuiz(mod));
  card.appendChild(start);

  $screen.innerHTML = "";
  $screen.appendChild(card);
  appendModuleNavigation(mod, "quiz.md", {
    includeNext: false,
    mobilePrimary: { kind: "action", label: "Начать проверку", run: () => showQuiz(mod) },
  });
  focusScreenStart();
}

async function showQuiz(mod) {
  const questions = parseQuiz(mod.files["quiz.md"]);
  if (!questions.length) {
    $screen.innerHTML = `<div class="loading">Не удалось разобрать вопросы теста.</div>`;
    return;
  }

  let idx = 0;
  let correct = 0;
  let mistakes = 0;
  let answered = 0;
  const gradedTotal = questions.filter((q) => q.kind === "auto").length;
  const applicationTotal = questions.length - gradedTotal;
  await setModProgress(mod.id, {
    quizAttemptStatus: "in-progress",
    quizStartedAt: new Date().toISOString(),
    quizAnswered: 0,
    quizTotalQuestions: questions.length,
    quizCorrect: 0,
    quizMistakes: 0,
  });

  function renderQuestion() {
    const q = questions[idx];
    $screen.innerHTML = "";
    window.scrollTo(0, 0);

    $screen.appendChild(QuizProgressBar(q));

    if (q.kind === "application") renderApplicationQuestion(q);
    else renderAutoQuestion(q);
  }

  function QuizProgressBar(q) {
    const progress = document.createElement("div");
    progress.className = "quiz-progress";
    progress.innerHTML =
      `<div class="quiz-progress-head">` +
        `<strong>Вопрос ${idx + 1} из ${questions.length}</strong>` +
      `</div>` +
      `<div class="quiz-progress-segments" role="img" aria-label="Вопрос ${idx + 1} из ${questions.length}">` +
        questions.map((_, i) => `<i class="${i < idx ? "done" : i === idx ? "current" : ""}"></i>`).join("") +
      `</div>` +
      `<div class="quiz-progress-stats">` +
      (answered
        ? `<span>верных ${correct} из ${gradedTotal} · ${mistakes ? `ошибок ${mistakes}` : "без ошибок"}</span>`
        : `<span>${gradedTotal} оцениваемых · ${applicationTotal} для самопроверки</span>`) +
      `</div>`;
    return progress;
  }

  function renderAutoQuestion(q) {
    const card = document.createElement("div");
    let answeredThisQuestion = false;
    card.className = "quiz-q";
    card.innerHTML =
      `<div class="q-kicker">Оцениваемый вопрос</div>` +
      `<div class="q-text">${renderMarkdownInline(q.text)}</div>`;

    const optButtons = [];
    for (const opt of q.options) {
      const b = document.createElement("button");
      b.className = "opt";
      const body = document.createElement("span");
      body.className = "opt-body";
      body.innerHTML = renderMarkdownInline(opt.text);
      const state = document.createElement("span");
      state.className = "opt-state";
      b.append(body, state);
      b.onclick = runAsync(() => answer(opt.key));
      optButtons.push([b, opt.key, state]);
      card.appendChild(b);
    }
    $screen.appendChild(card);

    async function answer(chosen) {
      if (answeredThisQuestion) return;
      answeredThisQuestion = true;
      for (const [b] of optButtons) b.disabled = true;
      const isRight = chosen === q.answer;
      const nextCorrect = correct + (isRight ? 1 : 0);
      const nextMistakes = mistakes + (isRight ? 0 : 1);
      const nextAnswered = answered + 1;
      try {
        await updateWeakSpot(mod.id, q, isRight, chosen);
        await setModProgress(mod.id, {
          quizAttemptStatus: "in-progress",
          quizAnswered: nextAnswered,
          quizCorrect: nextCorrect,
          quizMistakes: nextMistakes,
        });
        correct = nextCorrect;
        mistakes = nextMistakes;
        answered = nextAnswered;
        for (const [b, key, state] of optButtons) {
          if (key === q.answer) {
            b.classList.add("correct");
            if (state) state.textContent = key === chosen ? "✓ Ваш ответ, правильно" : "✓ Правильный ответ";
          } else if (key === chosen) {
            b.classList.add("wrong");
            if (state) state.textContent = "× Ваш ответ";
          } else {
            b.classList.add("dimmed");
            if (state) state.textContent = "";
          }
        }
        if (q.explain.trim()) {
          card.appendChild(QuizDiagnosis({ question: q, chosenKey: chosen, isRight }));
        }
        if (!isRight) card.appendChild(ReviewAddedLine());
        appendNextButton(card);
      } catch (error) {
        answeredThisQuestion = false;
        for (const [b] of optButtons) b.disabled = false;
        throw error;
      }
    }
  }

  function renderApplicationQuestion(q) {
    const card = document.createElement("div");
    let revealed = false;
    card.className = "quiz-q";
    card.innerHTML =
      `<div class="q-kicker">Для самопроверки</div>` +
      `<div class="q-text app-text">${renderMarkdown(q.text)}</div>` +
      `<div class="application-prompt">Сформулируйте ответ самостоятельно, затем откройте разбор. Этот вопрос не входит в автоматический балл.</div>`;

    const reveal = document.createElement("button");
    reveal.className = "btn";
    reveal.textContent = "Показать разбор";
    reveal.onclick = runAsync(async () => {
      if (revealed) return;
      revealed = true;
      reveal.disabled = true;
      const nextAnswered = answered + 1;
      try {
        await setModProgress(mod.id, {
          quizAttemptStatus: "in-progress",
          quizAnswered: nextAnswered,
          quizCorrect: correct,
          quizMistakes: mistakes,
        });
        answered = nextAnswered;
        if (q.explain.trim()) {
          const exp = QuizDiagnosis({ question: q, chosenKey: null, isRight: true });
          exp.classList.add("answer-block");
          card.appendChild(exp);
        }
        appendSelfGrade(card, q);
      } catch (error) {
        revealed = false;
        reveal.disabled = false;
        throw error;
      }
    });

    card.appendChild(reveal);
    $screen.appendChild(card);
  }

  // Самопроверка вопросов «Применение»: оценка не идёт в автоматический балл,
  // но «частично/не справился» заводит слабое место и карточку в очередь повторения.
  function appendSelfGrade(container, q) {
    let graded = false;
    const block = document.createElement("div");
    block.className = "self-grade";
    block.innerHTML = `<div class="self-grade-prompt">Сравните свой ответ с разбором — как получилось?</div>`;

    const row = document.createElement("div");
    row.className = "self-grade-options";

    const choices = [
      { label: "Ответил верно", right: true },
      { label: "Частично", right: false },
      { label: "Не справился", right: false },
    ];

    const buttons = [];
    for (const choice of choices) {
      const b = document.createElement("button");
      b.className = "btn secondary self-grade-btn";
      b.textContent = choice.label;
      b.onclick = runAsync(async () => {
        if (graded) return;
        graded = true;
        for (const button of buttons) button.disabled = true;
        b.classList.add("chosen");
        try {
          await updateWeakSpot(mod.id, q, choice.right, null);
          if (!choice.right) container.appendChild(ReviewAddedLine());
          appendNextButton(container);
        } catch (error) {
          graded = false;
          for (const button of buttons) button.disabled = false;
          b.classList.remove("chosen");
          throw error;
        }
      });
      buttons.push(b);
      row.appendChild(b);
    }

    block.appendChild(row);
    container.appendChild(block);
  }

  function appendNextButton(container) {
    const next = document.createElement("button");
    let moving = false;
    next.className = "btn quiz-next";
    setButtonContent(next, idx + 1 < questions.length ? "Следующий вопрос" : "Завершить тест", "arrow");
    next.onclick = runAsync(async () => {
      if (moving) return;
      moving = true;
      next.disabled = true;
      idx++;
      if (idx < questions.length) renderQuestion();
      else await renderResult();
    });
    container.appendChild(next);
    next.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function renderResult() {
    const pr = modProgress(mod.id);
    const shouldSaveBest = gradedTotal > 0 && (
      pr.quizVersion !== QUIZ_PROGRESS_VERSION ||
      pr.quizTotal !== gradedTotal ||
      pr.quizBest == null ||
      correct > pr.quizBest
    );

    const resultPatch = {
      quizAttemptStatus: "complete",
      quizAnswered: questions.length,
      quizTotalQuestions: questions.length,
      quizCorrect: correct,
      quizMistakes: mistakes,
      quizCompletedAt: new Date().toISOString(),
    };
    if (shouldSaveBest) {
      Object.assign(resultPatch, {
        quizBest: correct,
        quizTotal: gradedTotal,
        quizOpenTotal: applicationTotal,
        quizVersion: QUIZ_PROGRESS_VERSION,
      });
    } else if (gradedTotal > 0 && pr.quizBest == null) {
      Object.assign(resultPatch, {
        quizBest: correct,
        quizTotal: gradedTotal,
        quizOpenTotal: applicationTotal,
        quizVersion: QUIZ_PROGRESS_VERSION,
      });
    }
    await setModProgress(mod.id, resultPatch);
    await recordLearningActivity({ moduleStep: true });

    const weakCount = getWeakSpotCount(mod.id);
    const ratio = gradedTotal ? correct / gradedTotal : 1;
    const passed = gradedTotal === 0 || ratio >= 0.7;
    const verdict = gradedTotal === 0
      ? "Самопроверка завершена"
      : passed
        ? "Проверка пройдена"
        : "Нужно вернуться к слабым местам";
    const resultHint = weakCount
      ? `Закрепите ${weakCount} ${pluralizeWeakSpots(weakCount)}, затем можно пройти проверку снова.`
      : "Можно закрепить вывод станции или пройти проверку снова.";

    $screen.innerHTML = "";
    const div = document.createElement("div");
    div.className = "quiz-result";
    div.innerHTML =
      `<div class="score-label">Результат проверки</div>` +
      `<div class="score">${correct} / ${gradedTotal}</div>` +
      `<p>${verdict}</p>` +
      `<p class="muted">${escapeHtml(resultHint)}</p>` +
      safetyNoteHtml() +
      (applicationTotal ? `<p class="muted">Открытые вопросы: ${applicationTotal}. Они использованы для самопроверки и не входят в балл.</p>` : "") +
      (weakCount ? `<p class="muted">Для закрепления сохранено: ${weakCount} ${pluralizeWeakSpots(weakCount)}.</p>` : "");

    if (weakCount) {
      const review = document.createElement("button");
      review.className = "btn";
      review.textContent = "Открыть закрепление";
      review.onclick = runAsync(() => openModuleReview(mod));
      div.appendChild(review);
    }

    const retry = document.createElement("button");
    retry.className = weakCount ? "btn secondary" : "btn";
    retry.textContent = "Пройти проверку ещё раз";
    retry.onclick = runAsync(() => showQuiz(mod));
    div.appendChild(retry);
    $screen.appendChild(div);
    appendModuleNavigation(mod, "quiz.md");
  }

  renderQuestion();
  focusScreenStart();
}

function showWeakSpots(mod) {
  $screen.innerHTML = "";
  syncActiveTab("__review__");

  const moduleItems = getModuleReviewItems(mod.id, { includeRetired: true });
  const grouped = reviewApi().groupReviewItems({ items: moduleItems }, new Date());
  const card = document.createElement("section");
  card.className = "review-card";

  if (!moduleItems.length) {
    card.innerHTML = `<h2>Память слабых мест</h2>${safetyNoteHtml()}<p>Сейчас нет тем для повторения.</p>`;
    $screen.appendChild(card);
    return;
  }

  card.innerHTML =
    `<div class="section-kicker">${iconSvg("review", "kicker-icon")}<span>Memory</span></div>` +
    `<h2>Память слабых мест</h2>` +
    safetyNoteHtml() +
    `<p class="muted">Здесь хранятся не просто пропущенные вопросы, а типы непонимания: что смешалось, почему это важно и как это тренировать.</p>`;

  const due = grouped.today.slice(0, TODAY_REVIEW_LIMIT);
  if (due.length) {
    const start = document.createElement("button");
    start.className = "btn btn-with-icon";
    setButtonContent(start, `Начать короткую сессию памяти (${due.length})`, "arrow");
    start.onclick = runAsync(() => startLearningSession({ reviewOnly: true, items: due }));
    card.appendChild(start);
  }

  const renderGroup = (title, items, emptyText) => {
    const section = document.createElement("section");
    section.className = "review-group";
    section.innerHTML = `<h3>${escapeHtml(title)} <span>${items.length}</span></h3>`;
    if (!items.length) {
      section.innerHTML += `<p class="muted">${escapeHtml(emptyText)}</p>`;
      card.appendChild(section);
      return;
    }
    const list = document.createElement("div");
    list.className = "weak-list";
    for (const item of items) {
      const li = document.createElement("article");
      const memory = weakSpotLearningCard(item);
      li.className = `weak-card ${item.retired ? "is-retired" : item.due <= todayISO() ? "is-due" : ""}`;
      const levelKey = item.levelKey || conceptLevelFromText(item.text).key;
      const number = item.questionNumber ? `источник Q${item.questionNumber}` : item.kind;
      li.innerHTML =
        `<div class="weak-card-head">` +
          `<span>${escapeHtml(number)}</span>` +
          `<strong>${escapeHtml(memory.userLabel)}</strong>` +
        `</div>` +
        `<p class="weak-explain">${escapeHtml(memory.shortExplanation)}</p>` +
        `<div class="weak-review-strategy">` +
          `<span>Как тренируем</span>` +
          `<strong>${escapeHtml(memory.reviewStrategy)}</strong>` +
        `</div>` +
        (memory.sourceText
          ? `<div class="weak-example"><span>Исходный пример</span><p>${escapeHtml(trimLearningText(memory.sourceText, 180))}</p></div>`
          : "") +
        ConceptTrail(levelKey, { compact: true, className: "weak-concept-trail" }) +
        `<div class="weak-return">${escapeHtml(memoryReturnLabel(item))}</div>` +
        `<div class="weak-meta">` +
          `<span>диагноз: ${escapeHtml(memory.diagnosticType)}</span>` +
          `<span>уровень: ${escapeHtml(memory.level)}</span>` +
          `<span>ошибок: ${escapeHtml(item.errors || 0)}</span>` +
        `</div>`;
      list.appendChild(li);
    }
    section.appendChild(list);
    card.appendChild(section);
  };

  renderGroup("сегодня", grouped.today, "сегодня очередь пуста.");
  renderGroup("скоро", grouped.soon.slice(0, 12), "скоро ничего не ждёт.");
  renderGroup("усвоено", grouped.retired.slice(0, 12), "Усвоенных тем пока нет.");

  const retry = document.createElement("button");
  retry.className = "btn secondary";
  retry.textContent = "Пройти тест снова";
  retry.onclick = () => showQuiz(mod);

  const clear = document.createElement("button");
  clear.className = "btn secondary danger";
  clear.textContent = "Очистить список";
  clear.onclick = runAsync(async () => {
    if (!confirm("Очистить слабые места этой станции?")) return;
    const mp = Object.assign({}, modProgress(mod.id), { weakSpots: {} });
    await replaceModProgress(mod.id, mp);
    const review = loadReviewState();
    await saveReviewState(Object.assign({}, review, {
      items: review.items.filter((item) => item.moduleId !== mod.id),
    }));
    showWeakSpots(mod);
  });

  card.append(retry, clear);
  $screen.appendChild(card);
  appendModuleNavigation(mod, "__review__", { includeNext: false });
  focusScreenStart();
}

/* ---------- утилиты и запуск ---------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeHtmlAttribute(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

function plainText(s) {
  return String(s)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[*_>#\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function runAsync(fn) {
  return (...args) => Promise.resolve()
    .then(() => fn(...args))
    .catch((error) => console.error("Nutrio action failed", error));
}

function pwaBannerExists(className) {
  return typeof document.querySelector === "function" && document.querySelector(`.${className}`);
}

function removePwaBanner(className) {
  if (typeof document.querySelector !== "function") return;
  document.querySelector(`.${className}`)?.remove?.();
}

async function triggerPwaInstall() {
  if (!deferredInstallPrompt) return;
  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  removePwaBanner("pwa-install-banner");
  await prompt.prompt?.();
  await prompt.userChoice?.catch?.(() => null);
}

function showPwaInstallPrompt() {
  if (!deferredInstallPrompt || isStandalonePwa() || pwaBannerExists("pwa-install-banner")) return;

  const banner = document.createElement("div");
  banner.className = "app-update-banner pwa-install-banner";
  setElementAttr(banner, "role", "status");
  setElementAttr(banner, "aria-live", "polite");

  const text = document.createElement("span");
  text.textContent = "Можно установить Somnenie: курс и повторения будут открываться как приложение.";

  const install = document.createElement("button");
  install.type = "button";
  install.textContent = "Установить";
  install.onclick = runAsync(triggerPwaInstall);

  const later = document.createElement("button");
  later.type = "button";
  later.className = "ghost";
  later.textContent = "Позже";
  later.onclick = () => banner.remove();

  banner.append(text, install, later);
  document.body.appendChild(banner);
}

function showPwaStatus(message, tone = "info", timeout = 3600) {
  removePwaBanner("pwa-status-banner");
  const banner = document.createElement("div");
  banner.className = `pwa-status-banner pwa-status-${tone}`;
  setElementAttr(banner, "role", "status");
  setElementAttr(banner, "aria-live", "polite");
  banner.textContent = message;
  document.body.appendChild(banner);

  if (pwaStatusTimer) clearTimeout(pwaStatusTimer);
  if (timeout) {
    pwaStatusTimer = setTimeout(() => banner.remove?.(), timeout);
  }
}

function syncOnlineStatus() {
  if (navigator.onLine === false) {
    showPwaStatus("Офлайн-режим: сохранённые станции и прогресс доступны на этом устройстве.", "offline", 0);
  } else {
    showPwaStatus("Снова онлайн. Обновления курса будут проверены автоматически.", "online");
    checkForPwaUpdate().catch((error) => console.warn("PWA update check failed", error));
  }
}

async function checkForPwaUpdate() {
  if (!("serviceWorker" in navigator)) {
    showPwaStatus("Service worker недоступен в этом браузере.", "offline");
    return null;
  }
  const registration = await navigator.serviceWorker.getRegistration?.();
  if (!registration) {
    showPwaStatus("Офлайн-слой будет готов после первой загрузки приложения.", "info");
    return null;
  }
  await registration.update?.();
  if (registration.waiting) showServiceWorkerUpdatePrompt(registration);
  else showPwaStatus("Обновлений сейчас нет. Офлайн-кэш активен.", "online");
  return registration;
}

async function applyLaunchRoute() {
  const hash = String(window.location?.hash || "").replace(/^#/, "").toLowerCase();
  const params = new URLSearchParams(String(window.location?.search || ""));
  const route = hash || params.get("screen") || "";
  if (!route || route === "today" || route === "home") {
    if (route) await showHome();
    return;
  }
  if (route === "atlas" || route === "map") return showAtlas();
  if (route === "progress" || route === "profile") return showProfile();
  if (route === "journal") return showProfile({ focus: "journal" });
  if (route === "memory") return showProfile({ focus: "memory" });
}

function showServiceWorkerUpdatePrompt(registration) {
  if (!registration?.waiting || pwaBannerExists("app-update-banner")) return;

  const banner = document.createElement("div");
  banner.className = "app-update-banner";
  setElementAttr(banner, "role", "status");
  setElementAttr(banner, "aria-live", "polite");

  const text = document.createElement("span");
  text.textContent = "Доступна новая версия курса.";

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Обновить";
  reload.onclick = () => {
    reload.disabled = true;
    if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
  };

  banner.append(text, reload);
  document.body.appendChild(banner);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  const registration = await navigator.serviceWorker.register("sw.js");
  navigator.serviceWorker.ready
    ?.then((readyRegistration) => readyRegistration.active?.postMessage?.({ type: "CACHE_CONTENT" }))
    .catch((error) => console.warn("PWA content warmup failed", error));
  if (registration.waiting && navigator.serviceWorker.controller) showServiceWorkerUpdatePrompt(registration);

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        showServiceWorkerUpdatePrompt(registration);
      }
    });
  });
}

$back.onclick = runAsync(showHome);
$profile.onclick = runAsync(showProfile);
if (window.addEventListener) {
  window.addEventListener("resize", updateTabsOverflowHint);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    showPwaInstallPrompt();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    removePwaBanner("pwa-install-banner");
    showPwaStatus("Somnenie установлено. Теперь его можно открывать как приложение.", "online");
  });
  window.addEventListener("online", syncOnlineStatus);
  window.addEventListener("offline", syncOnlineStatus);
  window.addEventListener("hashchange", runAsync(applyLaunchRoute));
}

(async function init() {
  $screen.innerHTML = `<div class="loading">Загрузка станций…</div>`;
  try {
    await storageApi().init();
    await withTimeoutFallback(storageApi().migrateFromLocalStorage(), MIGRATION_TIMEOUT_MS, null, "legacy localStorage migration");
    await refreshStorageCache();
    const [loadedManifest, loadedCourse] = await Promise.all([loadContentManifest(), loadCourse()]);
    contentManifest = loadedManifest;
    course = loadedCourse;
    modules = await discoverModules(contentManifest, course);
    await migrateReviewStateFromProgress();
    await showHome();
    await applyLaunchRoute();
  } catch (error) {
    console.error("Nutrio init failed", error);
    $screen.innerHTML = `<div class="loading">Storage initialization failed. Check console.</div>`;
  }
})();

window.addEventListener("load", () => {
  registerServiceWorker().catch((error) => console.warn("SW register failed", error));
});

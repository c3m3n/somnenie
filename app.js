/* Нутрициология — тренажёр. Движок читает папки content/MXX с md-файлами. */

const TABS = [
  { file: "theory.md",   label: "Теория" },
  { file: "terms.md",    label: "Термины" },
  { file: "practice.md", label: "Практика" },
  { file: "diagrams.md", label: "Схемы" },
  { file: "quiz.md",     label: "Проверка" },
  { file: "summary.md",  label: "Итог" },
];
const MATERIAL_FILES = ["theory.md", "terms.md", "practice.md", "diagrams.md"];
const MODULE_ROUTE_TABS = [
  { file: "theory.md", label: "Материал", files: MATERIAL_FILES, icon: "book", tone: "info" },
  { file: "quiz.md", label: "Проверка", files: ["quiz.md"], icon: "quiz", tone: "next" },
  { file: "summary.md", label: "Итог", files: ["summary.md"], icon: "summary", tone: "success" },
];
const CONTENT_MANIFEST_PATH = "content/manifest.json";
const QUIZ_PROGRESS_VERSION = 2;
const REVIEW_SCHEMA_VERSION = 2;
const COURSE_ID = "nutrition";
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

function setScreenMode(mode) {
  if (!document.body?.classList) return;
  for (const className of ["mode-home", "mode-module", "mode-profile", "mode-session"]) {
    document.body.classList.remove(className);
  }
  if (mode) document.body.classList.add(`mode-${mode}`);
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

function configureMarkedSecurity() {
  const api = markdownApi();
  if (!api?.Renderer || typeof api.use !== "function") return;

  const renderer = new api.Renderer();
  renderer.html = (html) => escapeHtml(html);
  renderer.link = (href, title, text) => {
    const safeHref = safeMarkdownHref(href);
    if (!safeHref) return text;
    const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : "";
    return `<a href="${escapeHtmlAttribute(safeHref)}"${titleAttr} rel="noopener noreferrer">${text}</a>`;
  };
  renderer.image = (_href, _title, text) => escapeHtml(text || "");

  api.use({ renderer });
}

function markdownApi() {
  return window.marked || globalThis.marked;
}

function safeMarkdownHref(href) {
  const raw = String(href || "").trim();
  if (!raw || /[\u0000-\u001F\u007F]/.test(raw)) return "";

  const compact = raw.replace(/\s+/g, "");
  if (compact.startsWith("#") || compact.startsWith("/") || compact.startsWith("./") || compact.startsWith("../")) {
    return raw;
  }

  try {
    const base = window.location?.href || "https://example.local/";
    const url = new URL(raw, base);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return raw;
  } catch {
    return "";
  }

  return "";
}

function sanitizeRenderedMarkdown(html) {
  let safe = String(html || "");
  safe = safe.replace(/<\s*(script|iframe|object|embed|form|input|button|textarea|select|style|meta|link|base|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  safe = safe.replace(/<\s*(script|iframe|object|embed|form|input|button|textarea|select|style|meta|link|base|svg|math)\b[^>]*\/?\s*>/gi, "");
  safe = safe.replace(/<\/?(?!\/?(p|br|strong|em|code|pre|ul|ol|li|blockquote|h[1-6]|hr|table|thead|tbody|tr|th|td|a|del)\b)[a-z][^>]*>/gi, "");
  safe = safe.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  safe = safe.replace(/\s+style\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  safe = safe.replace(/\s+(href|src|xlink:href)\s*=\s*(['"]?)\s*(javascript|data|vbscript|file):[^'"\s>]*/gi, "");
  safe = safe.replace(/\]\(\s*(javascript|data|vbscript|file):[^)]*\)/gi, "]()");
  return safe;
}

function renderMarkdown(text) {
  return sanitizeRenderedMarkdown(markdownApi().parse(String(text || "")));
}

function renderMarkdownInline(text) {
  return sanitizeRenderedMarkdown(markdownApi().parseInline(String(text || "")));
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
    spots[key] = {
      number: q.number,
      text: plainText(q.text).slice(0, 220),
      level: diagnosis.level.label,
      levelKey: diagnosis.level.key,
      mistakeType: diagnosis.mistakeType,
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
    }, new Date());
    await saveReviewState(nextReview);
  }
}

/* ---------- загрузка контента ---------- */

async function fetchText(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
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
  let material = 0;
  let quizzes = 0;
  let ratioSum = 0;
  let completedSteps = 0;
  for (const m of mods) {
    const pr = modProgress(m.id);
    completedSteps += moduleCompletionScore(m);
    if (pr.theoryRead) material++;
    if (isQuizCompletedProgress(pr) && pr.quizTotal) {
      quizzes++;
      ratioSum += pr.quizBest / pr.quizTotal;
    }
  }
  const parts = [`шаги ${completedSteps}/${mods.length * 3}`, `материал ${material}/${mods.length}`];
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
  if (pr.theoryRead || pr.takeaway || isQuizCompletedProgress(pr)) return `Продолжить модуль ${mod.id}`;
  return `Начать модуль ${mod.id}`;
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

function isMaterialFile(file) {
  return MATERIAL_FILES.includes(file);
}

function contentTabByFile(file) {
  return TABS.find((tab) => tab.file === file) || { file, label: file };
}

function moduleRouteTabForFile(file) {
  if (file === "__review__") return { file: "__review__", label: "Слабые сигналы", files: ["__review__"], icon: "review", tone: "review" };
  return MODULE_ROUTE_TABS.find((tab) => tab.files.includes(file)) || contentTabByFile(file);
}

function availableMaterialTabs(mod) {
  return TABS.filter((tab) => isMaterialFile(tab.file) && mod?.files?.[tab.file] !== null);
}

function metricHtml(tone, iconName, value, label) {
  return `<div class="metric ${tone}">${iconSvg(iconName, "metric-icon")}<strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
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
  const block = document.createElement("div");
  block.className = `quiz-diagnosis ${isRight ? "is-right" : "is-wrong"}`;
  setElementAttr(block, "role", "status");
  setElementAttr(block, "aria-live", "polite");
  const icon = isRight ? "✓" : "×";
  const verdict = isRight ? "Верно" : "Нужно уточнить";
  block.innerHTML =
    `<div class="quiz-diagnosis-head">` +
      `<span class="feedback-mark" aria-hidden="true">${icon}</span>` +
      `<div>` +
        `<span>${verdict}</span>` +
        `<strong>${escapeHtml(diagnosis.summary)}</strong>` +
      `</div>` +
    `</div>` +
    `<div class="quiz-diagnosis-grid">` +
      `<div><span>Уровень вопроса</span><strong>${escapeHtml(diagnosis.level.label)}</strong><p>${escapeHtml(diagnosis.level.description)}</p></div>` +
      `<div><span>${isRight ? "Что закрепить" : "Что спуталось"}</span><strong>${escapeHtml(diagnosis.mistakeType)}</strong><p>${escapeHtml(diagnosis.repair)}</p></div>` +
    `</div>` +
    (question.explain.trim()
      ? `<details class="quiz-diagnosis-explain"><summary>Подробнее</summary>${renderMarkdown(question.explain.trim())}</details>`
      : "");
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

function courseMapSegments(nextModule = null) {
  return modules.map((mod, index) => {
    const score = moduleCompletionScore(mod);
    const weakCount = getDueReviewCount(mod.id);
    const state = weakCount ? "review" : score === 3 ? "complete" : score > 0 ? "active" : "idle";
    const isNext = nextModule?.id === mod.id && state === "idle";
    const hint = `${mod.id} · ${mod.title} · ${isNext ? "Следующий" : moduleStateLabel(mod)}`;
    return `<button type="button" class="course-map-segment ${state}${isNext ? " next" : ""}" data-module-id="${escapeHtml(mod.id)}" style="--segment-delay: ${index * 10}ms" title="${escapeHtml(hint)}" aria-label="${escapeHtml(hint)}"></button>`;
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
  const lines = [`> ${speechPick(timeSpeechPool(), sessions.lastDate || "new")}`];
  const daysSinceLast = sessions.lastDate ? reviewApi().daysBetweenISO(sessions.lastDate, todayISO()) : 0;

  if (!nextModule && !summary.weakSpotTotal) {
    lines.push(`> ${speechPick("complete", summary.completedSteps)}`);
  } else if (daysSinceLast > 7) {
    lines.push(`> ${speechPick("break", daysSinceLast)}`);
  } else if (sessionPlan?.reviews?.length) {
    lines.push(`> ${sessionPlan.reviews.length} ${pluralizeSignals(sessionPlan.reviews.length)} ${sessionPlan.reviews.length === 1 ? "хочет" : "хотят"} вернуться.`);
  } else {
    lines.push(`> ${speechPick("queue", summary.completedSteps)}`);
  }

  if (sessions.streakDays > 1) {
    lines.push(`> ${sessions.streakDays}-й день подряд.`);
  } else if (nextModule) {
    lines.push(`> ${speechPick("progress", nextModule.id)} ${ordinalSignal(moduleSignalNumber(nextModule))} ждёт.`);
  } else {
    lines.push("> прибор спокоен.");
  }
  return lines.slice(0, 3);
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
  if (count) return `повторить ${count} ${pluralizeQuestions(count)} ▸`;
  if (nextModule) return `${moduleCompletionScore(nextModule) > 0 || isQuizInProgress(modProgress(nextModule.id)) ? "продолжить" : "начать"} ${nextModule.id} ▸`;
  return "курс завершён";
}

function sessionMetaText(plan, nextModule) {
  const count = plan?.reviews?.length || 0;
  if (count && plan.moduleStep) return `${count} ${pluralizeQuestions(count)} на повторение, затем ${plan.moduleStep.moduleId} · ~${plan.estimatedMinutes} мин`;
  if (count) return `${count} ${pluralizeQuestions(count)} на повторение · новый модуль не нужен`;
  if (nextModule) return "очередь повторения пуста · только шаг модуля";
  return "курс пройден · слабые места можно повторять в любой момент";
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

/* ---------- экран: список модулей ---------- */

async function showHome() {
  resetReadingProgress();
  cleanupHomeEffects();
  setScreenMode("home");
  current = null;
  $title.textContent = "Нутрициология";
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
  const totalPercent = summary.coursePercent;
  const nextLabel = sessionButtonLabel(sessionPlan, nextModule);
  const nextPhaseGroup = nextModule
    ? getModuleGroups().find((g) => g.modules.some((m) => m.id === nextModule.id))
    : null;
  const nextMeta = nextPhaseGroup
    ? nextPhaseGroup.title.toLowerCase()
    : "все модули закрыты";
  const nextAsk = nextModule
    ? (sessionPlan.reviews.length ? "сеанс на сегодня" : "следующий шаг")
    : "курс пройден";

  const intro = document.createElement("section");
  intro.className = "intro-card";
  intro.innerHTML =
    `<header class="instrument-statusbar rise">` +
      `<span class="led" aria-hidden="true"></span>` +
      `<span class="instrument-brand">SOMNENIE</span>` +
      `<span class="instrument-path">~/курс/нутрициология</span>` +
      `<span class="instrument-clock" data-instrument-clock>--:--:--</span>` +
    `</header>` +
    `<p class="etch rise">нутрициология без <em>мифов</em></p>` +
    `<section class="next next-step-card rise">` +
      `<p class="ask">${escapeHtml(nextAsk)}</p>` +
      `<h3><b>${nextModule ? escapeHtml(nextModule.id) : "24/24"}</b> · ${escapeHtml(nextModule ? nextModule.title : nextLabel)}</h3>` +
      `<p class="meta">${escapeHtml(sessionMetaText(sessionPlan, nextModule))}</p>` +
      `<p class="next-step-why">${escapeHtml(nextMeta)}</p>` +
    `</section>` +
    (summary.weakSpotTotal
      ? `<div class="home-review-strip">${iconSvg("review", "home-strip-icon")}<span>Повторение: ${summary.dueReviewTotal} сегодня · ${summary.weakSpotTotal} ${pluralizeQuestions(summary.weakSpotTotal)} в очереди</span></div>`
      : `<div class="home-review-strip is-empty">${iconSvg("check", "home-strip-icon")}<span>Очередь повторения наполнится после первого теста</span></div>`) +
    `<div class="organism-wrap rise" aria-hidden="true"><pre id="organism"></pre></div>` +
    `<section class="console rise" aria-live="polite" aria-label="Состояние прибора"><div data-console-lines></div></section>` +
    `<section class="matrix-block home-progress-compact rise" aria-label="Карта курса">` +
      `<div class="course-map instrument-matrix" aria-label="Карта прогресса по модулям: клик открывает модуль">${courseMapSegments(nextModule)}</div>` +
      `<div class="matrix-foot">` +
        `<span class="map-legend"><i class="legend-complete"></i>завершён <i class="legend-active"></i>в работе <i class="legend-review"></i>повторить <i class="legend-idle"></i>не начат</span>` +
      `</div>` +
      `<div class="home-progress-text"><strong>${totalPercent}%</strong><span>${summary.completedSteps}/${summary.totalSteps} шагов курса завершено</span></div>` +
      `<div class="course-progress" aria-label="Общий прогресс курса по шагам"><span style="width: ${totalPercent}%"></span></div>` +
    `</section>` +
    `<section class="ledger rise" aria-label="Фазы курса">${phaseLedgerRows(nextModule)}</section>` +
    `<p class="disclaimer">учебный материал · не заменяет врача · прогресс живёт в этом браузере</p>`;

  const actions = document.createElement("div");
  actions.className = "home-actions";

  if (nextModule || sessionPlan.reviews.length) {
    const continueBtn = document.createElement("button");
    continueBtn.className = "btn compact btn-with-icon";
    setButtonContent(continueBtn, nextLabel, "arrow");
    continueBtn.onclick = runAsync(() => startLearningSession());
    actions.appendChild(continueBtn);
  } else {
    const complete = document.createElement("div");
    complete.className = "course-complete";
    complete.textContent = "Курс пройден. Закрепление появится здесь, если в тестах останутся ошибки.";
    actions.appendChild(complete);
  }

  const nextStepCard = typeof intro.querySelector === "function"
    ? intro.querySelector(".next-step-card")
    : null;
  if (nextStepCard) {
    const secondary = nextStepCard.querySelector(".next-step-why");
    nextStepCard.insertBefore(actions, secondary || null);
  }
  else intro.appendChild(actions);
  $screen.appendChild(intro);
  bindCourseMap(intro);
  startHomeEffects(intro, summary, nextModule, sessionPlan);

  appendHomeReview(summary);

  let phaseNumber = 0;
  for (const group of getModuleGroups()) {
    phaseNumber++;
    const phasePercent = phaseCompletionPercent(group.modules);
    const doneModules = group.modules.filter((mod) => moduleCompletionScore(mod) === 3).length;
    const header = document.createElement("section");
    header.className = "phase-header";
    header.innerHTML =
      `<div class="phase-kicker">Фаза ${phaseNumber} · ${doneModules}/${group.modules.length} модулей</div>` +
      `<h2>${escapeHtml(group.title)}</h2>` +
      (group.subtitle ? `<p class="phase-subtitle">${escapeHtml(group.subtitle)}</p>` : "") +
      `<div class="phase-progressbar" aria-hidden="true"><span style="width: ${phasePercent}%"></span></div>`;
    $screen.appendChild(header);

    for (const mod of group.modules) $screen.appendChild(moduleCard(mod, nextModule));
  }
}

function moduleCard(mod, nextModule = null) {
  const pr = modProgress(mod.id);
  const parts = [];
  const weakCount = getVisibleWeakSpotCount(mod.id);
  const rawWeakCount = getWeakSpotCount(mod.id);
  const completion = moduleCompletionPercent(mod);
  const theme = moduleTheme(mod);
  const isNext = nextModule?.id === mod.id;
  if (pr.theoryRead) parts.push("материал ✓");
  if (isQuizCompletedProgress(pr)) parts.push(`проверка ${pr.quizBest}/${pr.quizTotal}`);
  else if (isQuizInProgress(pr)) parts.push(`проверка ${pr.quizAnswered || 0}/${pr.quizTotalQuestions || "?"}`);
  if (pr.takeaway) parts.push("итог ✓");
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
    `<span class="${pr.theoryRead ? "done" : ""}">${iconSvg("book", "step-icon")}Материал</span>` +
    `<span class="${isQuizCompletedProgress(pr) ? "done" : isQuizInProgress(pr) ? "active" : ""}">${iconSvg("quiz", "step-icon")}Проверка</span>` +
    `<span class="${pr.takeaway ? "done" : ""}">${iconSvg("summary", "step-icon")}Итог</span>` +
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
    `<div class="section-kicker">Повторение</div>` +
    `<h2>Очередь повторения</h2>` +
    `<p class="muted">Вопросы с ошибками возвращаются по расписанию. Сегодняшние попадают в сеанс, остальные ждут своей даты.</p>`;

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
      `<em>${item.dueCount ? `${item.dueCount} сегодня · ` : ""}${item.count} ${pluralizeQuestions(item.count)} на повторении</em>` +
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

async function showProfile() {
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
    metricHtml("success", "check", `${summary.completedSteps}/${summary.totalSteps}`, "шагов завершено"),
    metricHtml("info", "book", `${summary.theoryRead}/${summary.totalModules}`, "материалов"),
    metricHtml("next", "quiz", `${summary.quizCompleted}/${summary.totalModules}`, "проверок"),
  ];
  if (summary.quizCompleted) dashboardMetrics.push(metricHtml("success", "target", summary.averageScore, "средний лучший балл"));
  else dashboardMetrics.push(`<div class="metric empty">${iconSvg("target", "metric-icon")}<strong>После теста</strong><span>появится средний балл</span></div>`);
  if (summary.weakSpotTotal) dashboardMetrics.push(metricHtml("review", "review", summary.weakSpotTotal, "тем для закрепления"));
  dashboardMetrics.push(metricHtml("review", "review", reviewStats.dueToday, "вернутся сегодня"));
  dashboardMetrics.push(metricHtml("success", "check", reviewStats.retired, "усвоено"));
  dashboard.innerHTML =
    `<div class="section-kicker">Где я</div>` +
    `<h2>Прогресс обучения</h2>` +
    `<p class="muted">Курс считается по шагам: Материал, Проверка и Итог в каждом модуле. Блоки чтения и вопросы теста показывают только локальный прогресс.</p>` +
    `<div class="course-map instrument-matrix profile-matrix" aria-label="Матрица прогресса по модулям: клик открывает модуль">${courseMapSegments(nextModule)}</div>` +
    `<div class="matrix-foot"><span class="lens-line">сигналы курса</span><span class="n">${signalCounterText(completedSignalCount())}</span></div>` +
    `<p class="streak-line">${escapeHtml(streakLine(sessions))}</p>` +
    `<div class="memory-calendar" aria-label="График памяти за последние 30 дней">${memoryDayCells(sessions)}</div>` +
    `<p class="memory-caption">последние 30 дней · в работе ${reviewStats.active} · усвоено ${reviewStats.retired}</p>` +
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
  weak.innerHTML = `<div class="section-kicker">Что улучшить</div><h2>Темы для закрепления</h2>`;
  if (summary.weakModules.length) {
    const list = document.createElement("ol");
    list.className = "cabinet-list";
    for (const item of summary.weakModules) {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${item.id}</strong> ${escapeHtml(item.title)} <span class="muted">· ${item.count} ${pluralizeQuestions(item.count)}${item.topMistake ? ` · ${escapeHtml(item.topMistake.toLowerCase())}` : ""}</span>`;
      list.appendChild(li);
    }
    weak.appendChild(list);
  } else {
    weak.innerHTML += `<p class="muted">Здесь появятся темы после завершённого теста, если в ответах были ошибки.</p>`;
  }

  const takeaways = document.createElement("section");
  takeaways.className = "dashboard-card";
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
    takeaways.innerHTML += `<p class="muted">Сохраните первый итог модуля, чтобы собрать здесь свои выводы.</p>`;
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
  $screen.appendChild(dashboard);
  bindCourseMap(dashboard);
  $screen.appendChild(weak);
  $screen.appendChild(takeaways);
  if (phases) $screen.appendChild(phases);
  $screen.appendChild(form);
  $screen.appendChild(actions);
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
    totalSteps: modules.length * 3,
    completedSteps: 0,
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
    summary.completedSteps += moduleCompletionScore(mod);
    if (pr.theoryRead) summary.theoryRead++;
    if (isQuizCompletedProgress(pr) && pr.quizTotal) {
      summary.quizCompleted++;
      ratioSum += pr.quizBest / pr.quizTotal;
    }

    const reviewCount = isQuizCompletedProgress(pr) ? getModuleReviewItems(mod.id).length : 0;
    const fallbackSpotCount = isQuizCompletedProgress(pr) ? Object.keys(pr.weakSpots || {}).length : 0;
    const count = reviewCount || fallbackSpotCount;
    const dueCount = getDueReviewCount(mod.id);
    if (count) {
      const mistakeFreq = {};
      for (const spot of Object.values(pr.weakSpots || {})) {
        if (spot?.mistakeType) mistakeFreq[spot.mistakeType] = (mistakeFreq[spot.mistakeType] || 0) + 1;
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
  summary.coursePercent = summary.totalSteps ? Math.round((summary.completedSteps / summary.totalSteps) * 100) : 0;

  summary.takeaways.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  summary.takeaways = summary.takeaways.slice(0, 5);
  return summary;
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

/* ---------- экран: модуль с вкладками ---------- */

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
  button.innerHTML = `${iconSvg(visual.icon, "tab-icon")}<span>${escapeHtml(tab.label)}</span>`;
  button.onclick = () => openTab(tab.file);
  button.dataset.file = tab.file;
  button.dataset.files = (tab.files || [tab.file]).join("|");
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
  const tabs = MODULE_ROUTE_TABS.filter((tab) => tab.files.some((file) => mod?.files?.[file] !== null));
  if (mod && getVisibleWeakSpotCount(mod.id)) return [...tabs, { file: "__review__", label: "Сигналы", files: ["__review__"], icon: "review", tone: "review" }];
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
  if (step.kind === "module") return prefix === "Следующий модуль" ? `Открыть ${step.label}` : `Продолжить ${step.label}`;
  if (step.kind === "home") return "Завершить курс";
  if (step.kind === "review") return "Открыть закрепление";
  if (step.kind === "action") return step.label;
  if (step.kind === "tab") {
    const tab = contentTabByFile(step.file);
    if (prefix === "Назад") return `Назад: ${tab.label}`;
    if (step.file === "quiz.md") return "Перейти к проверке";
    if (step.file === "summary.md") return "Открыть итог";
    return `Перейти к ${tabTargetLabel(step.file)}`;
  }
  return step.label || prefix;
}

function tabTargetLabel(file) {
  return {
    "theory.md": "теории",
    "terms.md": "терминам",
    "practice.md": "практике",
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

  const route = document.createElement("div");
  route.className = "lesson-route";
  route.textContent = file === "__review__" ? "Слабые сигналы" : "Маршрут: Материал -> Проверка -> Итог";

  const actions = document.createElement("div");
  actions.className = "lesson-nav-actions";

  if (prev) actions.appendChild(createLearningStepButton(prev, "btn secondary compact lesson-nav-prev", "Назад"));
  if (review) actions.appendChild(createLearningStepButton(review, "btn secondary compact", "Открыть"));
  if (next) actions.appendChild(createLearningStepButton(next, "btn compact lesson-nav-next", next.kind === "module" ? "Следующий модуль" : "Дальше"));

  nav.append(route, actions);

  if (mobilePrimary) {
    const sticky = createLearningStepButton(
      mobilePrimary,
      "module-next-sticky",
      mobilePrimary.kind === "module" ? "Следующий модуль" : "Дальше",
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
    repair = `Сравните выбранный уровень с правильным: сейчас нужен уровень "${level.label}", а не "${chosenLevel.label}".`;
  }

  const summary = isRight
    ? `Ответ совпал с уровнем "${level.label}".`
    : chosenText
      ? `Ваш ответ: ${chosenText}. Правильный ответ относится к уровню "${level.label}".`
      : `Нужно восстановить уровень "${level.label}".`;

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
    for (let i = 0; i < cards.length; i++) cards[i].classList.toggle("active", i === active);
  };

  const onScroll = () => {
    if (pending) return;
    pending = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(update);
    else update();
  };

  label.textContent = `Раздел 1 из ${cards.length}`;
  fill.style.width = `${Math.round((1 / cards.length) * 100)}%`;
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
  $screen.innerHTML = "";
  if (isMaterialFile(file)) $screen.appendChild(MaterialSubnav(mod, file));
  $screen.appendChild(buildModuleReadingLayout(mod, file, div));

  if (file === "theory.md") appendTheoryControls(mod, file);
  if (file === "summary.md") appendSummaryControls(mod);
  appendModuleNavigation(mod, file);
}

function MaterialSubnav(mod, activeFile) {
  const nav = document.createElement("nav");
  nav.className = "material-subnav";
  setElementAttr(nav, "aria-label", "Блоки материала");

  const materialTabs = availableMaterialTabs(mod);
  const activeIndex = Math.max(0, materialTabs.findIndex((tab) => tab.file === activeFile));

  const label = document.createElement("div");
  label.className = "material-subnav-label";
  label.textContent = `Материал · блок ${activeIndex + 1} из ${materialTabs.length}`;
  nav.appendChild(label);

  for (const tab of materialTabs) {
    const visual = tabVisual(tab.file);
    const button = document.createElement("button");
    button.className = `material-subtab tab-${visual.tone}`;
    button.dataset.file = tab.file;
    button.innerHTML = `${iconSvg(visual.icon, "tab-icon")}<span>${escapeHtml(tab.label)}</span>`;
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
  const materialTabs = availableMaterialTabs(mod);
  const routeTabs = MODULE_ROUTE_TABS.filter((tab) => tab.files.some((routeFile) => mod?.files?.[routeFile] !== null));
  const currentRouteIndex = Math.max(0, routeTabs.findIndex((tab) => tab.files.includes(file)));
  const currentBlockIndex = Math.max(0, materialTabs.findIndex((tab) => tab.file === file));
  const visual = routeTab.icon ? routeTab : tabVisual(file);
  const stepText = isMaterialFile(file)
    ? `Материал · блок ${currentBlockIndex + 1} из ${materialTabs.length}: ${blockTab.label}`
    : `Шаг модуля ${currentRouteIndex + 1} из ${routeTabs.length}`;
  aside.innerHTML =
    `<div class="side-head">` +
    `<span class="side-icon side-icon-${visual.tone}">${iconSvg(visual.icon, "side-icon-svg")}</span>` +
    `<div>` +
    `<div class="side-kicker">${escapeHtml(mod.id)}</div>` +
    `<h2>${escapeHtml(routeTab.label || file)}</h2>` +
    `</div>` +
    `</div>` +
    `<div class="side-step">${escapeHtml(stepText)}</div>` +
    `<div class="trust-note">${iconSvg("book", "trust-icon")}<span>Образовательный материал. Источники и границы применимости — в конце блока.</span></div>`;

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
    const nextButton = createLearningStepButton(next, "side-next", next.kind === "module" ? "Следующий модуль" : "Дальше");
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
    note.textContent = "✓ Прочитано";
    controls.appendChild(note);
  } else {
    const btn = document.createElement("button");
    btn.className = "btn btn-with-icon";
    setButtonContent(btn, "Отметить как прочитанное", "check");
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

  const label = document.createElement("label");
  label.className = "takeaway-label";
  label.textContent = "Главный вывод модуля";

  const hint = document.createElement("p");
  hint.className = "takeaway-hint";
  hint.textContent = "Сохранённый вывод закрывает шаг «Итог» и попадает в историю выводов.";

  const textarea = document.createElement("textarea");
  textarea.className = "takeaway-input";
  textarea.placeholder = "Запишите 1-3 фразы: что теперь понятно, что применить, что повторить.";
  textarea.value = modProgress(mod.id).takeaway || "";

  const save = document.createElement("button");
  save.className = "btn secondary btn-with-icon";
  setButtonContent(save, "Сохранить вывод", "summary");

  const status = document.createElement("div");
  status.className = "save-status";

  save.onclick = runAsync(async () => {
    await setModProgress(mod.id, {
      takeaway: textarea.value.trim(),
      takeawayUpdatedAt: new Date().toISOString(),
    });
    await recordLearningActivity({ moduleStep: true });
    status.textContent = "Вывод сохранён";
    status.classList.remove("saved");
    void status.offsetWidth;
    status.classList.add("saved");
  });

  controls.append(label, hint, textarea, save, status);
  $screen.appendChild(controls);
}

/* ---------- квиз: парсинг ---------- */

function parseQuiz(md) {
  if (!md) return [];

  const blocks = md.split(/\r?\n---+\r?\n/);
  const questions = [];

  for (const block of blocks) {
    const head = block.match(/^##\s*Q(\d+)\s*\(([^)]+)\)\s*$/m);
    if (!head) continue;

    const number = Number(head[1]);
    const rawType = head[2].trim();
    const body = block.slice(head.index + head[0].length).trim();

    if (rawType === "MCQ" || rawType === "True/False") {
      const q = parseAutoQuestion(number, rawType, body);
      if (q) questions.push(q);
    } else if (rawType === "Применение") {
      const q = parseApplicationQuestion(number, body);
      if (q) questions.push(q);
    }
  }

  return questions;
}

function parseAutoQuestion(number, type, body) {
  const answerMatch = body.match(/\*\*Правильный ответ:\s*(.+?)\*\*/);
  if (!answerMatch) return null;

  const beforeAnswer = body.slice(0, answerMatch.index).trim();
  const answerRaw = answerMatch[1].trim();
  const explainMatch = body.match(/\*\*Объяснение:\*\*\s*([\s\S]*)$/);
  const explain = explainMatch ? explainMatch[1].trim() : "";

  let answer = null;
  let options = [];
  let text = beforeAnswer;

  if (type === "MCQ") {
    options = Array.from(beforeAnswer.matchAll(/^([A-D])\.\s+(.+)$/gm), (m) => ({
      key: m[1],
      text: m[2].trim(),
    }));
    text = beforeAnswer.replace(/^([A-D])\.\s+.+$/gm, "").trim();

    const letter = answerRaw.match(/^([A-D])/i);
    answer = letter ? letter[1].toUpperCase() : null;
    if (!options.some((opt) => opt.key === answer)) return null;
  } else {
    text = beforeAnswer.trim();
    options = [{ key: true, text: "Верно" }, { key: false, text: "Неверно" }];
    if (/НЕВЕРНО|False/i.test(answerRaw)) answer = false;
    else if (/ВЕРНО|True/i.test(answerRaw)) answer = true;
  }

  if (answer === null || !text) return null;
  return { kind: "auto", number, type, text, options, answer, explain };
}

function parseApplicationQuestion(number, body) {
  const answerMatch = body.match(/\*\*Ответ и разбор:\*\*\s*/);
  const text = answerMatch ? body.slice(0, answerMatch.index).trim() : body.trim();
  const explain = answerMatch ? body.slice(answerMatch.index + answerMatch[0].length).trim() : "";

  if (!text) return null;
  return { kind: "application", number, type: "Применение", text, explain };
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
        `<h2>${index < total ? `сигнал ${index + 1}/${total}` : "сеанс закрыт"}</h2>` +
        `<p>${plan.moduleStep ? `${total} ${pluralizeRepeats(total)} + ${plan.moduleStep.moduleId}` : `${total} ${pluralizeRepeats(total)}`}</p>` +
        `<div class="session-cells">${sessionProgressCells(total, index, results)}</div>` +
      `</div>` +
    `</header>`
  );
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

  if (Array.isArray(options.items)) {
    plan = Object.assign({}, plan, {
      reviews: options.items.slice(0, reviewApi().DAILY_REVIEW_LIMIT),
      reviewOnly: Boolean(options.reviewOnly),
      moduleStep: options.reviewOnly ? null : plan.moduleStep,
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

  const items = plan.reviews.slice(0, reviewApi().DAILY_REVIEW_LIMIT);
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
    next.className = "btn quiz-next";
    setButtonContent(next, index + 1 < items.length ? "следующий сигнал" : "закрыть сеанс", "arrow");
    next.onclick = runAsync(async () => {
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
    card.className = "quiz-q session-question";
    card.innerHTML =
      `<div class="weak-meta session-meta">` +
        `<span>${escapeHtml(mod?.id || item.moduleId)}</span>` +
        `<span>уровень: ${escapeHtml(item.level || "не указан")}</span>` +
        `<span>ошибок: ${escapeHtml(item.errors || 0)}</span>` +
      `</div>` +
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
        const isRight = opt.key === question.answer;
        const updated = await applySessionAnswer(item, isRight);
        for (const [button, key, mark] of optButtons) {
          button.disabled = true;
          if (key === question.answer) {
            button.classList.add("correct");
            if (mark) mark.textContent = key === opt.key ? "✓ Ваш ответ, правильный" : "✓ Правильный ответ";
          } else if (key === opt.key) {
            button.classList.add("wrong");
            if (mark) mark.textContent = "× Ваш ответ";
          } else if (mark) {
            mark.textContent = "Не выбран";
          }
        }
        card.appendChild(sessionFeedbackLine(updated, isRight));
        if (question.explain.trim()) card.appendChild(QuizDiagnosis({ question, chosenKey: opt.key, isRight }));
        appendSessionNext(card);
      });
      optButtons.push([b, opt.key, state]);
      card.appendChild(b);
    }

    root.appendChild(card);
  }

  function renderConceptItem(root, item, mod) {
    const card = document.createElement("article");
    card.className = "quiz-q session-question";
    card.innerHTML =
      `<div class="weak-meta session-meta">` +
        `<span>${escapeHtml(mod?.id || item.moduleId)}</span>` +
        `<span>уровень: ${escapeHtml(item.level || "не указан")}</span>` +
        `<span>ошибок: ${escapeHtml(item.errors || 0)}</span>` +
      `</div>` +
      `<div class="q-text">объясни себе: ${escapeHtml(item.text || item.mistakeType || "что здесь смешалось")}</div>`;

    const remember = document.createElement("button");
    remember.className = "btn";
    remember.textContent = "помню";
    remember.onclick = runAsync(async () => {
      const updated = await applySessionAnswer(item, true);
      remember.disabled = true;
      forgot.disabled = true;
      card.appendChild(sessionFeedbackLine(updated, true));
      appendSessionNext(card);
    });

    const forgot = document.createElement("button");
    forgot.className = "btn secondary";
    forgot.textContent = "не помню";
    forgot.onclick = runAsync(async () => {
      const updated = await applySessionAnswer(item, false);
      remember.disabled = true;
      forgot.disabled = true;
      card.appendChild(sessionFeedbackLine(updated, false));
      appendSessionNext(card);
    });

    card.append(remember, forgot);
    root.appendChild(card);
  }

  function sessionFeedbackLine(item, isRight) {
    const line = document.createElement("div");
    line.className = `session-return-line ${isRight ? "is-right" : "is-wrong"}`;
    setElementAttr(line, "role", "status");
    setElementAttr(line, "aria-live", "polite");
    line.textContent = signalReturnText(item);
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
        `<div class="score-label">сеанс закрыт</div>` +
        `<div class="score">${right} / ${items.length}</div>` +
        `<p>сеанс закрыт · ${items.length} ${pluralizeSignals(items.length)} · ${tomorrow} ${tomorrow === 1 ? "вернётся" : "вернутся"} завтра</p>` +
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
        setButtonContent(next, `открыть ${mod.id}`, "arrow");
        next.onclick = runAsync(() => showModule(mod));
        result.appendChild(next);
      }
    }
    const home = document.createElement("button");
    home.className = "btn secondary";
    home.textContent = "на главную";
    home.onclick = runAsync(showHome);
    result.appendChild(home);
  }

  await renderCurrent();
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
    `<p>Ответьте на вопросы модуля. Проверка засчитается после завершения всех ${questions.length} вопросов.</p>` +
    `</div>` +
    `<div class="quiz-intro-mark" aria-hidden="true">${iconSvg("target", "quiz-intro-icon")}</div>` +
    `</div>` +
    `<div class="quiz-intro-metrics">` +
    metricHtml("next", "quiz", questions.length, `${pluralizeQuestions(questions.length)} всего`) +
    metricHtml("info", "target", "5-8 мин", "обычно на модуль") +
    metricHtml("success", "check", "70%+", "ориентир прохождения") +
    `</div>` +
    `<details class="quiz-rules"><summary>Как считается результат</summary>` +
    `<p>${gradedTotal} ${pluralizeQuestions(gradedTotal)} идут в автоматический балл. ${applicationTotal} ${pluralizeQuestions(applicationTotal)} используются для самопроверки и не снижают результат.</p>` +
    `<p>Ошибки сохраняются как темы для закрепления после завершения теста.</p>` +
    `<p><strong>Важно:</strong> это образовательная проверка, а не медицинская рекомендация.</p>` +
    `</details>`;

  const start = document.createElement("button");
  start.className = "btn btn-with-icon";
  setButtonContent(start, "Начать проверку", "arrow");
  start.onclick = runAsync(() => showQuiz(mod));
  card.appendChild(start);

  $screen.innerHTML = "";
  $screen.appendChild(card);
  appendModuleNavigation(mod, "quiz.md", {
    includeNext: false,
    mobilePrimary: { kind: "action", label: "Начать проверку", run: () => showQuiz(mod) },
  });
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
    const percent = Math.round((idx / questions.length) * 100);
    progress.innerHTML =
      `<div class="quiz-progress-head">` +
        `<strong>Вопрос ${idx + 1} из ${questions.length}</strong>` +
        `<span>${q.kind === "application" ? "Самопроверка" : "На балл"}</span>` +
      `</div>` +
      `<div class="quiz-progress-track" aria-label="Прогресс проверки"><span style="width: ${percent}%"></span></div>` +
      `<div class="quiz-progress-stats">` +
        `<span>${answered}/${questions.length} отвечено</span>` +
        `<span>${correct}/${gradedTotal} правильно</span>` +
        `<span>${mistakes} ошибок</span>` +
      `</div>`;
    return progress;
  }

  function renderAutoQuestion(q) {
    const card = document.createElement("div");
    card.className = "quiz-q";
    card.innerHTML = `<div class="q-text">${renderMarkdownInline(q.text)}</div>`;

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
      const isRight = chosen === q.answer;
      if (isRight) correct++;
      else mistakes++;
      answered++;
      await updateWeakSpot(mod.id, q, isRight, chosen);
      await setModProgress(mod.id, {
        quizAttemptStatus: "in-progress",
        quizAnswered: answered,
        quizCorrect: correct,
        quizMistakes: mistakes,
      });
      for (const [b, key, state] of optButtons) {
        b.disabled = true;
        if (key === q.answer) {
          b.classList.add("correct");
          if (state) state.textContent = key === chosen ? "✓ Ваш ответ, правильный" : "✓ Правильный ответ";
        } else if (key === chosen) {
          b.classList.add("wrong");
          if (state) state.textContent = "× Ваш ответ";
        } else if (state) {
          state.textContent = "Не выбран";
        }
      }
      if (q.explain.trim()) {
        card.appendChild(QuizDiagnosis({ question: q, chosenKey: chosen, isRight }));
      }
      if (!isRight) card.appendChild(ReviewAddedLine());
      appendNextButton(card);
    }
  }

  function renderApplicationQuestion(q) {
    const card = document.createElement("div");
    card.className = "quiz-q";
    card.innerHTML =
      `<div class="q-text app-text">${renderMarkdown(q.text)}</div>` +
      `<div class="application-prompt">Сформулируйте ответ самостоятельно, затем откройте разбор. Этот вопрос не входит в автоматический балл.</div>`;

    const reveal = document.createElement("button");
    reveal.className = "btn";
    reveal.textContent = "Показать разбор";
    reveal.onclick = runAsync(async () => {
      reveal.disabled = true;
      answered++;
      await setModProgress(mod.id, {
        quizAttemptStatus: "in-progress",
        quizAnswered: answered,
        quizCorrect: correct,
        quizMistakes: mistakes,
      });
      if (q.explain.trim()) {
        const exp = QuizDiagnosis({ question: q, chosenKey: null, isRight: true });
        exp.classList.add("answer-block");
        card.appendChild(exp);
      }
      appendNextButton(card);
    });

    card.appendChild(reveal);
    $screen.appendChild(card);
  }

  function appendNextButton(container) {
    const next = document.createElement("button");
    next.className = "btn quiz-next";
    setButtonContent(next, idx + 1 < questions.length ? "Ответить на следующий вопрос" : "Завершить тест", "arrow");
    next.onclick = runAsync(async () => {
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
    const message = gradedTotal === 0
      ? "Открытые вопросы завершены."
    : correct === gradedTotal
        ? "сигнал чистый."
        : ratio >= 0.7
          ? "контур держится."
          : "вернёмся к теории.";

    $screen.innerHTML = "";
    const div = document.createElement("div");
    div.className = "quiz-result";
    div.innerHTML =
      `<div class="score-label">Автоматический результат</div>` +
      `<div class="score">${correct} / ${gradedTotal}</div>` +
      `<p>${message}</p>` +
      (applicationTotal ? `<p class="muted">Открытые вопросы: ${applicationTotal}. Они использованы для самопроверки и не входят в балл.</p>` : "") +
      (weakCount ? `<p class="muted">Для закрепления сохранено: ${weakCount} ${pluralizeQuestions(weakCount)}.</p>` : "");

    if (weakCount) {
      const review = document.createElement("button");
      review.className = "btn secondary";
      review.textContent = "Открыть закрепление";
      review.onclick = runAsync(() => openModuleReview(mod));
      div.appendChild(review);
    }

    const retry = document.createElement("button");
    retry.className = "btn";
    retry.textContent = "Пройти проверку ещё раз";
    retry.onclick = runAsync(() => showQuiz(mod));
    div.appendChild(retry);
    $screen.appendChild(div);
    appendModuleNavigation(mod, "quiz.md");
  }

  renderQuestion();
}

function showWeakSpots(mod) {
  $screen.innerHTML = "";
  syncActiveTab("__review__");

  const moduleItems = getModuleReviewItems(mod.id, { includeRetired: true });
  const grouped = reviewApi().groupReviewItems({ items: moduleItems }, new Date());
  const card = document.createElement("section");
  card.className = "review-card";

  if (!moduleItems.length) {
    card.innerHTML = `<h2>Слабые сигналы</h2><p>слабых сигналов нет. прибор спокоен.</p>`;
    $screen.appendChild(card);
    return;
  }

  card.innerHTML =
    `<h2>Слабые сигналы</h2>` +
    `<p class="muted">память видна: сегодня повторяем due-сигналы, остальные спокойно ждут своей даты.</p>`;

  const due = grouped.today.slice(0, reviewApi().DAILY_REVIEW_LIMIT);
  if (due.length) {
    const start = document.createElement("button");
    start.className = "btn btn-with-icon";
    setButtonContent(start, "закрепить сейчас ▸", "arrow");
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
      li.className = `weak-card ${item.retired ? "is-retired" : item.due <= todayISO() ? "is-due" : ""}`;
      const levelKey = item.levelKey || conceptLevelFromText(item.text).key;
      const number = item.questionNumber ? `Q${item.questionNumber}` : item.kind;
      li.innerHTML =
        `<div class="weak-card-head">` +
          `<span>${escapeHtml(number)}</span>` +
          `<strong>${escapeHtml(item.mistakeType || "Смешение уровней анализа")}</strong>` +
        `</div>` +
        `<p>${escapeHtml(item.text)}</p>` +
        ConceptTrail(levelKey, { compact: true, className: "weak-concept-trail" }) +
        `<div class="weak-meta">` +
          `<span>уровень: ${escapeHtml(item.level || conceptLevelFromText(item.text).label)}</span>` +
          `<span>ошибок: ${escapeHtml(item.errors || 0)}</span>` +
          `<span>${item.retired ? "усвоено" : `вернётся ${formatShortDate(item.due)}`}</span>` +
        `</div>`;
      list.appendChild(li);
    }
    section.appendChild(list);
    card.appendChild(section);
  };

  renderGroup("сегодня", grouped.today, "сегодня очередь пуста.");
  renderGroup("скоро", grouped.soon.slice(0, 12), "скоро ничего не ждёт.");
  renderGroup("усвоено", grouped.retired.slice(0, 12), "усвоенных сигналов пока нет.");

  const retry = document.createElement("button");
  retry.className = "btn secondary";
  retry.textContent = "пройти тест снова";
  retry.onclick = () => showQuiz(mod);

  const clear = document.createElement("button");
  clear.className = "btn secondary danger";
  clear.textContent = "очистить список";
  clear.onclick = runAsync(async () => {
    if (!confirm("Очистить слабые места этого модуля?")) return;
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

$back.onclick = runAsync(showHome);
$profile.onclick = runAsync(showProfile);
if (window.addEventListener) window.addEventListener("resize", updateTabsOverflowHint);
configureMarkedSecurity();

(async function init() {
  $screen.innerHTML = `<div class="loading">Загрузка модулей…</div>`;
  try {
    await storageApi().init();
    await storageApi().migrateFromLocalStorage();
    await refreshStorageCache();
    const [loadedManifest, loadedCourse] = await Promise.all([loadContentManifest(), loadCourse()]);
    contentManifest = loadedManifest;
    course = loadedCourse;
    modules = await discoverModules(contentManifest, course);
    await migrateReviewStateFromProgress();
    await showHome();
  } catch (error) {
    console.error("Nutrio init failed", error);
    $screen.innerHTML = `<div class="loading">Storage initialization failed. Check console.</div>`;
  }
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("SW register failed", error));
  });
}

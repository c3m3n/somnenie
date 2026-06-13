import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

class ClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }

  toggle(value, force) {
    const shouldAdd = force === undefined ? !this.values.has(value) : Boolean(force);
    if (shouldAdd) this.values.add(value);
    else this.values.delete(value);
    return shouldAdd;
  }
}

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.innerHTML = "";
    this.textContent = "";
    this.value = "";
    this.placeholder = "";
    this.disabled = false;
    this.onclick = null;
    this.href = "";
    this.download = "";
    this.type = "";
    this.clicked = false;
    this.classList = new ClassList(this);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
  }

  prepend(...children) {
    this.children.unshift(...children);
  }

  remove() {}
  click() {
    this.clicked = true;
    if (this.onclick) return this.onclick();
    return undefined;
  }
  scrollIntoView() {}
}

class MemoryIDBRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
    this.onblocked = null;
  }
}

class MemoryIDBObjectStore {
  constructor(transaction, storeState) {
    this.transaction = transaction;
    this.storeState = storeState;
  }

  put(value) {
    return this.transaction.request(() => {
      const record = cloneForIDB(value);
      const key = record?.[this.storeState.keyPath];
      if (key === undefined || key === null) throw new Error(`Missing keyPath ${this.storeState.keyPath}`);
      this.storeState.records.set(key, record);
      return key;
    });
  }

  get(key) {
    return this.transaction.request(() => cloneForIDB(this.storeState.records.get(key)));
  }

  getAll() {
    return this.transaction.request(() => Array.from(this.storeState.records.values(), cloneForIDB));
  }

  delete(key) {
    return this.transaction.request(() => {
      this.storeState.records.delete(key);
      return undefined;
    });
  }

  clear() {
    return this.transaction.request(() => {
      this.storeState.records.clear();
      return undefined;
    });
  }
}

class MemoryIDBTransaction {
  constructor(databaseState, storeNames) {
    this.databaseState = databaseState;
    this.storeNames = storeNames;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    this.error = null;
    this.pending = 0;
    this.completed = false;
    this.completeQueued = false;
    queueTask(() => this.queueComplete());
  }

  objectStore(name) {
    if (!this.storeNames.includes(name)) throw new Error(`Store ${name} is not in this transaction`);
    const storeState = this.databaseState.stores.get(name);
    if (!storeState) throw new Error(`Store ${name} does not exist`);
    return new MemoryIDBObjectStore(this, storeState);
  }

  request(operation) {
    const request = new MemoryIDBRequest();
    this.pending++;
    this.completeQueued = false;
    queueTask(() => {
      try {
        request.result = operation();
        request.onsuccess?.({ target: request });
      } catch (error) {
        request.error = error;
        this.error = error;
        request.onerror?.({ target: request });
        this.onerror?.({ target: this });
      } finally {
        this.pending--;
        this.queueComplete();
      }
    });
    return request;
  }

  queueComplete() {
    if (this.pending !== 0 || this.completed || this.completeQueued || this.error) return;
    this.completeQueued = true;
    queueTask(() => {
      if (this.pending !== 0 || this.completed || this.error) return;
      this.completed = true;
      this.oncomplete?.({ target: this });
    });
  }
}

class MemoryIDBDatabase {
  constructor(databaseState) {
    this.databaseState = databaseState;
    this.objectStoreNames = {
      contains: (name) => this.databaseState.stores.has(name),
    };
  }

  createObjectStore(name, options) {
    if (this.databaseState.stores.has(name)) throw new Error(`Store ${name} already exists`);
    this.databaseState.stores.set(name, { keyPath: options.keyPath, records: new Map() });
    return {};
  }

  transaction(storeNames) {
    return new MemoryIDBTransaction(
      this.databaseState,
      Array.isArray(storeNames) ? storeNames : [storeNames],
    );
  }
}

function queueTask(fn) {
  setTimeout(fn, 0);
}

function cloneForIDB(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createMemoryIndexedDB() {
  const databases = new Map();
  return {
    open(name, version) {
      const request = new MemoryIDBRequest();
      queueTask(() => {
        let state = databases.get(name);
        const oldVersion = state?.version || 0;
        const needsUpgrade = !state || (version && version > state.version);

        if (!state) {
          state = { version: version || 1, stores: new Map() };
          databases.set(name, state);
        }

        if (version && version > state.version) state.version = version;
        const db = new MemoryIDBDatabase(state);
        request.result = db;

        if (needsUpgrade) {
          request.onupgradeneeded?.({
            target: request,
            oldVersion,
            newVersion: state.version,
          });
        }

        queueTask(() => request.onsuccess?.({ target: request }));
      });
      return request;
    },
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function elementTreeText(element) {
  if (!element) return "";
  return [
    element.textContent || "",
    element.innerHTML || "",
    ...((element.children || []).map(elementTreeText)),
  ].join(" ");
}

async function waitUntil(predicate, message, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

const elementsById = new Map([
  ["screen", new Element("main")],
  ["tabs", new Element("nav")],
  ["title", new Element("h1")],
  ["back-btn", new Element("button")],
  ["profile-btn", new Element("button")],
]);

const localStore = new Map();
localStore.set("nutrio-profile", JSON.stringify({
  name: "Migrated Learner",
  goal: "Migrate safely",
  level: "review",
  startedAt: "2026-06-01",
  updatedAt: "2026-06-09T12:00:00.000Z",
}));
localStore.set("nutrio-progress", JSON.stringify({
  M02: {
    theoryRead: true,
    takeaway: "Migrated takeaway",
    takeawayUpdatedAt: "2026-06-09T12:00:00.000Z",
  },
}));
const objectUrls = [];
let lastAppendedElement = null;
const indexedDB = createMemoryIndexedDB();
const warnings = [];
const fetchLog = [];

const context = {
  console: {
    log: (...args) => console.log(...args),
    error: (...args) => console.error(...args),
    warn: (...args) => warnings.push(args.map(String).join(" ")),
  },
  setTimeout,
  clearTimeout,
  Blob,
  URLSearchParams,
  URL: {
    createObjectURL: (blob) => {
      objectUrls.push(blob);
      return `blob:mock-${objectUrls.length}`;
    },
    revokeObjectURL: () => {},
  },
  confirm: () => true,
  indexedDB,
  window: { indexedDB, scrollTo() {}, addEventListener() {}, location: { href: "http://127.0.0.1:8766/" } },
  navigator: {
    serviceWorker: {
      register: async () => ({}),
    },
  },
  document: {
    body: Object.assign(new Element("body"), {
      appendChild(child) {
        lastAppendedElement = child;
        this.children.push(child);
        return child;
      },
    }),
    createElement: (tagName) => new Element(tagName),
    getElementById: (id) => elementsById.get(id),
  },
  localStorage: {
    getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
  },
  marked: {
    Renderer: class {
      html(html) { return html; }
      link(href, title, text) {
        return `<a href="${href}"${title ? ` title="${title}"` : ""}>${text}</a>`;
      }
      image(href, title, text) {
        return `<img src="${href}" alt="${text || ""}"${title ? ` title="${title}"` : ""}>`;
      }
    },
    use(options) {
      this.renderer = options.renderer;
    },
    parse: (text) => String(text),
    parseInline: (text) => String(text),
  },
  fetch: async (url) => {
    fetchLog.push(String(url));
    const relativePath = String(url).split("/").join(path.sep);
    const filePath = path.join(projectRoot, relativePath);
    try {
      const text = await fs.readFile(filePath, "utf8");
      return { ok: true, text: async () => text };
    } catch {
      return { ok: false, text: async () => "" };
    }
  },
};

vm.createContext(context);

const constantsJs = await fs.readFile(path.join(projectRoot, "core", "constants.js"), "utf8");
vm.runInContext(constantsJs, context, { filename: "core/constants.js" });

const utilJs = await fs.readFile(path.join(projectRoot, "core", "util.js"), "utf8");
vm.runInContext(utilJs, context, { filename: "core/util.js" });

const storageJs = await fs.readFile(path.join(projectRoot, "core", "storage.js"), "utf8");
vm.runInContext(storageJs, context, { filename: "core/storage.js" });

const reviewJs = await fs.readFile(path.join(projectRoot, "core", "review.js"), "utf8");
vm.runInContext(reviewJs, context, { filename: "core/review.js" });

const quizJs = await fs.readFile(path.join(projectRoot, "core", "quiz.js"), "utf8");
vm.runInContext(quizJs, context, { filename: "core/quiz.js" });

const learningPathJs = await fs.readFile(path.join(projectRoot, "core", "learningPath.js"), "utf8");
vm.runInContext(learningPathJs, context, { filename: "core/learningPath.js" });

const appJs = await fs.readFile(path.join(projectRoot, "app.js"), "utf8");
vm.runInContext(appJs, context, { filename: "app.js" });

const sessionViewJs = await fs.readFile(path.join(projectRoot, "views", "session.js"), "utf8");
vm.runInContext(sessionViewJs, context, { filename: "views/session.js" });

const quizViewJs = await fs.readFile(path.join(projectRoot, "views", "quiz.js"), "utf8");
vm.runInContext(quizViewJs, context, { filename: "views/quiz.js" });

const screen = elementsById.get("screen");
const tabs = elementsById.get("tabs");
const title = elementsById.get("title");
const storage = context.window.NutrioStorage;

await waitUntil(
  () => title.textContent === "Сегодня" && screen.children.some((child) => child.className.includes("today-screen")),
  "Home screen did not finish rendering",
);

assert(title.textContent === "Сегодня", "Today title did not render");
assert(screen.children[0].className.includes("intro-card"), "Intro card is missing");
assert(screen.children[0].className.includes("today-screen"), "Today screen container is missing");
assert(screen.children[0].innerHTML.includes("next-step-card"), "Home should lead with the next learning step");
assert(screen.children[0].innerHTML.includes("today-card"), "Today should render the next act as the primary card");
assert(screen.children[0].innerHTML.includes("safety-note"), "Home should expose the medical safety boundary");
assert(!screen.children[0].innerHTML.includes("hero-visual"), "Home should not lead with a decorative hero visual");
assert(screen.children[0].innerHTML.includes("home-atlas-link"), "Home should offer a quiet link to the course map");
assert(!screen.children[0].innerHTML.includes("course-map-segment"), "Home should not embed the full segmented map (Atlas owns it)");
const initialHomeActions = screen.children[0].children.find((child) => child.className === "home-actions");
assert(initialHomeActions, "Home actions are missing");
assert(initialHomeActions.children.length === 1, "Home should expose exactly one primary learning action");
assert(initialHomeActions.children[0].textContent === "Начать", "Today CTA should expose one direct action");

let appState = await storage.getAppState();
assert(appState.schemaVersion === 2, "Storage appState should use schema v2");
assert(appState.review.courseId === "nutrition", "Review state should carry the nutrition course id");
assert(appState.sessions.courseId === "nutrition", "Session state should carry the nutrition course id");
assert(screen.children[0].innerHTML.includes("учебных станций"), "Home should explain progress as completed stations");
assert(!screen.children[0].innerHTML.includes("map-legend"), "Home should not carry the course-map legend (Atlas owns the map)");
assert(screen.children[0].innerHTML.includes("сегодня ·"), "Home should carry the current-day station locator");
assert(screen.children[0].innerHTML.includes("home-protocol"), "Home should expose the protocol scale");
assert(!screen.children[0].innerHTML.includes("NUTRIO"), "Old NUTRIO brand should not remain on home");
assert(!screen.children[0].innerHTML.includes("home-metrics"), "Home should not lead with dashboard-style KPI cards");
assert(!screen.children[0].innerHTML.includes("Экспорт прогресса"), "Home should not expose export action");
assert(!screen.children[0].innerHTML.includes("Сбросить прогресс"), "Home should not expose reset action");
assert(!screen.children[0].innerHTML.includes("Открыть кабинет"), "Home should not duplicate progress action");
const homeModuleCards = screen.children.filter((child) => child.className === "module-card");
assert(homeModuleCards.length === 0, "Today should not expose the course catalog as module cards");
const homePhaseHeaders = screen.children.filter((child) => child.className === "phase-header");
assert(homePhaseHeaders.length === 0, "Today should not expose phase headers as the main navigation");
assert(typeof context.showAtlas === "function", "Atlas screen function should be available");
await context.showAtlas();
assert(title.textContent === "Карта курса", "Atlas screen did not open");
assert(screen.children.some((child) => (child.innerHTML || "").includes("course-map-segment")), "Atlas should expose the segmented course map");
assert(screen.children.some((child) => (child.innerHTML || "").includes("map-legend")), "Atlas should explain map states with a legend");
const atlasModuleCards = screen.children.filter((child) => child.className === "module-card");
assert(atlasModuleCards.length === 24, `Expected 24 module cards in Atlas, got ${atlasModuleCards.length}`);
const atlasPhaseHeaders = screen.children.filter((child) => child.className === "phase-header");
assert(atlasPhaseHeaders.length === 6, `Expected 6 phase headers in Atlas, got ${atlasPhaseHeaders.length}`);
await elementsById.get("back-btn").onclick();
assert(title.textContent === "Сегодня", "Back from Atlas did not return Today");
assert(fetchLog.includes("content/manifest.json"), "App should load content/manifest.json");
assert(!fetchLog.some((url) => /content[\\/]M(2[5-9]|[3-5][0-9]|60)[\\/]theory\.md/.test(url)), "App should not probe missing M25-M60 theory files");

assert(!localStore.has("nutrio-profile"), "Migrated profile localStorage key should be deleted");
assert(!localStore.has("nutrio-progress"), "Migrated progress localStorage key should be deleted");
const migratedProfile = await storage.getProfile();
assert(migratedProfile.name === "Migrated Learner", "Profile was not migrated into IndexedDB");
const migratedProgress = await storage.getAllProgress();
assert(migratedProgress.M02?.takeaway === "Migrated takeaway", "Progress was not migrated into IndexedDB");
localStore.set("nutrio-profile", "null");
const skippedMigration = await storage.migrateFromLocalStorage();
assert(skippedMigration.skipped, "Unexpected legacy localStorage shape should be skipped");
assert(localStore.has("nutrio-profile"), "Skipped migration should preserve unexpected localStorage data");
assert(warnings.some((message) => message.includes("unexpected shape")), "Skipped migration should warn about unexpected shape");
localStore.delete("nutrio-profile");

const profileButton = elementsById.get("profile-btn");
await profileButton.onclick();
assert(title.textContent === "Прогресс обучения", "Progress screen did not open");

const profileCard = screen.children.find((child) => child.className === "profile-card");
assert(profileCard, "Profile card is missing");
const profileDashboardIndex = screen.children.findIndex((child) => child.className.includes("dashboard-card") && child.innerHTML.includes("Прогресс"));
const profileReviewIndex = screen.children.findIndex((child) => child.className.includes("dashboard-card") && child.innerHTML.includes("<h2>Память</h2>"));
const profileTakeawaysIndex = screen.children.findIndex((child) => child.className.includes("dashboard-card") && child.innerHTML.includes("История выводов"));
const profilePhasesIndex = screen.children.findIndex((child) => child.className.includes("dashboard-card") && child.innerHTML.includes("Прогресс по фазам"));
const profileCardIndex = screen.children.findIndex((child) => child === profileCard);
const profileDataIndex = screen.children.findIndex((child) => child.className.includes("dashboard-card") && child.innerHTML.includes("Данные"));
assert(profileDashboardIndex !== -1, "Profile dashboard summary is missing");
assert(profileReviewIndex !== -1, "Profile review section is missing");
assert(profileTakeawaysIndex !== -1, "Profile takeaways section is missing");
assert(profilePhasesIndex !== -1, "Profile phase progress section is missing");
assert(profileDataIndex !== -1, "Profile data section is missing");
assert(profileDashboardIndex < profileReviewIndex, "Profile should start with progress before review");
assert(profileReviewIndex < profileTakeawaysIndex, "Profile review should appear before takeaways");
assert(profileTakeawaysIndex < profilePhasesIndex, "Profile takeaways should appear before phase progress");
assert(profilePhasesIndex < profileCardIndex, "Profile form should appear after learning dashboards");
assert(profileCardIndex < profileDataIndex, "Profile data actions should stay at the bottom");
const continueTraining = screen.children
  .find((child) => child.className && child.className.includes("dashboard-primary"))
  ?.children.find((child) => child.className === "dashboard-actions")
  ?.children.find((child) => child.className && child.className.includes("btn"));
assert(continueTraining, "Progress screen should offer a primary continue action");

const profileInputs = profileCard.children.filter((child) => child.className && child.className.includes("profile-input"));
assert(profileInputs[0].value === "Migrated Learner", "Migrated profile was not shown in the profile form");
profileInputs[0].value = "Test Learner";
profileInputs[1].value = "Проверить учебный кабинет";
profileInputs[2].value = "familiar";
profileInputs[3].value = "2026-06-10";
const saveProfile = profileCard.children.find((child) => child.textContent === "Сохранить профиль");
await saveProfile.onclick();

const profile = await storage.getProfile();
assert(profile.name === "Test Learner", "Profile name was not saved");
assert(profile.level === "familiar", "Profile level was not saved");

await elementsById.get("back-btn").onclick();
assert(title.textContent === "Сегодня", "Back from profile did not return Today");

await context.showAtlas();
const firstModuleCard = screen.children.find((child) => child.className === "module-card");
await firstModuleCard.onclick();

assert(title.textContent === "M01", "Module header should use a compact module id");
const tabButtons = tabs.children.filter((child) => child.tagName === "button" && child.dataset.file);
const mobileTabSelect = tabs.children.find((child) => child.tagName === "select" && child.className === "mobile-tab-select");
assert(tabButtons.length === 4, `Expected 4 station route buttons before weak-spot review exists, got ${tabButtons.length}`);
assert(tabButtons.some((child) => child.innerHTML.includes("tab-icon")), "Study tabs should expose activity icons");
assert(!mobileTabSelect, "Mobile module navigation should not use a hidden route select");
assert(tabButtons.map((child) => child.textContent).join("|") === "Понять|Применить|Проверить|Закрепить", "Station route should use Understand, Apply, Check, Anchor");
assert(tabButtons.every((child) => child.dataset.step), "Each station route step should carry a step key for the stepper");
assert(tabButtons.filter((child) => child.classList.contains("active")).length === 1, "Stepper should mark exactly one current step");
assert(tabButtons.filter((child) => child.classList.contains("is-future")).length === 3, "Unstarted station should show the three later steps as quiet/future");
const stepNumbers = tabButtons.map((child) => (String(child.innerHTML).match(/tab-step-num">(\d+)</) || [])[1] || "");
assert(stepNumbers.join("") === "1234", `Stepper nodes should be numbered 1-4 in route order, got [${stepNumbers.join(",")}]`);
assert(!tabButtons.some((child) => child.classList.contains("is-done")), "A fresh station should have no completed steps yet");
assert(!screen.children.some((child) => child.className === "study-card"), "Theory should not close station progress on the first block");
assert(screen.children.some((child) => child.className === "material-subnav"), "Material blocks should render local navigation");
assert(screen.children.some((child) => child.className === "material-subnav" && child.children.filter((tab) => tab.dataset.file).map((tab) => tab.dataset.file).join("|") === "theory.md|terms.md"), "Understand step should only expose theory and terms blocks");

let lessonNav = screen.children.filter((child) => child.className === "lesson-nav").at(-1);
assert(lessonNav, "Theory tab should render bottom lesson navigation");
let navActions = lessonNav.children.find((child) => child.className === "lesson-nav-actions");
const theoryNext = navActions.children.find((child) => child.className.includes("lesson-nav-next"));
assert(theoryNext?.textContent === "Перейти к терминам", "Theory next action should lead to terms");
await theoryNext.onclick();
assert(tabs.children.some((child) => child.dataset.file === "theory.md" && child.classList.contains("active")), "Top route should keep Understand active for terms");
assert(screen.children.some((child) => child.className === "material-subnav" && child.children.some((tab) => tab.dataset.file === "terms.md" && tab.classList.contains("active"))), "Material subnav should open the terms block");

lessonNav = screen.children.filter((child) => child.className === "lesson-nav").at(-1);
navActions = lessonNav.children.find((child) => child.className === "lesson-nav-actions");
const termsPrev = navActions.children.find((child) => child.className.includes("lesson-nav-prev"));
assert(termsPrev?.textContent === "Назад: Главная мысль", "Terms tab should offer a route back to the key idea");
await termsPrev.onclick();
assert(tabs.children.some((child) => child.dataset.file === "theory.md" && child.classList.contains("active")), "Bottom navigation should return to theory");

await theoryNext.onclick();
lessonNav = screen.children.filter((child) => child.className === "lesson-nav").at(-1);
navActions = lessonNav.children.find((child) => child.className === "lesson-nav-actions");
const termsNext = navActions.children.find((child) => child.className.includes("lesson-nav-next"));
assert(termsNext?.textContent === "Перейти к примеру", "Terms should lead into the Apply step");
await termsNext.onclick();
assert(tabs.children.some((child) => child.dataset.file === "practice.md" && child.classList.contains("active")), "Top route should switch to Apply for practice");
assert(screen.children.some((child) => child.className === "material-subnav" && child.children.filter((tab) => tab.dataset.file).map((tab) => tab.dataset.file).join("|") === "practice.md|diagrams.md"), "Apply step should only expose practice and diagrams blocks");

lessonNav = screen.children.filter((child) => child.className === "lesson-nav").at(-1);
navActions = lessonNav.children.find((child) => child.className === "lesson-nav-actions");
const practiceNext = navActions.children.find((child) => child.className.includes("lesson-nav-next"));
assert(practiceNext?.textContent === "Перейти к схемам", "Practice should lead to diagrams before check");
await practiceNext.onclick();
const materialStudyCard = screen.children.find((child) => child.className === "study-card");
assert(materialStudyCard, "Completion controls should appear on the last material block");
assert(!materialStudyCard.children.some((child) => child.tagName === "textarea"), "Takeaway input should not live on the material screen");

const summaryTab = tabs.children.find((child) => child.dataset.file === "summary.md");
await summaryTab.onclick();
const summaryStudyCard = screen.children.filter((child) => child.className === "study-card").at(-1);
assert(summaryStudyCard, "Summary step should host the takeaway controls");
const takeawayInput = summaryStudyCard.children.find((child) => child.tagName === "textarea");
assert(takeawayInput, "Summary step should expose the takeaway input");
assert(!summaryStudyCard.children.some((child) => child.textContent === "Сохранить вывод"), "Summary should not require a manual save button");
const continueAfterTakeaway = summaryStudyCard.children.find((child) => child.textContent === "Продолжить");
assert(continueAfterTakeaway, "Summary should expose a continue CTA");

await waitUntil(async () => {
  const savedProgress = await storage.getAllProgress();
  return Boolean(savedProgress.M01?.takeaway);
}, "Summary takeaway was not auto-saved");

let progress = await storage.getAllProgress();
const autoTakeaway = progress.M01.takeaway;
takeawayInput.value = "";
takeawayInput.oninput?.();
await new Promise((resolve) => setTimeout(resolve, 550));
progress = await storage.getAllProgress();
assert(progress.M01.takeaway === autoTakeaway, "Empty draft should not erase the saved takeaway");

takeawayInput.value = "Проверочный вывод";
takeawayInput.oninput?.();
await waitUntil(async () => {
  const draftProgress = await storage.getAllProgress();
  return draftProgress.M01?.takeawayDraft === "Проверочный вывод";
}, "Takeaway draft was not auto-saved");

progress = await storage.getAllProgress();
assert(progress.M01.takeaway === autoTakeaway, "Draft should not replace the journal takeaway before continue");
await continueAfterTakeaway.onclick();
await waitUntil(async () => {
  const committedProgress = await storage.getAllProgress();
  return committedProgress.M01?.takeaway === "Проверочный вывод";
}, "Edited takeaway was not committed");

progress = await storage.getAllProgress();
assert(progress.M01.takeaway === "Проверочный вывод", "Takeaway was not saved");

await context.showAtlas();
const firstModuleCardForQuiz = screen.children.find((child) => child.className === "module-card");
await firstModuleCardForQuiz.onclick();

const quizMd = await fs.readFile(path.join(projectRoot, "content", "M01", "quiz.md"), "utf8");
const parsedQuestions = context.parseQuiz(quizMd);
assert(parsedQuestions.length === 10, `Expected 10 M01 questions, got ${parsedQuestions.length}`);
assert(parsedQuestions.filter((q) => q.kind === "auto").length === 7, "Expected 7 automatic M01 questions");
assert(parsedQuestions.filter((q) => q.kind === "application").length === 3, "Expected 3 application M01 questions");

const quizTab = tabs.children.find((child) => child.dataset.file === "quiz.md");
quizTab.onclick();

const quizIntro = screen.children.filter((child) => child.className === "quiz-intro").at(-1);
assert(quizIntro, "Quiz intro did not render");
assert(quizIntro.innerHTML.includes("safety-note"), "Quiz intro should expose the medical safety boundary");
assert(quizIntro.innerHTML.includes("7") && quizIntro.innerHTML.includes("автоматический балл"), "Quiz intro should explain scored questions");
assert(quizIntro.innerHTML.includes("3") && quizIntro.innerHTML.includes("самопроверки"), "Quiz intro should explain self-check questions");
assert(quizIntro.innerHTML.includes("материалы на повторение") && quizIntro.innerHTML.includes("сессии памяти"), "Quiz intro should explain memory routing");
assert(quizIntro.innerHTML.includes("70%") && quizIntro.innerHTML.includes("5-8 мин"), "Quiz intro should explain success criteria and expected duration");
  assert(!screen.children.some((child) => child.className === "quiz-q"), "Quiz should not start before the intro button");
  lessonNav = screen.children.filter((child) => child.className === "lesson-nav").at(-1);
  assert(lessonNav, "Quiz intro should keep module navigation visible");
  assert(elementTreeText(lessonNav).includes("шаг 3 из 4"), "Quiz intro route should count station steps, not markdown files");
  const quizSticky = lessonNav.children.find((child) => child.className === "module-next-sticky");
  assert(!quizSticky, "Quiz intro should not duplicate the primary start CTA");
  const startQuiz = quizIntro.children.find((child) => child.textContent === "Начать проверку");
assert(startQuiz, "Quiz intro start button is missing");
await startQuiz.onclick();

const quizCard = screen.children.find((child) => child.className === "quiz-q");
assert(quizCard, "Quiz card did not render");

const firstOption = quizCard.children.find((child) => child.className === "opt");
assert(firstOption, "First quiz option did not render");
await Promise.all([firstOption.onclick(), firstOption.onclick()]);

progress = await storage.getAllProgress();
assert(Object.keys(progress.M01.weakSpots || {}).length === 1, "Wrong answer did not create a weak spot");
assert(progress.M01.quizAnswered === 1, "Double-clicked answer should count as one answered quiz question");
assert(progress.M01.quizAttemptStatus === "in-progress", "First answer should mark the quiz attempt as in progress");
appState = await storage.getAppState();
const reviewItem = appState.review.items.find((item) => item.id === "M01-q1");
assert(appState.review.items.filter((item) => item.id === "M01-q1").length === 1, "Double-clicked answer should create one SRS review item");
assert(reviewItem, "Wrong answer should create an SRS review item");
assert(reviewItem.courseId === "nutrition", "Review item should carry courseId");
assert(reviewItem.interval === 1 && reviewItem.lastResult === "wrong", "Wrong answer should schedule the signal for tomorrow");
assert(reviewItem.diagnosticType, "Review item should carry an internal diagnostic type");
assert(reviewItem.userLabel, "Review item should carry a human-readable weak spot label");
assert(reviewItem.shortExplanation, "Review item should carry a short weak spot explanation");
assert(reviewItem.reviewStrategy, "Review item should carry a weak spot review strategy");

await elementsById.get("back-btn").onclick();
assert(!screen.children.find((child) => child.className === "home-review"), "Home should not show reinforcement before the quiz is complete");

assert(typeof context.setModProgress === "function", "setModProgress helper should be available in smoke context");
await context.setModProgress("M01", {
  theoryRead: true,
  takeaway: "Проверочный вывод",
  takeawayUpdatedAt: "2026-06-10T12:00:00.000Z",
  weakSpots: {
    1: {
      number: 1,
      text: "Проверочное слабое место",
      level: "Базовое различение",
      levelKey: "concept",
      mistakeType: "Смешение уровней анализа",
      diagnosticType: "смешение_уровней_анализа",
      userLabel: "Смешение уровней анализа",
      shortExplanation: "Сначала определить уровень вопроса, затем делать вывод.",
      reviewStrategy: "Ответить на новый вопрос с тем же типом рассуждения.",
      misses: 1,
      updatedAt: "2026-06-10T12:00:00.000Z",
    },
  },
  quizAttemptStatus: "complete",
  quizBest: 0,
  quizTotal: 7,
  quizOpenTotal: 3,
  quizVersion: 2,
});
const forcedProgress = await storage.getAllProgress();
assert(forcedProgress.M01?.theoryRead === true, `Forced M01 progress was not saved: ${JSON.stringify(forcedProgress.M01 || null)}`);
await context.showHome();
assert(!screen.children.find((child) => child.className === "home-review"), "Today should not become a review dashboard after quiz completion");
assert(
  screen.children[0].innerHTML.includes("M01.1"),
  `Today should keep the user in the unfinished station loop: ${screen.children[0].innerHTML.slice(0, 500)}`,
);
await context.showAtlas();
const reviewButton = screen.children
  .filter((child) => child.className === "module-card" && child.innerHTML.includes("M01"))
  .at(-1);
assert(reviewButton, "Atlas should still expose modules with weak spots");
assert(reviewButton.innerHTML.includes("M01"), "Atlas review module should identify the weak module");
assert(reviewButton.innerHTML.includes("закрепить"), `Atlas should mark the weak module for reinforcement: ${reviewButton.innerHTML}`);
await reviewButton.onclick();
assert(title.textContent === "M01", "Review shortcut should open the module");
const reviewTab = tabs.children.find((child) => child.dataset.file === "__review__");
assert(reviewTab, "Module with weak spots should expose the review tab");
await reviewTab.onclick();
assert(tabs.children.some((child) => child.dataset.file === "__review__" && child.classList.contains("active")), "Review tab should open the review screen");
const memoryScreen = screen.children.find((child) => child.className === "review-card");
const memoryScreenText = elementTreeText(memoryScreen);
assert(memoryScreenText.includes("Память") && memoryScreenText.includes("темы") && memoryScreenText.includes("закрепить"), "Review screen should use memory reinforcement terminology");
assert(memoryScreenText.includes("Как тренируем"), "Memory screen should explain the review strategy");
assert(memoryScreenText.includes("Исходный пример"), "Memory card should surface the original example as visible source context");
assert(memoryScreenText.includes("интервал"), "Memory card should materialize the spaced-repetition interval");

// Сеанс повторения (views/session.js): прогоняем startLearningSession → showReviewSession
// на реальной SRS-карточке M01-q1 (создана неверным ответом выше). Финальный экран
// (renderFinal) опирается на парсинг innerHTML живого DOM, которого нет в этом mock,
// поэтому доводим до ответа + записи в сторадж, но не кликаем «Завершить повторение».
appState = await storage.getAppState();
const sessionSeedItem = appState.review.items.find((item) => item.id === "M01-q1");
assert(sessionSeedItem, "Expected the M01-q1 review item to drive a memory session");
const reviewsBeforeSession = appState.sessions.todayDone.reviews || 0;
await context.startLearningSession({ reviewOnly: true, items: [sessionSeedItem] });
assert(title.textContent === "Сеанс", "Memory session should set the Сеанс title");
const sessionScreen = screen.children.find((child) => (child.className || "").includes("review-session"));
assert(sessionScreen, "Memory session did not render");
assert(sessionScreen.innerHTML.includes("session-head"), "Session should render its progress header");
const sessionCard = sessionScreen.children.find((child) => (child.className || "").includes("session-question"));
assert(sessionCard, "Session question card did not render");
const sessionOption = sessionCard.children.find((child) => child.className === "opt");
assert(sessionOption, "Session question should render answer options");
await sessionOption.onclick();
const sessionNext = sessionCard.children.find((child) => child.className === "btn quiz-next");
assert(sessionNext, "Answered session question should expose a next button");
assert(sessionNext.textContent === "Завершить повторение", "Single-item session should offer to finish");
appState = await storage.getAppState();
assert((appState.sessions.todayDone.reviews || 0) > reviewsBeforeSession, "Session answer should record a review activity in storage");

await context.exportProgress();
assert(lastAppendedElement?.download?.startsWith("nutrio-data-"), "Export filename should start with nutrio-data-");
assert(lastAppendedElement.download.endsWith(".json"), "Export filename should end with .json");
assert(objectUrls.length === 1, "Export should create one object URL");
const exported = JSON.parse(await objectUrls[0].text());
assert(exported.profile.name === "Test Learner", "Export should include the IndexedDB profile");
assert(exported.progress.M01.takeaway === "Проверочный вывод", "Export should include the IndexedDB progress");
assert(exported.schemaVersion === 2, "Export should include schemaVersion");
assert(exported.review.items.some((item) => item.id === "M01-q1"), "Export should include SRS review items");
assert(exported.sessions.courseId === "nutrition", "Export should include session state");

await profileButton.onclick();
const resetProfileButton = screen.children
  .find((child) => child.className === "profile-card")
  .children.find((child) => child.textContent === "Сбросить профиль");
await resetProfileButton.onclick();
assert(await storage.getProfile() === null, "Profile reset should clear the IndexedDB profile");
progress = await storage.getAllProgress();
assert(progress.M01?.takeaway === "Проверочный вывод", "Profile reset should not remove IndexedDB progress");

const resetProgressButton = screen.children
  .find((child) => child.className.includes("dashboard-card") && child.innerHTML.includes("Данные"))
  .children.find((child) => child.textContent === "Сбросить прогресс");
await resetProgressButton.onclick();
progress = await storage.getAllProgress();
assert(Object.keys(progress).length === 0, "Progress reset should clear IndexedDB progress");
appState = await storage.getAppState();
assert(appState.review.items.length === 0, "Progress reset should clear the review queue");

for (let i = 1; i <= 24; i++) {
  const id = `M${String(i).padStart(2, "0")}`;
  await storage.saveModuleProgress(id, {
    theoryRead: true,
    takeaway: "Завершено",
    quizBest: 7,
    quizTotal: 7,
    quizVersion: 2,
    weakSpots: {},
  });
}
await context.showHome();
const completedIntros = screen.children.filter((child) => child.className.includes("today-screen"));
const completedIntro = completedIntros[completedIntros.length - 1];
const completedActions = completedIntro.children.find((child) => child.className === "home-actions");
assert(completedActions.children.length === 1, "Completed course should still show one recommended action");
assert(completedActions.children[0].textContent === "Открыть журнал", "Completed course should route to a supporting mode, not a stale learning CTA");
assert(!completedIntro.innerHTML.includes("%%"), "Average score should not render a double percent sign");

// Кнопка «Назад» (стек навигации): Atlas -> модуль -> назад возвращает в Atlas,
// затем -> назад из Atlas ведёт домой. Раньше «Назад» всегда уводила на главную.
await context.showHome();
await context.showAtlas();
assert(title.textContent === "Карта курса", "Atlas should open");
const navModuleCard = screen.children.find((child) => child.className === "module-card");
assert(navModuleCard, "Atlas should expose module cards to open");
await navModuleCard.onclick();
assert(title.textContent !== "Карта курса", "A module should open from the Atlas card");
await elementsById.get("back-btn").onclick();
assert(title.textContent === "Карта курса", "Back from a module opened via Atlas should return to Atlas, not Home");
await elementsById.get("back-btn").onclick();
assert(title.textContent === "Сегодня", "Back from Atlas should return Home");

const maliciousMarkdown = `<script>alert(1)</script><img src=x onerror=alert(1)>[bad](javascript:alert(1))<span onclick=alert(1)>x</span>`;
const renderedMalicious = context.renderMarkdown(maliciousMarkdown);
assert(!/<script|<img|onerror=|onclick=|javascript:/i.test(renderedMalicious), "Markdown renderer should strip executable HTML and unsafe URLs");
const renderedInlineMalicious = context.renderMarkdownInline(`[bad](javascript:alert(1)) <svg onload=alert(1)>x</svg>`);
assert(!/<svg|onload=|javascript:/i.test(renderedInlineMalicious), "Inline Markdown renderer should strip executable HTML and unsafe URLs");

const sw = await fs.readFile(path.join(projectRoot, "sw.js"), "utf8");
assert(/const VERSION = "nutrio-v\d+";/.test(sw), "Service worker should declare a nutrio-vN cache version");
assert(sw.includes('"./core/storage.js"'), "Service worker should cache the IndexedDB storage layer");
assert(sw.includes('"./core/review.js"'), "Service worker should cache the SRS review layer");
assert(sw.includes('"./core/learningPath.js"'), "Service worker should cache the block checkpoint learning path layer");
assert(sw.includes('"./fonts/IBMPlexMono-Regular.woff2"'), "Service worker should cache local fonts");
assert(sw.includes('contentCache.add("content/manifest.json")'), "Service worker should cache content/manifest.json");
assert(sw.includes('fetchJson("content/manifest.json")'), "Service worker should use content manifest for precache");
assert(sw.includes("precacheContent().catch"), "Service worker should warm content cache without blocking activation");
assert(sw.includes('fetch(req, { cache: "no-cache" })'), "Service worker should use network-first for mutable resources");
assert(sw.includes('url.pathname.includes("/content/")'), "Service worker should explicitly classify content resources");
assert(sw.includes('k.startsWith("nutrio-") && !k.startsWith(VERSION)'), "Service worker should only delete Nutrio caches");
assert(sw.includes('event.data?.type === "SKIP_WAITING"'), "Service worker should only skip waiting after an explicit app message");
const installHandler = sw.match(/self\.addEventListener\("install",[\s\S]*?\n\}\);/);
assert(installHandler && !installHandler[0].includes("skipWaiting"), "Service worker install should not force skipWaiting");

const appJsSource = await fs.readFile(path.join(projectRoot, "app.js"), "utf8");
assert(appJsSource.includes("navigator.serviceWorker.addEventListener(\"controllerchange\""), "App should reload after an accepted service worker update");
assert(appJsSource.includes("registration.addEventListener(\"updatefound\""), "App should detect waiting service worker updates");
assert(appJsSource.includes("registration.waiting.postMessage"), "App should activate a waiting service worker only after user confirmation");
assert(appJsSource.includes("serviceWorkerReloadPending = true"), "App should mark reload intent only after the user accepts an update");
assert(appJsSource.includes("if (!serviceWorkerReloadPending) return;"), "App should not reload on first service worker control claim");

const vercelIgnore = await fs.readFile(path.join(projectRoot, ".vercelignore"), "utf8");
assert(vercelIgnore.split(/\r?\n/).includes(".vercel"), ".vercelignore should exclude .vercel");

const startBat = await fs.readFile(path.join(projectRoot, "start.bat"), "utf8");
assert(startBat.includes("--bind 127.0.0.1"), "start.bat should bind the local server to 127.0.0.1");

const readme = await fs.readFile(path.join(projectRoot, "README.md"), "utf8");
const legacyDeploymentHost = `${["nutrio", "app", "bay"].join("-")}.${["vercel", "app"].join(".")}`;
const readmeForbidden = [
  ["absolute Windows path", new RegExp("[A-Z]:\\\\", "i")],
  ["old deployment URL", new RegExp(legacyDeploymentHost.replace(/[.]/g, "\\."), "i")],
  ["drive-specific cd command", /cd\s+\/d/i],
];
for (const [label, pattern] of readmeForbidden) {
  assert(!pattern.test(readme), `README should not expose ${label}`);
}
assert(readme.includes("git clone https://github.com/c3m3n/somnenie.git"), "README should use portable clone instructions");

const indexHtml = await fs.readFile(path.join(projectRoot, "index.html"), "utf8");
assert(!/<script>\s*if \("serviceWorker" in navigator\)/.test(indexHtml), "index.html should not contain inline service worker registration script");

const vercelConfig = JSON.parse(await fs.readFile(path.join(projectRoot, "vercel.json"), "utf8"));
const allHeaders = vercelConfig.headers.flatMap((entry) => entry.headers || []);
const headerValue = (key) => allHeaders.find((header) => header.key.toLowerCase() === key.toLowerCase())?.value || "";
const headersFor = (source) => vercelConfig.headers.find((entry) => entry.source === source)?.headers || [];
const headerForSource = (source, key) => headersFor(source).find((header) => header.key.toLowerCase() === key.toLowerCase())?.value || "";
assert(headerValue("Content-Security-Policy").includes("script-src 'self'"), "CSP should restrict scripts to self");
assert(headerValue("Content-Security-Policy").includes("object-src 'none'"), "CSP should block plugin/object content");
assert(headerValue("X-Content-Type-Options") === "nosniff", "Security headers should include X-Content-Type-Options nosniff");
assert(Boolean(headerValue("Referrer-Policy")), "Security headers should include Referrer-Policy");
assert(Boolean(headerValue("Permissions-Policy")), "Security headers should include Permissions-Policy");
assert(headerForSource("/sw.js", "Cache-Control").includes("no-store"), "sw.js should be served without browser caching");
assert(headerForSource("/app.js", "Cache-Control").includes("must-revalidate"), "app.js should be served with revalidation");
assert(headerForSource("/content/(.*)", "Cache-Control").includes("must-revalidate"), "content files should be served with revalidation");
assert(headerForSource("/fonts/(.*)", "Cache-Control").includes("stale-while-revalidate"), "font assets should keep a bounded static cache");

console.log("Smoke test passed.");

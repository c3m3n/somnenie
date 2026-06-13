import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const APP_URL = process.env.NUTRIO_E2E_URL || "http://127.0.0.1:8766/";
const ORIGIN = new URL(APP_URL).origin;
const DEBUG_PORT = Number(process.env.NUTRIO_E2E_DEBUG_PORT || 9240);

function commandMatches(program) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(command, [program], { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function browserCandidates() {
  const installRoots = [
    process.env.PROGRAMFILES,
    process.env["PROGRAMFILES(X86)"],
    process.env.LOCALAPPDATA,
  ].filter(Boolean);

  const candidates = [
    process.env.CHROME_PATH,
    ...commandMatches("chrome"),
    ...commandMatches("chrome.exe"),
    ...commandMatches("msedge"),
    ...commandMatches("msedge.exe"),
  ];

  for (const root of installRoots) {
    candidates.push(path.join(root, "Google", "Chrome", "Application", "chrome.exe"));
    candidates.push(path.join(root, "Microsoft", "Edge", "Application", "msedge.exe"));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

const chromePath = browserCandidates().find((candidate) => fs.existsSync(candidate));
if (!chromePath) throw new Error("Chrome or Edge executable was not found. Set CHROME_PATH to run production E2E.");

const userDataDir = path.join(os.tmpdir(), `nutrio-prod-e2e-${Date.now()}`);
const screenshotDir = path.join(os.tmpdir(), "nutrio-prod-e2e-shots");
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

const desktopShot = path.join(screenshotDir, "prod-today-desktop.png");
const memoryShot = path.join(screenshotDir, "prod-memory-session.png");
const mobileShot = path.join(screenshotDir, "prod-today-mobile.png");
const mobileModuleShot = path.join(screenshotDir, "prod-station-mobile.png");

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-proxy-server",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${userDataDir}`,
  "--window-size=1280,900",
  "about:blank",
], { stdio: "ignore" });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

async function waitForDevTools() {
  for (let i = 0; i < 50; i++) {
    try { return await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`); }
    catch { await delay(200); }
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  };

  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({
      events,
      send(method, params = {}, sessionId = null) {
        const id = ++seq;
        const message = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        ws.send(JSON.stringify(message));
        return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }));
      },
      close() {
        ws.close();
      },
    });
    ws.onerror = () => reject(new Error("WebSocket connection failed"));
  });
}

async function waitFor(runtime, expression, timeout = 10000) {
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < timeout) {
    try {
      const result = await runtime(expression);
      if (result.exceptionDetails) {
        lastError = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime exception";
      } else if (result.result?.value) {
        return;
      }
    } catch (error) {
      lastError = String(error && (error.stack || error.message || error));
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${expression}${lastError ? `; last error: ${lastError}` : ""}`);
}

function runtimeValue(result, label) {
  if (result.exceptionDetails) {
    throw new Error(`${label}: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
  }
  return result.result.value;
}

async function run() {
  const version = await waitForDevTools();
  const cdp = await connect(version.webSocketDebuggerUrl);

  try {
    const target = await cdp.send("Target.createTarget", { url: "about:blank" });
    const attached = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    const send = (method, params = {}) => cdp.send(method, params, sessionId);
    const runtime = (expression, awaitPromise = false) => send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });

    await send("Runtime.enable");
    await send("Log.enable");
    await send("Page.enable");
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        if (location.origin === ${JSON.stringify(ORIGIN)}) {
          window.confirm = () => true;
        }
      `,
    });

    await send("Page.navigate", { url: APP_URL });
    await waitFor(runtime, "Boolean(window.NutrioStorage) && document.querySelector('.today-screen')", 15000);
    await delay(700);
    const desktop = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(desktopShot, Buffer.from(desktop.data, "base64"));

    const desktopResult = await runtime(`(async () => {
      const waitFor = async (predicate, label, timeout = 10000) => {
        const started = Date.now();
        let lastError = '';
        while (Date.now() - started < timeout) {
          try {
            if (await predicate()) return true;
          } catch (error) {
            lastError = String(error && (error.stack || error.message || error));
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Timed out: ' + label + (lastError ? '; last error: ' + lastError : ''));
      };
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const buttons = (root = document) => Array.from(root.querySelectorAll('button'));
      const click = async (element, label) => {
        if (!element) throw new Error('Missing element: ' + label);
        element.click();
        await delay(250);
      };
      const dispatchInput = (element) => element.dispatchEvent(new Event('input', { bubbles: true }));
      const firstModuleCard = () => Array.from(document.querySelectorAll('.module-card'))
        .find((card) => card.querySelector('.mod-id')?.textContent.trim() === 'M01');

      try {
        const initial = {
          title: document.getElementById('title')?.textContent,
          bodyModeHome: document.body.classList.contains('mode-home'),
          todayScreen: Boolean(document.querySelector('.today-screen')),
          nextStepExists: Boolean(document.querySelector('.next-step-card')),
          primaryActionText: document.querySelector('.today-primary-action')?.textContent.trim() || '',
          atlasLinkExists: Boolean(document.querySelector('.atlas-link')),
          homeModuleCards: document.querySelectorAll('.module-card').length,
          courseMapSegments: document.querySelectorAll('.course-map-segment').length,
          progressButtonText: document.getElementById('profile-btn')?.textContent.trim() || '',
          oldProfileKeyAfterStartup: localStorage.getItem('nutrio-profile'),
          oldProgressKeyAfterStartup: localStorage.getItem('nutrio-progress'),
        };

        await click(document.querySelector('.atlas-link'), 'Atlas link');
        await waitFor(() => document.body.classList.contains('mode-atlas') && document.querySelectorAll('.module-card').length === 24, 'Atlas modules');
        const atlas = {
          title: document.getElementById('title')?.textContent,
          phaseHeaders: document.querySelectorAll('.phase-header').length,
          moduleCards: document.querySelectorAll('.module-card').length,
          courseMapSegments: document.querySelectorAll('.course-map-segment').length,
          nextModuleCards: document.querySelectorAll('.module-card-next').length,
        };

        await click(firstModuleCard(), 'M01 card');
        await waitFor(() => document.body.classList.contains('mode-module') && document.querySelector('.material-subnav'), 'M01 station');
        const station = {
          title: document.getElementById('title')?.textContent,
          tabCount: document.querySelectorAll('#tabs button[data-file]').length,
          tabFiles: Array.from(document.querySelectorAll('#tabs button[data-file]')).map((button) => button.dataset.file),
          activeTab: document.querySelector('#tabs button.active')?.dataset.file,
          materialSubtabs: Array.from(document.querySelectorAll('.material-subtab[data-file]')).map((button) => button.dataset.file),
          theoryStudyCardHasTakeaway: Boolean(document.querySelector('.takeaway-input')),
          sectionCards: document.querySelectorAll('.lesson-section-card').length,
          sidePanelExists: Boolean(document.querySelector('.module-side-panel')),
          readingProgressExists: Boolean(document.querySelector('.reading-progress')),
          nextText: document.querySelector('.lesson-nav-next')?.textContent || '',
        };

        await click(document.querySelector('#tabs button[data-file="summary.md"]'), 'Anchor tab');
        await waitFor(() => document.querySelector('.takeaway-input'), 'Anchor input');
        await waitFor(async () => Boolean((await window.NutrioStorage.getModuleProgress('M01')).takeaway), 'auto-saved takeaway');
        const progressAfterAutoSave = await window.NutrioStorage.getModuleProgress('M01');
        const autoTakeaway = progressAfterAutoSave.takeaway;
        const input = document.querySelector('.takeaway-input');
        const summaryCard = input.closest('.study-card');
        const summaryBeforeEdit = {
          hasSaveButton: buttons(summaryCard).some((button) => button.textContent.includes('Сохранить')),
          continueButtonText: buttons(summaryCard)[0]?.textContent.trim() || '',
          statusText: summaryCard.querySelector('.save-status')?.textContent || '',
          autoTakeaway,
        };

        input.value = '';
        dispatchInput(input);
        await delay(650);
        const progressAfterEmptyDraft = await window.NutrioStorage.getModuleProgress('M01');

        input.value = 'Production E2E takeaway';
        dispatchInput(input);
        await waitFor(async () => (await window.NutrioStorage.getModuleProgress('M01')).takeawayDraft === 'Production E2E takeaway', 'draft auto-saved');
        const progressAfterDraft = await window.NutrioStorage.getModuleProgress('M01');
        await click(buttons(summaryCard)[0], 'Continue from Anchor');
        await waitFor(async () => (await window.NutrioStorage.getModuleProgress('M01')).takeaway === 'Production E2E takeaway', 'takeaway committed');
        await waitFor(() => document.getElementById('title')?.textContent === 'M02', 'next station after Anchor');
        const progressAfterCommit = await window.NutrioStorage.getModuleProgress('M01');
        const nextStation = {
          title: document.getElementById('title')?.textContent,
          activeTab: document.querySelector('#tabs button.active')?.dataset.file,
        };

        await click(document.getElementById('back-btn'), 'Back to Atlas');
        await waitFor(() => document.body.classList.contains('mode-atlas') && document.querySelectorAll('.module-card').length === 24, 'Atlas after station');
        await click(document.getElementById('back-btn'), 'Back to Today');
        await waitFor(() => document.querySelector('.today-screen'), 'Today after station');
        await click(document.querySelector('.atlas-link'), 'Atlas after Journal');
        await waitFor(() => document.querySelectorAll('.module-card').length === 24, 'Atlas after Journal');
        await click(firstModuleCard(), 'M01 for quiz');
        await waitFor(() => document.querySelector('#tabs button[data-file="quiz.md"]'), 'M01 tabs for quiz');
        await click(document.querySelector('#tabs button[data-file="quiz.md"]'), 'Quiz tab');
        await waitFor(() => document.querySelector('.quiz-intro'), 'Quiz intro');
        const quizIntroRouteText = document.querySelector('.lesson-route')?.textContent || '';
        const quizIntroDuplicateStart = Boolean(document.querySelector('.lesson-nav .module-next-sticky'));
        await click(buttons(document.querySelector('.quiz-intro')).find((button) => button.textContent.includes('Начать')), 'Start quiz');
        await waitFor(() => document.querySelectorAll('.quiz-q .opt').length > 0, 'Quiz options');
        const wrongOption = document.querySelectorAll('.quiz-q .opt')[0];
        wrongOption.click();
        wrongOption.click();
        await waitFor(() => document.querySelectorAll('.quiz-diagnosis').length === 1, 'single quiz diagnosis');
        const quizDiagnosisDom = {
          diagnosisCount: document.querySelectorAll('.quiz-diagnosis').length,
        };
        await waitFor(async () => Object.keys((await window.NutrioStorage.getModuleProgress('M01')).weakSpots || {}).length === 1, 'weak spot saved');
        await window.NutrioStorage.saveModuleProgress('M01', {
          quizBest: 0,
          quizTotal: 7,
          quizOpenTotal: 3,
          quizVersion: 2,
        });
        const appStateAfterWrong = await window.NutrioStorage.getAppState();
        const today = new Date().toISOString().slice(0, 10);
        appStateAfterWrong.review.items = appStateAfterWrong.review.items.map((item) =>
          item.id === 'M01-q1' ? Object.assign({}, item, { due: today }) : item
        );
        await window.NutrioStorage.saveAppState(appStateAfterWrong);
        const progressAfterWrong = await window.NutrioStorage.getModuleProgress('M01');
        const reviewItem = (await window.NutrioStorage.getAppState()).review.items.find((item) => item.id === 'M01-q1');

        await click(document.getElementById('back-btn'), 'Back to Atlas with due memory');
        await waitFor(() => document.body.classList.contains('mode-atlas') && document.querySelectorAll('.module-card').length === 24, 'Atlas with due memory');
        await click(document.getElementById('back-btn'), 'Back to Today with due memory');
        await waitFor(() => document.querySelector('.today-screen') && document.querySelector('.today-weak-list'), 'Today due weak spot');
        const todayWithMemory = {
          primaryActionText: document.querySelector('.today-primary-action')?.textContent.trim() || '',
          weakListItems: document.querySelectorAll('.today-weak-list li').length,
          weakListText: document.querySelector('.today-weak-list')?.textContent || '',
        };
        await click(document.querySelector('.today-primary-action'), 'Start memory session');
        await waitFor(() => document.querySelector('.memory-learning-note') && document.querySelector('.quiz-q'), 'Memory session question');
        const memorySession = {
          noteExists: Boolean(document.querySelector('.memory-learning-note')),
          noteDiagnosticType: document.querySelector('.memory-learning-note')?.dataset.diagnosticType || '',
          questionExists: Boolean(document.querySelector('.quiz-q')),
        };

        return {
          ok: true,
          initial,
          atlas,
          station,
          journal: {
            summaryBeforeEdit,
            autoSaved: Boolean(autoTakeaway),
            emptyDraftPreserved: progressAfterEmptyDraft.takeaway === autoTakeaway,
            draftSaved: progressAfterDraft.takeawayDraft === 'Production E2E takeaway',
            draftDidNotCommitEarly: progressAfterDraft.takeaway === autoTakeaway,
            committedTakeaway: progressAfterCommit.takeaway,
            committedDraftCleared: !progressAfterCommit.takeawayDraft,
            nextStation,
          },
          quizDiagnosis: {
            introRouteText: quizIntroRouteText,
            introDuplicateStart: quizIntroDuplicateStart,
            diagnosisCount: quizDiagnosisDom.diagnosisCount,
            weakSpotCount: Object.keys(progressAfterWrong.weakSpots || {}).length,
            reviewItemCopies: (await window.NutrioStorage.getAppState()).review.items.filter((item) => item.id === 'M01-q1').length,
            reviewItemCourseId: reviewItem?.courseId || '',
            diagnosticType: reviewItem?.diagnosticType || '',
            userLabel: reviewItem?.userLabel || '',
            shortExplanation: reviewItem?.shortExplanation || '',
            reviewStrategy: reviewItem?.reviewStrategy || '',
          },
          todayWithMemory,
          memorySession,
        };
      } catch (error) {
        return {
          ok: false,
          error: String(error && (error.stack || error.message || error)),
          title: document.getElementById('title')?.textContent,
          body: document.body.innerText.slice(0, 800),
        };
      }
    })()`, true);

    const desktopSummary = runtimeValue(desktopResult, "Desktop E2E");
    assert(desktopSummary?.ok === true, `Desktop E2E failed: ${JSON.stringify(desktopSummary, null, 2)}`);

    const memoryImage = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(memoryShot, Buffer.from(memoryImage.data, "base64"));

    assert(desktopSummary.initial.title === "Сегодня", "Home should open in Today mode");
    assert(desktopSummary.initial.bodyModeHome === true, "Home body should carry mode-home");
    assert(desktopSummary.initial.todayScreen === true, "Today screen should render");
    assert(desktopSummary.initial.nextStepExists === true, "Today should lead with one next action");
    assert(desktopSummary.initial.primaryActionText.length > 0, "Today primary CTA should be visible");
    assert(desktopSummary.initial.atlasLinkExists === true, "Atlas should be available as a secondary route");
    assert(desktopSummary.initial.homeModuleCards === 0, "Today must not render equal module cards");
    assert(desktopSummary.initial.courseMapSegments === 0, "Today should not embed the full course map");
    assert(desktopSummary.initial.oldProfileKeyAfterStartup === null, "Production E2E should start without a legacy profile key");
    assert(desktopSummary.initial.oldProgressKeyAfterStartup === null, "Production E2E should start without a legacy progress key");

    assert(desktopSummary.atlas.title === "Карта курса", "Atlas should own the course map title");
    assert(desktopSummary.atlas.phaseHeaders === 6, "Atlas should render 6 course phases");
    assert(desktopSummary.atlas.moduleCards === 24, "Atlas should render 24 station cards");
    assert(desktopSummary.atlas.courseMapSegments === 24, "Atlas should keep the 24-station map");

    assert(desktopSummary.station.title === "M01", "M01 station should open from Atlas");
    assert(desktopSummary.station.tabCount === 4, "Station route should render 4 primary steps");
    assert(JSON.stringify(desktopSummary.station.tabFiles) === JSON.stringify(["theory.md", "practice.md", "quiz.md", "summary.md"]), "Station route should be Understand, Apply, Check, Anchor");
    assert(desktopSummary.station.materialSubtabs.join("|") === "theory.md|terms.md", "Understand should expose theory and terms as local blocks");
    assert(desktopSummary.station.theoryStudyCardHasTakeaway === false, "Takeaway input should only live on Anchor");
    assert(desktopSummary.station.sectionCards >= 6, "Theory should render section cards");
    assert(desktopSummary.station.sidePanelExists === true, "Desktop station should expose the side panel");
    assert(desktopSummary.station.readingProgressExists === true, "Desktop station should expose reading progress");

    assert(desktopSummary.journal.summaryBeforeEdit.hasSaveButton === false, "Anchor must not require a manual Save button");
    assert(desktopSummary.journal.autoSaved === true, "Anchor should auto-save a station takeaway");
    assert(desktopSummary.journal.emptyDraftPreserved === true, "Empty draft should not erase the saved takeaway");
    assert(desktopSummary.journal.draftSaved === true, "Edited text should be saved as draft first");
    assert(desktopSummary.journal.draftDidNotCommitEarly === true, "Draft should not replace Journal before Continue");
    assert(desktopSummary.journal.committedTakeaway === "Production E2E takeaway", "Continue should commit the edited takeaway");
    assert(desktopSummary.journal.committedDraftCleared === true, "Committed edit should clear the draft field");
    assert(desktopSummary.journal.nextStation.title === "M02", "Continue from Anchor should move to the next station");

    assert(desktopSummary.quizDiagnosis.diagnosisCount === 1, "Double-clicked wrong answer should render one diagnosis");
    assert(desktopSummary.quizDiagnosis.introRouteText.includes("шаг 3 из 4"), "Quiz intro should count station steps, not markdown files");
    assert(desktopSummary.quizDiagnosis.introDuplicateStart === false, "Quiz intro should not duplicate the primary start CTA");
    assert(desktopSummary.quizDiagnosis.weakSpotCount === 1, "Wrong quiz answer should create one weak spot");
    assert(desktopSummary.quizDiagnosis.reviewItemCopies === 1, "Wrong quiz answer should create one review item");
    assert(desktopSummary.quizDiagnosis.reviewItemCourseId === "nutrition", "Review item should carry the nutrition course id");
    assert(desktopSummary.quizDiagnosis.diagnosticType, "Review item should carry an internal diagnostic type");
    assert(desktopSummary.quizDiagnosis.userLabel, "Review item should carry a human label");
    assert(desktopSummary.quizDiagnosis.shortExplanation, "Review item should carry a short explanation");
    assert(desktopSummary.quizDiagnosis.reviewStrategy, "Review item should carry a review strategy");
    assert(desktopSummary.todayWithMemory.weakListItems === 1, "Today should surface the due weak spot");
    assert(desktopSummary.memorySession.noteExists === true, "Memory session should show the weak-spot learning card");
    assert(desktopSummary.memorySession.noteDiagnosticType, "Memory card should expose the diagnostic type");
    assert(desktopSummary.memorySession.questionExists === true, "Memory session should render the review question");

    const mobileTarget = await cdp.send("Target.createTarget", { url: "about:blank" });
    const mobileAttached = await cdp.send("Target.attachToTarget", { targetId: mobileTarget.targetId, flatten: true });
    const mobileSessionId = mobileAttached.sessionId;
    const mobileSend = (method, params = {}) => cdp.send(method, params, mobileSessionId);
    const mobileRuntime = (expression, awaitPromise = false) => mobileSend("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });

    await mobileSend("Runtime.enable");
    await mobileSend("Log.enable");
    await mobileSend("Page.enable");
    await mobileSend("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await mobileSend("Page.navigate", { url: `${APP_URL}?mobile-e2e=${Date.now()}` });
    await waitFor(mobileRuntime, "Boolean(window.NutrioStorage) && document.querySelector('.today-screen')", 15000);
    await delay(700);
    const mobileHome = await mobileSend("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(mobileShot, Buffer.from(mobileHome.data, "base64"));

    const mobileResult = await mobileRuntime(`(async () => {
      const waitFor = async (predicate, label, timeout = 10000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          if (await predicate()) return true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('Timed out: ' + label);
      };
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const click = async (element, label) => {
        if (!element) throw new Error('Missing element: ' + label);
        element.click();
        await delay(250);
      };
      const homePrimary = document.querySelector('.today-primary-action');
      const home = {
        title: document.getElementById('title')?.textContent,
        todayScreen: Boolean(document.querySelector('.today-screen')),
        moduleCards: document.querySelectorAll('.module-card').length,
        courseMapSegments: document.querySelectorAll('.course-map-segment').length,
        primaryBottom: homePrimary?.getBoundingClientRect().bottom || 9999,
        hasHorizontalOverflow: document.body.scrollWidth > window.innerWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1,
      };
      await click(document.querySelector('.atlas-link'), 'Atlas link');
      await waitFor(() => document.querySelectorAll('.module-card').length === 24, 'Atlas modules');
      document.querySelector('.module-card')?.click();
      await waitFor(() => document.querySelectorAll('#tabs button[data-file]:not([data-file="__review__"])').length === 4 && document.querySelector('.material-subnav'), 'Mobile station route');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const tabs = document.getElementById('tabs');
      const sidePanel = document.querySelector('.module-side-panel');
      const station = {
        tabCount: document.querySelectorAll('#tabs button[data-file]:not([data-file="__review__"])').length,
        reviewTabExists: Boolean(document.querySelector('#tabs button[data-file="__review__"]')),
        materialSubtabCount: document.querySelectorAll('.material-subtab[data-file]').length,
        tabButtonsHidden: getComputedStyle(document.querySelector('#tabs button[data-file]')).display === 'none',
        tabsScrollable: tabs.scrollWidth > tabs.clientWidth + 1,
        tabsFixed: getComputedStyle(tabs).position === 'sticky',
        sidePanelVisible: Boolean(sidePanel) && getComputedStyle(sidePanel).display !== 'none',
        readingProgressVisible: Boolean(document.querySelector('.reading-progress')),
        mobilePrimaryExists: Boolean(document.querySelector('.module-next-sticky')),
        hasHorizontalOverflow: document.body.scrollWidth > window.innerWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1,
      };
      return { home, station };
    })()`, true);

    const mobileSummary = runtimeValue(mobileResult, "Mobile E2E");
    const mobileStationImage = await mobileSend("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(mobileModuleShot, Buffer.from(mobileStationImage.data, "base64"));

    assert(mobileSummary.home.title === "Сегодня", "Mobile should open in Today mode");
    assert(mobileSummary.home.todayScreen === true, "Mobile Today screen should render");
    assert(mobileSummary.home.moduleCards === 0, "Mobile Today must not render equal module cards");
    assert(mobileSummary.home.courseMapSegments === 0, "Mobile Today should not embed the full course map");
    assert(mobileSummary.home.primaryBottom < 650, `Mobile primary CTA should be visible early, got ${mobileSummary.home.primaryBottom}`);
    assert(mobileSummary.home.hasHorizontalOverflow === false, "Mobile Today should not overflow horizontally");
    assert(mobileSummary.station.tabCount === 4, "Mobile station should render the 4-step route");
    assert(mobileSummary.station.materialSubtabCount === 2, "Mobile Understand step should expose two local blocks");
    assert(mobileSummary.station.tabButtonsHidden === false, "Mobile route buttons should remain visible");
    assert(mobileSummary.station.tabsScrollable === false, "Mobile route should not rely on horizontal scrolling");
    assert(mobileSummary.station.tabsFixed === true, "Mobile route should stay visible below the header");
    assert(mobileSummary.station.sidePanelVisible === false, "Mobile station should hide the desktop side panel");
    assert(mobileSummary.station.readingProgressVisible === true, "Mobile station should show reading progress");
    assert(mobileSummary.station.mobilePrimaryExists === true, "Mobile station should expose a next CTA");
    assert(mobileSummary.station.hasHorizontalOverflow === false, "Mobile station should not overflow horizontally");

    const unexpectedEvents = cdp.events.filter((event) => {
      if (event.method === "Log.entryAdded") {
        const entry = event.params?.entry;
        return entry && ["error", "warning"].includes(entry.level);
      }
      if (event.method === "Runtime.consoleAPICalled") {
        return ["error", "warning"].includes(event.params?.type);
      }
      return false;
    }).map((event) => event.params);

    assert(unexpectedEvents.length === 0, `Unexpected browser warnings/errors: ${JSON.stringify(unexpectedEvents, null, 2)}`);

    console.log(JSON.stringify({
      url: APP_URL,
      desktopSummary,
      mobileSummary,
      screenshots: { desktopShot, memoryShot, mobileShot, mobileModuleShot },
      unexpectedEvents,
    }, null, 2));
  } finally {
    cdp.close();
  }
}

run()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    chrome.kill();
  });

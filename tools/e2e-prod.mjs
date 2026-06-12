import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const APP_URL = process.env.NUTRIO_E2E_URL || "http://127.0.0.1:8766/";
const ORIGIN = new URL(APP_URL).origin;
const DEBUG_PORT = Number(process.env.NUTRIO_E2E_DEBUG_PORT || 9240);
const SW_READY_TIMEOUT_MS = Number(process.env.NUTRIO_E2E_SW_READY_TIMEOUT_MS || 120000);

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

const CHROME_PATHS = browserCandidates();

const chromePath = CHROME_PATHS.find((candidate) => fs.existsSync(candidate));
if (!chromePath) throw new Error("Chrome or Edge executable was not found. Set CHROME_PATH to run production E2E.");

const userDataDir = path.join(os.tmpdir(), `nutrio-prod-e2e-${Date.now()}`);
const screenshotDir = path.join(os.tmpdir(), "nutrio-prod-e2e-shots");
fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(screenshotDir, { recursive: true });

const desktopShot = path.join(screenshotDir, "prod-home-desktop.png");
const mobileShot = path.join(screenshotDir, "prod-home-mobile.png");
const mobileModuleShot = path.join(screenshotDir, "prod-module-mobile.png");

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

async function run() {
  const version = await waitForDevTools();
  const cdp = await connect(version.webSocketDebuggerUrl);
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
        localStorage.setItem('nutrio-profile', JSON.stringify({
          name: 'E2E Migrated',
          goal: 'Production migration',
          level: 'review',
          startedAt: '2026-06-01',
          updatedAt: '2026-06-09T10:00:00.000Z'
        }));
        localStorage.setItem('nutrio-progress', JSON.stringify({
          M02: {
            theoryRead: true,
            takeaway: 'Legacy production takeaway',
            takeawayUpdatedAt: '2026-06-09T10:00:00.000Z'
          }
        }));
      }
    `,
  });

  await send("Page.navigate", { url: APP_URL });
  await waitFor(runtime, "document.querySelectorAll('.module-card').length === 24", 15000);
  await delay(1400);
  const desktop = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(desktopShot, Buffer.from(desktop.data, "base64"));

  const desktopResult = await runtime(`(async () => { try {
    const waitFor = async (predicate, label, timeout = 10000) => {
      const start = Date.now();
      let lastError = '';
      while (Date.now() - start < timeout) {
        try {
          if (await predicate()) return true;
        } catch (error) {
          lastError = String(error && (error.stack || error.message || error));
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Timed out: ' + label + (lastError ? '; last error: ' + lastError : ''));
    };
    const click = async (element, label) => {
      if (!element) throw new Error('Missing element: ' + label);
      element.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
    };
    const buttons = (root) => Array.from(root.querySelectorAll('button'));
    const readProgress = () => window.NutrioStorage.getAllProgress();

    const initial = {
      title: document.getElementById('title')?.textContent,
      progressButtonText: document.getElementById('profile-btn')?.textContent.trim(),
      moduleCards: document.querySelectorAll('.module-card').length,
      phaseHeaders: document.querySelectorAll('.phase-header').length,
      brandMarks: document.querySelectorAll('.brand-mark-svg').length,
      nextStepExists: Boolean(document.querySelector('.next-step-card')),
      nextStepActionText: document.querySelector('.next-step-card .home-actions button')?.textContent.trim(),
      heroVisualExists: Boolean(document.querySelector('.hero-visual')),
      courseMapSegments: document.querySelectorAll('.course-map-segment').length,
      homeInstrumentStatusbar: Boolean(document.querySelector('.instrument-statusbar')),
      homeOrganismChars: document.querySelector('#organism')?.textContent.length || 0,
      homeConsoleExists: Boolean(document.querySelector('[data-console-lines]')),
      homeBrandText: document.querySelector('.instrument-brand')?.textContent || '',
      homeMapLegend: document.querySelector('.matrix-foot .map-legend')?.textContent || '',
      homeConceptTrailNodes: document.querySelectorAll('.home-concept-trail .concept-node').length,
      homeMetricCards: document.querySelectorAll('.intro-card .metric').length,
      moduleVisuals: document.querySelectorAll('.module-visual').length,
      storageLoaded: Boolean(window.NutrioStorage),
      oldProfileKeyAfterStartup: localStorage.getItem('nutrio-profile'),
      oldProgressKeyAfterStartup: localStorage.getItem('nutrio-progress'),
      migratedProfile: await window.NutrioStorage.getProfile(),
      migratedProgress: await readProgress(),
    };

    await click(document.querySelector('.course-map-segment[data-module-id="M03"]'), 'course map segment M03');
    await waitFor(() => document.getElementById('title')?.textContent === 'M03', 'map segment opens module');
    const mapNavTitle = document.getElementById('title')?.textContent;
    await click(document.getElementById('back-btn'), 'back home after map navigation');
    await waitFor(() => document.querySelectorAll('.module-card').length === 24, 'home after map navigation');

    await click(document.getElementById('profile-btn'), 'profile button');
    await waitFor(() => document.querySelector('.profile-card button.btn'), 'profile screen');
    const progressScreenTitle = document.getElementById('title')?.textContent;
    const profileSections = Array.from(document.querySelectorAll('#screen > section'))
      .map((section) => section.querySelector('h2')?.textContent?.trim())
      .filter(Boolean);
    const hasProgressContinue = Boolean(document.querySelector('.dashboard-primary button.btn'));
    const profileCard = document.querySelector('.profile-card');
    const profileInputs = Array.from(profileCard.querySelectorAll('.profile-input'));
    const migratedNameVisible = profileInputs[0]?.value;
    profileInputs[0].value = 'E2E Saved';
    profileInputs[1].value = 'Production profile save';
    profileInputs[2].value = 'familiar';
    profileInputs[3].value = '2026-06-10';
    await click(buttons(profileCard).find((button) => button.className.includes('btn') && !button.className.includes('danger')), 'save profile');
    await waitFor(async () => (await window.NutrioStorage.getProfile())?.name === 'E2E Saved', 'profile saved');
    const savedProfile = await window.NutrioStorage.getProfile();

    const quietToggle = document.querySelector('.quiet-checkbox');
    const saveProfileButton = buttons(profileCard).find((button) => button.className.includes('btn') && !button.className.includes('danger'));
    await click(quietToggle, 'enable quiet mode');
    await click(saveProfileButton, 'save quiet mode on');
    await waitFor(() => document.body.classList.contains('quiet'), 'quiet mode applied to body');
    const quietModeApplied = document.body.classList.contains('quiet');
    await click(quietToggle, 'disable quiet mode');
    await click(saveProfileButton, 'save quiet mode off');
    await waitFor(() => !document.body.classList.contains('quiet'), 'quiet mode removed from body');

    await click(document.getElementById('back-btn'), 'back to home');
    await waitFor(() => document.querySelectorAll('.module-card').length === 24, 'home after profile');
    const m01 = Array.from(document.querySelectorAll('.module-card')).find((card) => card.querySelector('.mod-id')?.textContent.trim() === 'M01');
    await click(m01, 'M01 card');
    await waitFor(() => document.querySelector('.study-card') && document.querySelectorAll('#tabs button').length >= 3 && document.querySelector('.material-subnav'), 'M01 theory');
    await waitFor(() => document.querySelectorAll('.lesson-section-card').length >= 6 && document.querySelector('.reading-progress'), 'sectioned theory');
    const routeBeforeQuiz = {
      sectionCards: document.querySelectorAll('.lesson-section-card').length,
      sectionMemoryCount: document.querySelectorAll('.section-memory').length,
      readerConceptTrailCount: document.querySelectorAll('.reader-concept-trail').length,
      keyIdeaCount: document.querySelectorAll('.key-idea-block').length,
      typicalMistakeCount: document.querySelectorAll('.typical-mistake-block').length,
      sourceCardCount: document.querySelectorAll('.source-card').length,
      sourceDeckCollapsed: Boolean(document.querySelector('details.source-deck')) && !document.querySelector('details.source-deck[open]'),
      sourceDeckSummaryText: document.querySelector('.source-deck-summary')?.textContent || '',
      firstSectionLabel: document.querySelector('.section-meta')?.textContent || '',
      sidePanelExists: Boolean(document.querySelector('.module-side-panel')),
      sideTocCount: document.querySelectorAll('.module-side-panel .lesson-toc button').length,
      sectionMetaIconCount: document.querySelectorAll('.section-meta-icon').length,
      readingProgressText: document.querySelector('.reading-progress-label')?.textContent,
      nextText: document.querySelector('.lesson-nav-next')?.textContent,
      stickyText: document.querySelector('.module-next-sticky')?.textContent,
    };
    await click(document.querySelector('.lesson-nav-next'), 'lesson nav to terms');
    await waitFor(() => document.querySelector('#tabs button[data-file="theory.md"].active') && document.querySelector('.material-subtab[data-file="terms.md"].active') && document.querySelector('.lesson-nav-prev'), 'terms via lesson nav');
    const termsRoute = {
      prevText: document.querySelector('.lesson-nav-prev')?.textContent,
      activeTab: document.querySelector('#tabs button.active')?.dataset.file,
      activeMaterialBlock: document.querySelector('.material-subtab.active')?.dataset.file,
    };
    await click(document.querySelector('.lesson-nav-prev'), 'lesson nav back to theory');
    await waitFor(() => document.querySelector('#tabs button[data-file="theory.md"].active') && document.querySelector('.study-card'), 'theory via lesson nav');

    const studyCard = document.querySelector('.study-card');
    const markRead = buttons(studyCard).find((button) => button.className.includes('btn') && !button.className.includes('secondary'));
    if (markRead) await click(markRead, 'mark theory read');
    await waitFor(async () => (await window.NutrioStorage.getModuleProgress('M01')).theoryRead === true, 'theory read saved');
    if (document.querySelector('.takeaway-input')) throw new Error('Takeaway input should not render on the theory screen');

    await click(document.querySelector('#tabs button[data-file="summary.md"]'), 'summary tab');
    await waitFor(() => document.querySelector('.takeaway-input'), 'takeaway input on summary step');
    document.querySelector('.takeaway-input').value = 'Production E2E takeaway';
    await click(document.querySelector('.study-card button.secondary'), 'save takeaway');
    await waitFor(async () => (await window.NutrioStorage.getModuleProgress('M01')).takeaway === 'Production E2E takeaway', 'takeaway saved');

    await click(document.querySelector('#tabs button[data-file="quiz.md"]'), 'quiz tab');
    await waitFor(() => document.querySelector('.quiz-intro'), 'quiz intro');
    const quizIntroText = document.querySelector('.quiz-intro')?.innerText || '';
    const quizIntroHtml = document.querySelector('.quiz-intro')?.innerHTML || '';
    if (!quizIntroText.includes('10') || !quizIntroHtml.includes('автоматический балл') || !quizIntroHtml.includes('самопроверки') || !quizIntroText.includes('70%') || !quizIntroText.includes('5-8 мин')) {
      throw new Error('Quiz intro copy does not explain scored and self-check questions');
    }
    await click(buttons(document.querySelector('.quiz-intro')).find((button) => button.textContent.trim() === 'Начать проверку'), 'start quiz');
    await waitFor(() => document.querySelectorAll('.quiz-q .opt').length > 0, 'quiz options');
    const quizMd = await (await fetch('content/M01/quiz.md')).text();
    const firstQuestion = parseQuiz(quizMd)[0];
    const wrongIndex = firstQuestion.options.findIndex((option) => option.key !== firstQuestion.answer);
    const wrongOption = document.querySelectorAll('.quiz-q .opt')[wrongIndex >= 0 ? wrongIndex : 0];
    if (!wrongOption) throw new Error('Missing element: wrong quiz option');
    wrongOption.click();
    wrongOption.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await waitFor(() => document.querySelectorAll('.quiz-diagnosis').length === 1, 'one quiz diagnosis rendered after double click');
    await waitFor(async () => Object.keys((await window.NutrioStorage.getModuleProgress('M01')).weakSpots || {}).length === 1, 'weak spot saved');
    await waitFor(async () => (await window.NutrioStorage.getModuleProgress('M01')).quizAnswered === 1, 'double-clicked quiz answer counted once');
    await waitFor(async () => (await window.NutrioStorage.getAppState()).review.items.filter((item) => item.id === 'M01-q1').length === 1, 'double-clicked quiz answer created one review item');
    const weakSpotsAfterWrong = (await window.NutrioStorage.getModuleProgress('M01')).weakSpots || {};
    const appStateAfterWrong = await window.NutrioStorage.getAppState();
    const firstReviewItem = appStateAfterWrong.review.items.find((item) => item.id === 'M01-q1') || {};
    const firstWeakSpot = Object.values(weakSpotsAfterWrong)[0] || {};
    const m01AfterWrong = await window.NutrioStorage.getModuleProgress('M01');
    const quizDiagnosis = {
      exists: Boolean(document.querySelector('.quiz-diagnosis')),
      diagnosisCount: document.querySelectorAll('.quiz-diagnosis').length,
      nextButtonCount: document.querySelectorAll('.quiz-q .quiz-next').length,
      gridItems: document.querySelectorAll('.quiz-diagnosis-grid > div').length,
      trailNodes: document.querySelectorAll('.quiz-diagnosis .concept-node').length,
      weakSpotMistakeType: firstWeakSpot.mistakeType || '',
      weakSpotLevel: firstWeakSpot.level || '',
      reviewItemCourseId: firstReviewItem.courseId || '',
      reviewItemInterval: firstReviewItem.interval || 0,
      reviewItemLastResult: firstReviewItem.lastResult || '',
      quizAnswered: m01AfterWrong.quizAnswered || 0,
      reviewItemCopies: appStateAfterWrong.review.items.filter((item) => item.id === 'M01-q1').length,
    };
    const progressAfterQuiz = await readProgress();

    const today = window.NutrioReview.toISODate(new Date());
    const dueState = await window.NutrioStorage.getAppState();
    dueState.review.items = dueState.review.items.map((item) => item.id === 'M01-q1' ? Object.assign({}, item, { due: today }) : item);
    await window.NutrioStorage.saveAppState(dueState);
    await click(document.getElementById('back-btn'), 'home before review session');
    await waitFor(() => document.querySelectorAll('.module-card').length === 24 && document.querySelector('.next-step-card .home-actions button')?.textContent.includes('сеанс'), 'home with due session');
    await click(document.querySelector('.next-step-card .home-actions button'), 'start review session');
    await waitFor(() => document.querySelector('.review-session') && document.querySelectorAll('.session-question .opt').length > 0, 'review session question');
    const reviewOptions = Array.from(document.querySelectorAll('.session-question .opt'));
    const correctReviewIndex = firstQuestion.options.findIndex((option) => option.key === firstQuestion.answer);
    const correctReviewOption = reviewOptions[correctReviewIndex];
    if (!correctReviewOption) throw new Error('Missing element: correct review answer');
    correctReviewOption.click();
    correctReviewOption.click();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await waitFor(() => document.querySelectorAll('.session-return-line').length === 1, 'one review return line after double click');
    const stateAfterReviewSession = await window.NutrioStorage.getAppState();
    const sessionReviewItem = stateAfterReviewSession.review.items.find((item) => item.id === 'M01-q1') || {};
    const sessionReview = {
      returnText: document.querySelector('.session-return-line')?.textContent || '',
      returnLineCount: document.querySelectorAll('.session-return-line').length,
      nextButtonCount: document.querySelectorAll('.session-question .quiz-next').length,
      interval: sessionReviewItem.interval || 0,
      lastResult: sessionReviewItem.lastResult || '',
      streakDays: stateAfterReviewSession.sessions.streakDays || 0,
      todayReviews: stateAfterReviewSession.sessions.todayDone?.reviews || 0,
    };

    await click(document.getElementById('profile-btn'), 'profile after quiz');
    await waitFor(() => document.querySelector('.profile-card'), 'profile after quiz screen');
    const dataCard = Array.from(document.querySelectorAll('.dashboard-card')).at(-1);
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    let exportedText = null;
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => { exportedText = text; });
      return originalCreateObjectURL(blob);
    };
    URL.revokeObjectURL = () => {};
    await click(buttons(dataCard).find((button) => !button.className.includes('danger')), 'export data');
    await waitFor(() => exportedText !== null, 'export blob captured');
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    const exported = JSON.parse(exportedText);

    await click(buttons(document.querySelector('.profile-card')).find((button) => button.className.includes('danger')), 'reset profile');
    await waitFor(async () => (await window.NutrioStorage.getProfile()) === null, 'profile reset');
    const progressAfterProfileReset = await readProgress();
    const dataCardAfterProfileReset = Array.from(document.querySelectorAll('.dashboard-card')).at(-1);
    await click(buttons(dataCardAfterProfileReset).find((button) => button.className.includes('danger')), 'reset progress');
    await waitFor(async () => Object.keys(await window.NutrioStorage.getAllProgress()).length === 0, 'progress reset');
    const appStateAfterProgressReset = await window.NutrioStorage.getAppState();
    const profileAfterProgressReset = await window.NutrioStorage.getProfile();

    await click(document.getElementById('back-btn'), 'back to home after resets');
    await waitFor(() => document.querySelectorAll('.module-card').length === 24, 'home after resets');
    const m01AfterReset = Array.from(document.querySelectorAll('.module-card')).find((card) => card.querySelector('.mod-id')?.textContent.trim() === 'M01');
    await click(m01AfterReset, 'M01 card after reset');
    await waitFor(() => document.querySelector('#tabs button[data-file="summary.md"]'), 'summary tab after reset');
    await click(document.querySelector('#tabs button[data-file="summary.md"]'), 'summary tab');
    await waitFor(() => document.querySelector('#tabs button[data-file="summary.md"].active') && document.querySelector('.lesson-nav-next'), 'summary route');
    await click(document.querySelector('.lesson-nav-next'), 'next module from summary');
    await waitFor(() => document.getElementById('title')?.textContent.startsWith('M02')
      && document.querySelector('#tabs button.active')?.dataset.file, 'next module from summary opened');
    const nextModuleRoute = {
      title: document.getElementById('title')?.textContent,
      activeTab: document.querySelector('#tabs button.active')?.dataset.file,
    };

    let sw = { supported: 'serviceWorker' in navigator };
    if ('serviceWorker' in navigator) {
      try {
        const registration = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((_, reject) => setTimeout(() => reject(new Error('SW ready timeout')), ${SW_READY_TIMEOUT_MS})),
        ]);
        // Прекеш может дозаполняться после ready — ждём с ретраями, не ослабляя проверку.
        let shellKeys = [];
        let content = null;
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const allKeys = await caches.keys();
          const shellKey = allKeys.find((k) => /^nutrio-v\\d+-shell$/.test(k));
          const contentKey = allKeys.find((k) => /^nutrio-v\\d+-content$/.test(k));
          const shell = shellKey ? await caches.open(shellKey).catch(() => null) : null;
          content = contentKey ? await caches.open(contentKey).catch(() => null) : null;
          shellKeys = shell ? (await shell.keys()).map((req) => new URL(req.url).pathname) : [];
          if (shellKeys.includes('/core/storage.js') && shellKeys.includes('/fonts/IBMPlexMono-Regular.woff2')) break;
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
        sw = {
          supported: true,
          activeScript: registration.active?.scriptURL || null,
          cacheKeys: await caches.keys(),
          shellHasStorage: shellKeys.includes('/core/storage.js'),
          shellHasReview: shellKeys.includes('/core/review.js'),
          shellHasApp: shellKeys.includes('/app.js'),
          shellHasFont: shellKeys.includes('/fonts/IBMPlexMono-Regular.woff2'),
          contentEntryCount: content ? (await content.keys()).length : 0,
        };
      } catch (error) {
        sw = { supported: true, error: error.message, cacheKeys: await caches.keys() };
      }
    }

    return {
      ok: true,
      initial: {
      title: initial.title,
      progressButtonText: initial.progressButtonText,
        moduleCards: initial.moduleCards,
        phaseHeaders: initial.phaseHeaders,
        brandMarks: initial.brandMarks,
        nextStepExists: initial.nextStepExists,
        nextStepActionText: initial.nextStepActionText,
        heroVisualExists: initial.heroVisualExists,
        courseMapSegments: initial.courseMapSegments,
        homeInstrumentStatusbar: initial.homeInstrumentStatusbar,
        homeOrganismChars: initial.homeOrganismChars,
        homeConsoleExists: initial.homeConsoleExists,
        homeBrandText: initial.homeBrandText,
        homeMapLegend: initial.homeMapLegend,
        homeConceptTrailNodes: initial.homeConceptTrailNodes,
        homeMetricCards: initial.homeMetricCards,
        moduleVisuals: initial.moduleVisuals,
        storageLoaded: initial.storageLoaded,
        oldProfileKeyAfterStartup: initial.oldProfileKeyAfterStartup,
        oldProgressKeyAfterStartup: initial.oldProgressKeyAfterStartup,
        migratedProfileName: initial.migratedProfile?.name,
        migratedProgressM02Takeaway: initial.migratedProgress.M02?.takeaway,
        migratedNameVisible,
      },
      savedProfile: { name: savedProfile?.name, level: savedProfile?.level, startedAt: savedProfile?.startedAt },
      mapNavTitle,
      quietModeApplied,
      progressScreenTitle,
      profileSections,
      hasProgressContinue,
      quizIntro: { text: quizIntroText },
      quizDiagnosis,
      sessionReview,
      routeBeforeQuiz,
      termsRoute,
      nextModuleRoute,
      progressAfterQuiz: {
        m01TheoryRead: progressAfterQuiz.M01?.theoryRead === true,
        m01Takeaway: progressAfterQuiz.M01?.takeaway,
        weakSpotCount: Object.keys(progressAfterQuiz.M01?.weakSpots || {}).length,
        reviewItemCount: appStateAfterWrong.review.items.length,
        reviewItemCourseId: quizDiagnosis.reviewItemCourseId,
        reviewItemInterval: quizDiagnosis.reviewItemInterval,
        reviewItemLastResult: quizDiagnosis.reviewItemLastResult,
        migratedM02Preserved: progressAfterQuiz.M02?.takeaway,
      },
      export: {
        app: exported.app,
        schemaVersion: exported.schemaVersion,
        profileName: exported.profile?.name,
        m01Takeaway: exported.progress?.M01?.takeaway,
        weakSpotCount: Object.keys(exported.progress?.M01?.weakSpots || {}).length,
        reviewItemCount: exported.review?.items?.length || 0,
        sessionsCourseId: exported.sessions?.courseId,
      },
      resets: {
        progressPreservedAfterProfileReset: progressAfterProfileReset.M01?.takeaway,
        progressEmptyAfterProgressReset: Object.keys(await window.NutrioStorage.getAllProgress()).length === 0,
        reviewEmptyAfterProgressReset: appStateAfterProgressReset.review.items.length === 0,
        profileAfterProgressReset,
      },
      sw,
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error && (error.stack || error.message || error)),
      title: document.getElementById('title')?.textContent,
      body: document.body.innerText.slice(0, 600),
    };
  } })()`, true);

  const desktopSummary = desktopResult.result.value;
  assert(desktopSummary?.ok === true, `Desktop E2E failed: ${JSON.stringify(desktopSummary, null, 2)}`);
  assert(desktopSummary.initial.moduleCards === 24, "Production should render 24 modules");
  assert(desktopSummary.initial.progressButtonText === "Прогресс", "Topbar action should not imply an account cabinet");
  assert(desktopSummary.initial.phaseHeaders === 6, "Production should render 6 phases");
  assert(desktopSummary.initial.brandMarks >= 1, "Production should render the custom brand mark");
  assert(desktopSummary.initial.nextStepExists === true, "Home should lead with the next learning step");
  assert(desktopSummary.initial.nextStepActionText === "начать M01 ▸", "Home next step should name the next module");
  assert(desktopSummary.initial.heroVisualExists === false, "Home should not lead with a decorative hero visual");
  assert(desktopSummary.initial.courseMapSegments === 24, "Home should render a segmented 24-module course map");
  assert(desktopSummary.initial.homeInstrumentStatusbar === true, "Home should render the instrument statusbar");
  assert(desktopSummary.initial.homeOrganismChars > 80, "Home should render the ASCII organism");
  assert(desktopSummary.initial.homeConsoleExists === true, "Home should render the instrument console");
  assert(desktopSummary.initial.homeBrandText === "SOMNENIE", "Home statusbar should carry the platform brand");
  assert(desktopSummary.initial.homeMapLegend.includes("завершён"), "Home course map should explain its states with a legend");
  assert(desktopSummary.mapNavTitle === "M03", "Course map segment should navigate to its module");
  assert(desktopSummary.quietModeApplied === true, "Quiet mode toggle should add the quiet body class");
  assert(desktopSummary.initial.homeMetricCards === 0, "Home should not lead with dashboard-style KPI cards");
  assert(desktopSummary.initial.moduleVisuals >= 24, "Module cards should expose visual topic marks");
  assert(desktopSummary.initial.oldProfileKeyAfterStartup === null, "Legacy profile localStorage key should be removed");
  assert(desktopSummary.initial.oldProgressKeyAfterStartup === null, "Legacy progress localStorage key should be removed");
  assert(JSON.stringify(desktopSummary.profileSections) === JSON.stringify([
    "Прогресс обучения",
    "Темы для закрепления",
    "История выводов",
    "Прогресс по фазам",
    "Профиль ученика",
    "Данные",
  ]), `Profile sections should render in dashboard-first order: ${JSON.stringify(desktopSummary.profileSections)}`);
  assert(desktopSummary.progressScreenTitle === "Прогресс обучения", "Topbar should not imply an account cabinet");
  assert(desktopSummary.hasProgressContinue === true, "Progress screen should expose a primary continue action");
  assert(desktopSummary.routeBeforeQuiz.sectionCards >= 6, "Theory should render as section cards");
  assert(desktopSummary.routeBeforeQuiz.sectionMemoryCount >= 1, "Theory should expose at least one compact takeaway block");
  assert(desktopSummary.routeBeforeQuiz.sectionMemoryCount <= 3, "Theory should not repeat takeaway blocks for every section");
  assert(desktopSummary.routeBeforeQuiz.readerConceptTrailCount <= 2, "Theory should not repeat the nutrient-product-ration motif too often");
  assert(desktopSummary.routeBeforeQuiz.keyIdeaCount === 0, "Theory should not duplicate the first paragraph as a key idea block");
  assert(desktopSummary.routeBeforeQuiz.typicalMistakeCount >= 1, "Theory should expose a typical mistake block");
  assert(desktopSummary.routeBeforeQuiz.sourceCardCount >= 4, "Theory sources should render as source cards");
  assert(desktopSummary.routeBeforeQuiz.sourceDeckCollapsed === true, "Theory sources should start collapsed in a source deck");
  assert(desktopSummary.routeBeforeQuiz.sourceDeckSummaryText.includes("Источники:"), "Source deck summary should state the source count");
  assert(desktopSummary.routeBeforeQuiz.firstSectionLabel.includes("Ключевой сигнал"), "First theory section should carry the key-signal label");
  assert(desktopSummary.routeBeforeQuiz.sidePanelExists === true, "Desktop theory should expose a side panel");
  assert(desktopSummary.routeBeforeQuiz.sideTocCount >= 6, "Desktop side panel should expose a lesson table of contents");
  assert(desktopSummary.routeBeforeQuiz.sectionMetaIconCount === 0, "Theory section labels should avoid repeated decorative icons");
  assert(/\d+/.test(desktopSummary.routeBeforeQuiz.readingProgressText || ""), "Theory should expose a reading progress label");
  assert(/\b1\b/.test(desktopSummary.routeBeforeQuiz.readingProgressText || ""), "Theory reading progress should start at the first section");
  assert(desktopSummary.routeBeforeQuiz.nextText, "Theory should expose a next step");
  assert(desktopSummary.termsRoute.activeTab === "theory.md", "Lesson navigation should keep Material active for terms");
  assert(desktopSummary.termsRoute.activeMaterialBlock === "terms.md", "Lesson navigation should open terms as a material block");
  assert(desktopSummary.nextModuleRoute.title.startsWith("M02"), "Summary next action should open the next module");
  assert(desktopSummary.nextModuleRoute.activeTab === "theory.md", "Next module should open on theory");
  assert(desktopSummary.quizDiagnosis.exists === true, "Quiz feedback should render a diagnostic block");
  assert(desktopSummary.quizDiagnosis.diagnosisCount === 1, "Double-clicked quiz answer should render one diagnostic block");
  assert(desktopSummary.quizDiagnosis.nextButtonCount === 1, "Double-clicked quiz answer should render one next button");
  assert(desktopSummary.quizDiagnosis.gridItems >= 2, "Quiz diagnosis should explain weak spot and error type");
  assert(desktopSummary.quizDiagnosis.trailNodes === 0, "Quiz diagnosis should avoid repeating the concept trail");
  assert(desktopSummary.quizDiagnosis.weakSpotMistakeType, "Weak spot should store the error type");
  assert(desktopSummary.quizDiagnosis.weakSpotLevel, "Weak spot should store the weak concept level");
  assert(desktopSummary.quizDiagnosis.reviewItemCourseId === "nutrition", "SRS item should carry the nutrition course id");
  assert(desktopSummary.quizDiagnosis.reviewItemInterval === 1, "Wrong quiz answer should schedule a 1-day interval");
  assert(desktopSummary.quizDiagnosis.reviewItemLastResult === "wrong", "Wrong quiz answer should mark the SRS item as wrong");
  assert(desktopSummary.quizDiagnosis.quizAnswered === 1, "Double-clicked quiz answer should count once");
  assert(desktopSummary.quizDiagnosis.reviewItemCopies === 1, "Double-clicked quiz answer should create one SRS item");
  assert(desktopSummary.sessionReview.returnText.includes("3"), "Correct review answer should show the next 3-day return");
  assert(desktopSummary.sessionReview.returnLineCount === 1, "Double-clicked review answer should render one return line");
  assert(desktopSummary.sessionReview.nextButtonCount === 1, "Double-clicked review answer should render one next button");
  assert(desktopSummary.sessionReview.interval === 3, "Correct review answer should advance the item to a 3-day interval");
  assert(desktopSummary.sessionReview.lastResult === "right", "Correct review answer should mark the SRS item as right");
  assert(desktopSummary.sessionReview.streakDays >= 1, "Review session should update the quiet streak");
  assert(desktopSummary.sessionReview.todayReviews >= 1, "Review session should count today's reviews");
  assert(desktopSummary.progressAfterQuiz.weakSpotCount === 1, "Wrong quiz answer should create one weak spot");
  assert(desktopSummary.progressAfterQuiz.reviewItemCount >= 1, "Wrong quiz answer should create one SRS review item");
  assert(desktopSummary.export.app === "nutrio-app", "Export should include app id");
  assert(desktopSummary.export.schemaVersion === 2, "Export should include schemaVersion 2");
  assert(desktopSummary.export.reviewItemCount >= 1, "Export should include SRS review items");
  assert(desktopSummary.export.sessionsCourseId === "nutrition", "Export should include session state");
  assert(desktopSummary.resets.progressEmptyAfterProgressReset === true, "Progress reset should empty progress");
  assert(desktopSummary.resets.reviewEmptyAfterProgressReset === true, "Progress reset should empty the review queue");
  assert(desktopSummary.sw.cacheKeys.some((k) => /^nutrio-v\d+-shell$/.test(k)), "SW should create a versioned shell cache");
  assert(desktopSummary.sw.cacheKeys.some((k) => /^nutrio-v\d+-content$/.test(k)), "SW should create a versioned content cache");
  assert(desktopSummary.sw.shellHasStorage === true, "SW shell cache should include core/storage.js");
  assert(desktopSummary.sw.shellHasReview === true, "SW shell cache should include core/review.js");
  assert(desktopSummary.sw.shellHasFont === true, "SW shell cache should include local fonts");

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
  await waitFor(mobileRuntime, "document.querySelectorAll('.module-card').length === 24", 15000);
  await delay(1400);
  const mobileEval = await mobileRuntime(`({
    title: document.getElementById('title')?.textContent,
    moduleCards: document.querySelectorAll('.module-card').length,
    phaseHeaders: document.querySelectorAll('.phase-header').length,
    nextStepExists: Boolean(document.querySelector('.next-step-card')),
    nextStepActionVisible: Boolean(document.querySelector('.next-step-card .home-actions button')),
    nextStepActionBottom: document.querySelector('.next-step-card .home-actions button')?.getBoundingClientRect().bottom || 9999,
    heroVisualVisible: Boolean(document.querySelector('.hero-visual')) && getComputedStyle(document.querySelector('.hero-visual')).display !== 'none',
    courseMapSegments: document.querySelectorAll('.course-map-segment').length,
    homeInstrumentStatusbar: Boolean(document.querySelector('.instrument-statusbar')),
    homeOrganismChars: document.querySelector('#organism')?.textContent.length || 0,
    homeConsoleExists: Boolean(document.querySelector('[data-console-lines]')),
    homeMapLegend: document.querySelector('.matrix-foot .map-legend')?.textContent || '',
    homeConceptTrailNodes: document.querySelectorAll('.home-concept-trail .concept-node').length,
    moduleVisuals: document.querySelectorAll('.module-visual').length,
    hasHorizontalOverflow: document.body.scrollWidth > window.innerWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1,
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth
  })`);
  const mobile = await mobileSend("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(mobileShot, Buffer.from(mobile.data, "base64"));

  const mobileSummary = mobileEval.result.value;
  assert(mobileSummary.moduleCards === 24, "Mobile should render 24 modules");
  assert(mobileSummary.phaseHeaders === 6, "Mobile should render 6 phases");
  assert(mobileSummary.nextStepExists === true, "Mobile home should lead with the next learning step");
  assert(mobileSummary.nextStepActionVisible === true, "Mobile home should expose the primary CTA in the next-step card");
  assert(mobileSummary.heroVisualVisible === false, "Mobile home should not retain the heavy hero visual");
  assert(mobileSummary.courseMapSegments === 24, "Mobile should retain the segmented course map");
  assert(mobileSummary.homeInstrumentStatusbar === true, "Mobile home should render the instrument statusbar");
  assert(mobileSummary.homeOrganismChars > 40, "Mobile home should render the compact ASCII organism");
  assert(mobileSummary.homeConsoleExists === true, "Mobile home should render the instrument console");
  assert(mobileSummary.homeMapLegend.includes("завершён"), "Mobile course map should keep its legend");
  assert(mobileSummary.nextStepActionBottom < 600, `Mobile primary CTA should sit high in the first viewport, got ${mobileSummary.nextStepActionBottom}`);
  assert(mobileSummary.moduleVisuals >= 24, "Mobile module cards should retain visual topic marks");
  assert(mobileSummary.hasHorizontalOverflow === false, "Mobile should not have horizontal overflow");

  const mobileTabsEval = await mobileRuntime(`(async () => {
    const waitFor = async (predicate, label, timeout = 10000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (await predicate()) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('Timed out: ' + label);
    };
    document.querySelector('.module-card')?.click();
    await waitFor(() => document.querySelectorAll('#tabs button').length >= 3 && document.querySelector('.material-subnav'), 'module tabs');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const tabs = document.getElementById('tabs');
    const tabsPosition = getComputedStyle(tabs).position;
    const mobilePrimary = document.querySelector('.module-next-sticky');
    const mobileSelect = document.querySelector('.mobile-tab-select');
    const firstTabButton = document.querySelector('#tabs button');
    return {
      tabCount: document.querySelectorAll('#tabs button').length,
      materialSubtabCount: document.querySelectorAll('.material-subtab').length,
      mobileSelectVisible: Boolean(mobileSelect) && getComputedStyle(mobileSelect).display !== 'none',
      mobileSelectOptions: mobileSelect ? mobileSelect.options.length : 0,
      tabButtonsHidden: firstTabButton ? getComputedStyle(firstTabButton).display === 'none' : false,
      tabsScrollable: tabs.scrollWidth > tabs.clientWidth + 1,
      tabsHasHint: tabs.classList.contains('is-scrollable'),
      tabsFixed: tabsPosition === 'fixed' || tabsPosition === 'sticky',
      lessonSectionCards: document.querySelectorAll('.lesson-section-card').length,
      sectionMemoryCount: document.querySelectorAll('.section-memory').length,
      readerConceptTrailCount: document.querySelectorAll('.reader-concept-trail').length,
      sourceCardCount: document.querySelectorAll('.source-card').length,
      sidePanelVisible: Boolean(document.querySelector('.module-side-panel')) && getComputedStyle(document.querySelector('.module-side-panel')).display !== 'none',
      readingProgressVisible: Boolean(document.querySelector('.reading-progress')),
      readingProgressFixed: getComputedStyle(document.querySelector('.reading-progress')).position === 'fixed' || getComputedStyle(document.querySelector('.reading-progress')).position === 'sticky',
      mobilePrimaryExists: Boolean(mobilePrimary),
      mobilePrimaryFixed: mobilePrimary ? getComputedStyle(mobilePrimary).position === 'fixed' : false,
      mobilePrimaryText: mobilePrimary?.textContent || '',
      hasHorizontalOverflow: document.body.scrollWidth > window.innerWidth + 1 || document.documentElement.scrollWidth > window.innerWidth + 1,
      bodyWidth: document.body.scrollWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  })()`, true);
  const mobileTabs = mobileTabsEval.result.value;
  const mobileModule = await mobileSend("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(mobileModuleShot, Buffer.from(mobileModule.data, "base64"));

  assert(mobileTabs.tabCount === 3, "Mobile module should render the 3-step route");
  assert(mobileTabs.materialSubtabCount >= 4, "Mobile material blocks should stay visible as local navigation");
  assert(mobileTabs.mobileSelectVisible === false, "Mobile module should not use a route select");
  assert(mobileTabs.mobileSelectOptions === 0, "Mobile route select should not be rendered");
  assert(mobileTabs.tabButtonsHidden === false, "Mobile route buttons should stay visible");
  assert(mobileTabs.tabsScrollable === false, "Mobile tabs should not rely on horizontal scrolling");
  assert(mobileTabs.tabsHasHint === false, "Mobile tabs should not show a scroll hint");
  assert(mobileTabs.tabsFixed === true, "Mobile route should stay visible below the header");
  assert(mobileTabs.lessonSectionCards >= 6, "Mobile theory should render section cards");
  assert(mobileTabs.sectionMemoryCount >= 1, "Mobile theory should retain at least one compact takeaway block");
  assert(mobileTabs.sectionMemoryCount <= 3, "Mobile theory should not repeat takeaway blocks for every section");
  assert(mobileTabs.readerConceptTrailCount <= 2, "Mobile theory should keep concept trail usage compact");
  assert(mobileTabs.sourceCardCount >= 4, "Mobile theory sources should render as source cards");
  assert(mobileTabs.sidePanelVisible === false, "Mobile theory should not render the desktop side panel");
  assert(mobileTabs.readingProgressVisible === true, "Mobile theory should expose reading progress");
  assert(mobileTabs.readingProgressFixed === false, "Mobile reading progress should not consume fixed viewport height");
  assert(mobileTabs.mobilePrimaryExists === true, "Mobile theory should expose a primary next CTA in the lesson route");
  assert(mobileTabs.mobilePrimaryFixed === false, "Mobile next CTA should not be fixed over content");
  assert(mobileTabs.hasHorizontalOverflow === false, "Mobile module should not create body horizontal overflow");

  const unexpectedEvents = cdp.events.filter((event) => {
    if (event.method === "Log.entryAdded") {
      const entry = event.params?.entry;
      return entry && ["error", "warning"].includes(entry.level);
    }
    if (event.method === "Runtime.consoleAPICalled") return ["error", "warning"].includes(event.params?.type);
    return false;
  }).map((event) => event.params);

  assert(unexpectedEvents.length === 0, `Unexpected browser warnings/errors: ${JSON.stringify(unexpectedEvents, null, 2)}`);

  console.log(JSON.stringify({
    url: APP_URL,
    desktopSummary,
    mobile: mobileSummary,
    mobileTabs,
    screenshots: { desktopShot, mobileShot, mobileModuleShot },
    unexpectedEvents,
  }, null, 2));

  cdp.close();
}

run()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    chrome.kill();
  });

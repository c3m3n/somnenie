/* Сеанс повторения памяти (интервальные карточки) и его запуск.
 *
 * Вынесено из app.js по той же схеме, что и views/quiz.js: функции остаются
 * глобальными (классический <script>), продолжают видеть общие хелперы app.js
 * (buildCurrentSessionPlan, showModule, showHome, reviewApi и т.д.)
 * и вызываться из views/quiz.js (showWeakSpots) и app.js (runTodayAction).
 * Грузится после app.js — все используемые глобали уже определены к моменту вызова. */

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
  const state = index >= total ? "complete" : "review";
  const label = String(Math.min(index + 1, Math.max(total, 1))).padStart(2, "0");
  return (
    `<header class="session-head">` +
      `<span class="session-station-marker" data-session-state="${state}" aria-hidden="true">${label}</span>` +
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
    `<div class="memory-learning-kicker">материал</div>` +
    `<h3>${escapeHtml(memory.userLabel)}</h3>` +
    `<p>${escapeHtml(memory.shortExplanation)}</p>` +
    `<div class="memory-review-strategy">` +
      `<span>Как тренируем</span>` +
      `<strong>${escapeHtml(memory.reviewStrategy)}</strong>` +
    `</div>` +
  `</div>`;
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
  setView(() => showReviewSession(plan));
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
        `<span>сигналов: ${escapeHtml(item.errors || 0)}</span>` +
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
          if (!isRight) {
            card.appendChild(returnToMaterialButton(mod, item, async () => {
              await renderCurrent();
            }));
          }
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
        `<span>сигналов: ${escapeHtml(item.errors || 0)}</span>` +
      `</div>` +
      `<div class="q-kicker">Карточка памяти</div>` +
      `<div class="q-text">объясните себе: ${escapeHtml(weakSpotLearningCard(item).shortExplanation || item.text || item.mistakeType || "что здесь нужно уточнить")}</div>`;

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
        if (!isRight) {
          card.appendChild(returnToMaterialButton(mod, item, async () => {
            await renderCurrent();
          }));
        }
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
        `<p>Повторили ${items.length} ${pluralizeRepeats(items.length)}. ${tomorrow} ${tomorrow === 1 ? "материал вернётся" : "материалов вернутся"} завтра.</p>` +
      `</div>`;
    $screen.appendChild(wrap);

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

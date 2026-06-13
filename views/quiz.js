/* Экран проверки знаний станции (quiz) и память слабых мест.
 *
 * Пилотный вынос из app.js: функции остаются глобальными (классический <script>),
 * поэтому продолжают видеть общие хелперы app.js (runAsync, setModProgress,
 * renderMarkdownInline, appendModuleNavigation и т.д.) и вызываться из openTab.
 * Грузится после app.js — все используемые глобали уже определены к моменту вызова. */

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
    `<p>материалы на повторение возвращаются в короткой сессии памяти.</p>` +
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
        ? `<span>верных ${correct} из ${gradedTotal} · ${mistakes ? `${mistakes} ${pluralizeSignals(mistakes)} для повтора` : "без сбоев"}</span>`
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
  // но «частично/не справился» заводит материал и карточку в очередь повторения.
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
        : "Нужно вернуться к закреплению";
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
    card.innerHTML = `<h2>Память</h2>${safetyNoteHtml()}<p>Сейчас нет тем для повторения.</p>`;
    $screen.appendChild(card);
    return;
  }

  card.innerHTML =
    `<div class="section-kicker">${iconSvg("review", "kicker-icon")}<span>Memory</span></div>` +
    `<h2>Память</h2>` +
    safetyNoteHtml() +
    `<p class="muted">Здесь хранятся не просто пропущенные вопросы, а темы, которые стоит закрепить: почему это важно и как тренировать.</p>`;

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
          `<span>сигналов: ${escapeHtml(item.errors || 0)}</span>` +
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
  clear.textContent = "Сбросить карточки памяти";
  clear.onclick = runAsync(async () => {
    if (!confirm("Очистить карты памяти этой станции?")) return;
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

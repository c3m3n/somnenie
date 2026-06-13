import { useRef, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, ClipboardCheck, NotebookPen } from "lucide-react";
import { getCheckpointOutcome, getRemediationPlan } from "../../domain/learningPath";
import { parseQuiz } from "../../domain/quiz";
import { recordSessionActivity, upsertWrongQuestion } from "../../domain/review";
import { QUIZ_PROGRESS_VERSION, type AppState, type CheckpointAttempt, type CourseModule, type FailedCheckpointAnswer, type ModuleProgress, type ProgressMap, type QuizQuestion, type RemediationPlan, type StationStepKey } from "../../domain/types";
import { navigate } from "../route";
import { renderInlineMarkdown, renderMarkdown } from "../markdown";

const PASS_RATIO = 0.7;

export function StationView(props: StationProps) {
  return (
    <section className={`screen station-screen station-${props.step}`}>
      <StationHead module={props.module} step={props.step} />
      <StationTabs moduleId={props.module.id} active={props.step} />
      <div className="station-product">
        {props.step === "check" ? <QuizStep {...props} /> : <LearningStep {...props} />}
      </div>
    </section>
  );
}

export function CheckpointRemediationView({ module, plan }: { module: CourseModule; plan: RemediationPlan }) {
  const [index, setIndex] = useState(0);
  const answers = plan.failedAnswers;

  if (!answers.length) {
    return (
      <section className="screen station-screen">
        <header className="station-head">
          <div className="section-kicker">Разбор ошибок</div>
          <h2>{module.id}. {module.title}</h2>
        </header>
        <div className="remediation-empty">Нет подробных данных по ошибкам.</div>
      </section>
    );
  }

  const current = answers[index];
  const isLast = index === answers.length - 1;
  const targetStep = routeStepFromWeakSpot(current);
  const nextIndex = Math.min(index + 1, answers.length - 1);

  return (
    <section className="screen station-screen remediation-screen">
      <header className="station-head">
        <div className="section-kicker">Разбор ошибки {index + 1} из {answers.length}</div>
        <h2>{module.id}. {module.title}</h2>
      </header>
      <article className="remediation-card">
        <p className="remediation-block">Блок: {module.id}</p>
        <p className="remediation-question-title">Вопрос {current.questionNumber}: {current.questionText}</p>
        <p><strong>Ваш ответ:</strong> {current.chosenOptionText || "—"}</p>
        <p><strong>Правильный ответ:</strong> {current.correctOptionText || "—"}</p>
        <p><strong>Почему важно:</strong> {current.explanation}</p>
        <p><strong>Связанный материал:</strong> {current.sourceBlock || current.sourceLesson || "Курс"}</p>
      </article>
      <div className="remediation-actions">
        <button type="button" className="primary-action" onClick={() => navigate({ screen: "station", moduleId: module.id, step: targetStep })}>
          Открыть фрагмент
        </button>
        <button
          type="button"
          onClick={() => {
            if (isLast) {
              navigate({ screen: "today" });
            } else {
              setIndex(nextIndex);
            }
          }}
        >
          {isLast ? "К курсу" : "Следующий"}
        </button>
      </div>
    </section>
  );
}

interface StationProps {
  module: CourseModule;
  step: StationStepKey;
  progress: ModuleProgress;
  appState: AppState;
  saveProgress: (moduleId: string, patch: ModuleProgress) => Promise<void>;
  saveState: (patch: Partial<AppState>) => Promise<void>;
}

function StationHead({ module, step }: { module: CourseModule; step: StationStepKey }) {
  return <header className="station-head"><div className="section-kicker">{module.phaseTitle}</div><h2>{module.id}. {module.title}</h2><p>{stepLabel(step)}</p></header>;
}

function StationTabs({ moduleId, active }: { moduleId: string; active: StationStepKey }) {
  return (
    <nav className="station-tabs" aria-label="Навигация по шагам">
      {steps().map((step) => (
        <button aria-label={step.label} className={active === step.key ? "active" : ""} type="button" key={step.key} onClick={() => navigate({ screen: "station", moduleId, step: step.key })}>
          {step.icon}
          <span className="step-full">{step.label}</span>
          <span className="step-short">{step.shortLabel}</span>
        </button>
      ))}
    </nav>
  );
}

function LearningStep(props: StationProps) {
  if (props.step === "anchor") return <AnchorStep {...props} />;
  const files = filesForStep(props.step);
  return (
    <div className={`reading-flow reading-flow-${props.step}`}>
      {files.map((file, index) => <article className={index === 0 ? "markdown-block primary-sheet" : "markdown-block"} key={file} dangerouslySetInnerHTML={{ __html: renderMarkdown(props.module.files[file]) }} />)}
      <NextStepButton {...props} />
    </div>
  );
}

function AnchorStep({ module, progress, saveProgress }: StationProps) {
  const [draft, setDraft] = useState(progress.takeawayDraft ?? progress.takeaway ?? "");
  const saveDraft = (value: string) => {
    setDraft(value);
    void saveProgress(module.id, { takeawayDraft: value });
  };
  return (
    <div className="reading-flow">
      <article className="markdown-block" dangerouslySetInnerHTML={{ __html: renderMarkdown(module.files["summary.md"]) }} />
      <label className="journal-editor">
        <span>Краткая идея:</span>
        <textarea value={draft} onChange={(event) => saveDraft(event.target.value)} />
      </label>
      <button className="primary-action" type="button" onClick={() => void commitTakeaway(module.id, draft, saveProgress)}>
        <NotebookPen size={20} />
        Сохранить
      </button>
    </div>
  );
}

function QuizStep(props: StationProps) {
  const questions = parseQuiz(props.module.files["quiz.md"]);
  return <QuizFlow questions={questions} {...props} />;
}

function QuizFlow(props: { module: CourseModule; progress: ModuleProgress; questions: QuizQuestion[]; appState: AppState; saveProgress: StationProps["saveProgress"]; saveState: StationProps["saveState"] }) {
  const { module, progress, questions, appState, saveProgress, saveState } = props;
  const answered = progress.quizAnswered || 0;
  const current = questions[answered];
  const autoTotal = questions.filter((question) => question.kind === "auto").length;
  const outcome = getCheckpointOutcome(module.id, { [module.id]: progress } as ProgressMap);
  if (!current) return <QuizResult module={module} questions={questions} outcome={outcome} progress={progress} appState={appState} saveProgress={saveProgress} />;
  return <QuestionCard module={module} question={current} progress={progress} isLast={answered + 1 >= questions.length} autoTotal={autoTotal} appState={appState} saveProgress={saveProgress} saveState={saveState} />;
}

function QuizResult({ module, outcome, progress, appState, saveProgress }: { module: CourseModule; outcome: ReturnType<typeof getCheckpointOutcome>; progress: ModuleProgress; appState: AppState; questions?: QuizQuestion[]; saveProgress: StationProps["saveProgress"] }) {
  const isFailed = outcome.status === "failed";
  const failedAnswers = isFailed ? getRemediationPlan(module.id, { [module.id]: progress } as ProgressMap)?.failedAnswers || [] : [];
  return (
    <div className="quiz-result">
      <CheckCircle2 size={32} />
      <h3>{isFailed ? "Контрольная не сдана" : "Контрольная сдана"}</h3>
      <p>{outcome.score.correct} / {outcome.score.total}</p>
      {isFailed ? (
        <>
          <p>Слабые места:</p>
          <ul>{failedAnswers.slice(0, 3).map((answer) => <li key={answer.questionId}>{answer.questionText}</li>)}</ul>
        </>
      ) : (
        <p>Следующий блок открыт.</p>
      )}
      <div className="result-actions">
        {isFailed ? (
          <>
            <button type="button" onClick={() => navigate({ screen: "remediation", moduleId: module.id })}>Разобрать ошибки</button>
            <button type="button" onClick={() => void retryQuiz(module.id, outcome.score.total, saveProgress)}>Пройти контрольную ещё раз</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => navigate({ screen: "today" })}>Вернуться к курсу</button>
            <button type="button" onClick={() => navigate({ screen: "today" })}>Вернуться к учёбе</button>
          </>
        )}
      </div>
    </div>
  );
}

function QuestionCard({ module, question, progress, isLast, autoTotal, appState, saveProgress, saveState }: { module: CourseModule; question: QuizQuestion; progress: ModuleProgress; isLast: boolean; autoTotal: number; appState: AppState; saveProgress: StationProps["saveProgress"]; saveState: StationProps["saveState"] }) {
  return (
    <article className="quiz-card product-question">
      <div className="section-kicker">Вопрос {question.number}</div>
      <div className="quiz-question" dangerouslySetInnerHTML={{ __html: renderMarkdown(question.text) }} />
      {question.kind === "application" ? <ApplicationQuestion module={module} question={question} progress={progress} isLast={isLast} saveProgress={saveProgress} /> : <AutoQuestion module={module} question={question} progress={progress} isLast={isLast} autoTotal={autoTotal} appState={appState} saveProgress={saveProgress} saveState={saveState} />}
    </article>
  );
}

function AutoQuestion({ module, question, progress, isLast, autoTotal, appState, saveProgress, saveState }: { module: CourseModule; question: QuizQuestion; progress: ModuleProgress; isLast: boolean; autoTotal: number; appState: AppState; saveProgress: StationProps["saveProgress"]; saveState: StationProps["saveState"] }) {
  const [locked, setLocked] = useState(false);
  const lockRef = useRef(false);
  const choose = (key: string) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setLocked(true);
    void answerAuto({ module, question, progress, isLast, autoTotal, appState, saveProgress, saveState, chosenKey: key }, key);
  };
  return <div className="answer-list">{question.options.map((option) => <button type="button" disabled={locked} key={option.key} onClick={() => void choose(option.key)}><span>{option.key}</span><span dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(option.text) }} /></button>)}</div>;
}

function ApplicationQuestion({ module, question, progress, isLast, saveProgress }: { module: CourseModule; question: QuizQuestion; progress: ModuleProgress; isLast: boolean; saveProgress: StationProps["saveProgress"] }) {
  return <div className="application-block"><div dangerouslySetInnerHTML={{ __html: renderMarkdown(question.explain) }} /><button type="button" onClick={() => void recordOpenAnswer(module.id, progress, isLast, saveProgress)}>Открыть</button></div>;
}

async function answerAuto(context: AnswerContext, chosen: string): Promise<void> {
  const isRight = String(context.question.answer) === chosen;
  const now = new Date().toISOString();
  await context.saveProgress(context.module.id, nextQuizProgress(context, isRight, now));
  if (!isRight) await saveWrongAnswer(context.module, context.question, context.appState, context.saveState, chosen);
}

async function saveWrongAnswer(module: CourseModule, question: QuizQuestion, appState: AppState, saveState: StationProps["saveState"], chosen: string): Promise<void> {
  const review = upsertWrongQuestion(appState.review, { moduleId: module.id, questionNumber: question.number, questionText: question.text, explanation: question.explain, userLabel: "Вопрос в контрольной", reviewStrategy: "Повторить вопрос на повторении." });
  await saveState({ review, sessions: recordSessionActivity(appState.sessions, { reviews: 1 }) });
}

async function recordOpenAnswer(moduleId: string, progress: ModuleProgress, isLast: boolean, saveProgress: StationProps["saveProgress"]): Promise<void> {
  await saveProgress(moduleId, { quizAnswered: (progress.quizAnswered || 0) + 1, quizAttemptStatus: isLast ? "complete" : "in-progress", quizCompletedAt: isLast ? new Date().toISOString() : progress.quizCompletedAt });
}

async function retryQuiz(moduleId: string, existingTotal: number, saveProgress: StationProps["saveProgress"]): Promise<void> {
  await saveProgress(moduleId, {
    quizAnswered: 0,
    quizCorrect: 0,
    quizMistakes: 0,
    quizBest: 0,
    quizTotal: existingTotal,
    quizAttemptStatus: "in-progress",
    quizStartedAt: new Date().toISOString(),
    quizCompletedAt: undefined,
  });
  navigate({ screen: "station", moduleId, step: "check" });
}

async function commitTakeaway(moduleId: string, draft: string, saveProgress: StationProps["saveProgress"]): Promise<void> {
  const takeaway = draft.trim() || "Собранная мысль.";
  await saveProgress(moduleId, { theoryRead: true, takeaway, takeawayDraft: "", takeawayUpdatedAt: new Date().toISOString() });
  navigate({ screen: "today" });
}

function nextQuizProgress(context: AnswerContext, isRight: boolean, now: string): ModuleProgress {
  const answered = (context.progress.quizAnswered || 0) + 1;
  const correct = (context.progress.quizCorrect || 0) + (isRight ? 1 : 0);
  const startedAt = context.progress.quizStartedAt || now;
  const weakSpots = nextWeakSpotState(context, isRight);
  const nextProgress: ModuleProgress = {
    quizAttemptStatus: quizAttemptStatus(context.isLast),
    quizAnswered: answered,
    quizCorrect: correct,
    quizMistakes: nextMistakeCount(context.progress, isRight),
    quizCompletedAt: quizCompletedAt(context, now),
    quizStartedAt: startedAt,
    quizTotalQuestions: answered,
    quizBest: Math.max(context.progress.quizBest || 0, correct),
    quizTotal: context.autoTotal,
    quizVersion: QUIZ_PROGRESS_VERSION,
    weakSpots,
  };
  if (context.isLast) {
    nextProgress.checkpointAttempts = appendCheckpointAttempt(context.progress.checkpointAttempts, buildCheckpointAttempt(context, isRight ? null : context.question.number, weakSpots, correct, context.autoTotal, startedAt, now));
  }
  return nextProgress;
}

function appendCheckpointAttempt(current: ModuleProgress["checkpointAttempts"], attempt: CheckpointAttempt): ModuleProgress["checkpointAttempts"] {
  const currentAttempts = current ? [...current] : [];
  currentAttempts.push(attempt);
  return currentAttempts;
}

function buildCheckpointAttempt(context: AnswerContext, wrongQuestion: number | null, weakSpots: ModuleProgress["weakSpots"], correct: number, total: number, startedAt: string, completedAt: string): CheckpointAttempt {
  const failedQuestionIds = deriveFailedQuestionIds(context, wrongQuestion, weakSpots);
  return {
    blockId: context.module.id,
    startedAt,
    completedAt,
    correct,
    total,
    passed: isPassed(correct, total),
    failedQuestionIds,
  };
}

function deriveFailedQuestionIds(context: AnswerContext, wrongQuestion: number | null, weakSpots: ModuleProgress["weakSpots"]): string[] {
  const ids = new Set<string>();
  if (wrongQuestion !== null) ids.add(String(wrongQuestion));
  if (weakSpots) {
    for (const key of Object.keys(weakSpots)) {
      ids.add(String(key));
    }
  }
  return Array.from(ids).sort((left, right) => Number(left) - Number(right));
}

function isPassed(correct: number, total: number): boolean {
  if (total <= 0) return false;
  return correct / total >= PASS_RATIO;
}

function quizAttemptStatus(isLast: boolean): ModuleProgress["quizAttemptStatus"] {
  return isLast ? "complete" : "in-progress";
}

function nextMistakeCount(progress: ModuleProgress, isRight: boolean): number {
  return (progress.quizMistakes || 0) + (isRight ? 0 : 1);
}

function quizCompletedAt(context: AnswerContext, now: string): string | undefined {
  return context.isLast ? now : context.progress.quizCompletedAt;
}

function nextWeakSpotState(context: AnswerContext, isRight: boolean): ModuleProgress["weakSpots"] {
  return isRight ? context.progress.weakSpots : nextWeakSpots(context.progress, context.question, context.chosenKey, context.module.id);
}

function nextWeakSpots(progress: ModuleProgress, question: QuizQuestion, chosenKey: string, moduleId: string): ModuleProgress["weakSpots"] {
  const correctOption = question.options.find((option) => String(question.answer) === option.key);
  const chosenOption = question.options.find((option) => option.key === chosenKey);
  return {
    ...(progress.weakSpots || {}),
    [question.number]: {
      number: question.number,
      questionNumber: question.number,
      text: question.text,
      questionText: question.text,
      shortExplanation: question.explain,
      userLabel: "Вопрос в контрольной",
      reviewStrategy: "Повторить вопрос и объяснить идею.",
      misses: ((progress.weakSpots || {})[question.number]?.misses || 0) + 1,
      updatedAt: new Date().toISOString(),
      sourceBlock: question.sourceBlock,
      sourceLesson: moduleId,
      sourceFragment: "check",
      chosenOptionKey: chosenKey,
      chosenOptionText: chosenOption?.text ?? null,
      correctOptionKey: correctOption?.key ?? null,
      correctOptionText: correctOption?.text ?? null,
    },
  };
}

function NextStepButton({ module, step, saveProgress }: StationProps) {
  const next = nextStep(step);
  return <button className="next-inline" type="button" onClick={() => void markAndMove(module.id, step, next, saveProgress)}><ArrowRight size={18} />{next ? stepLabel(next) : "На сегодня"}</button>;
}

async function markAndMove(moduleId: string, step: StationStepKey, next: StationStepKey | null, saveProgress: StationProps["saveProgress"]): Promise<void> {
  if (step === "understand") await saveProgress(moduleId, { theoryRead: true });
  if (next) navigate({ screen: "station", moduleId, step: next });
  else navigate({ screen: "today" });
}

function routeStepFromWeakSpot(answer: FailedCheckpointAnswer): StationStepKey {
  const candidate = `${answer.sourceFragment || ""} ${answer.sourceBlock || ""} ${answer.sourceLesson || ""}`.toLowerCase();
  if (candidate.includes("apply") || candidate.includes("practice") || candidate.includes("средство")) return "apply";
  if (candidate.includes("check") || candidate.includes("quiz") || candidate.includes("контрольная") || candidate.includes("вопрос")) return "check";
  if (candidate.includes("anchor") || candidate.includes("summary") || candidate.includes("итог")) return "anchor";
  return "understand";
}

function steps() {
  return [
    { key: "understand" as const, label: "Начать", shortLabel: "Читать", icon: <BookOpen size={16} /> },
    { key: "apply" as const, label: "Применить", shortLabel: "Практика", icon: <ClipboardCheck size={16} /> },
    { key: "check" as const, label: "Проверить", shortLabel: "Контроль", icon: <CheckCircle2 size={16} /> },
    { key: "anchor" as const, label: "Закрыть", shortLabel: "Итог", icon: <NotebookPen size={16} /> },
  ];
}

function filesForStep(step: StationStepKey) {
  if (step === "understand") return ["theory.md", "terms.md"] as const;
  if (step === "apply") return ["practice.md", "diagrams.md"] as const;
  return ["summary.md"] as const;
}

function nextStep(step: StationStepKey): StationStepKey | null {
  if (step === "understand") return "apply";
  if (step === "apply") return "check";
  if (step === "check") return "anchor";
  return null;
}

function stepLabel(step: StationStepKey): string {
  return steps().find((item) => item.key === step)?.label || "Подробнее";
}

interface AnswerContext {
  module: CourseModule;
  question: QuizQuestion;
  progress: ModuleProgress;
  isLast: boolean;
  autoTotal: number;
  appState: AppState;
  saveProgress: StationProps["saveProgress"];
  saveState: StationProps["saveState"];
  chosenKey: string;
}

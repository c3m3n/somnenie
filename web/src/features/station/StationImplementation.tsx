import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ensureModuleFiles, moduleFilesLoaded } from "../../content/api";
import { PASS_RATIO } from "../../domain/blockStateMachine";
import { canRetakeCheckpoint, getCheckpointOutcome, RETAKE_COOLDOWN_MS } from "../../domain/learningPath";
import { parseQuiz } from "../../domain/quiz";
import { recordSessionActivity, upsertWrongQuestion } from "../../domain/review";
import { QUIZ_PROGRESS_VERSION, type AppState, type CheckpointAttempt, type CourseBundle, type CourseModule, type FailedCheckpointAnswer, type ModuleProgress, type ProgressMap, type QuizQuestion, type RemediationPlan, type StationStepKey } from "../../domain/types";
import { navigate, routeHash } from "../../ui/route";
import { Md, MdInline } from "../../ui/md";
import { seededShuffle } from "../../shared/utils/seededShuffle";
import { ReaderView } from "../reader/ReaderView";

const ANSWER_FEEDBACK_MS = 700;

export function StationView(props: StationProps) {
  if (props.step !== "check") {
    return <ReaderView bundle={props.bundle} module={props.module} progress={props.progress} appState={props.appState} saveProgress={props.saveProgress} saveState={props.saveState} />;
  }
  return <QuizLoader {...props} />;
}

function QuizLoader({ bundle, module, step, progress, appState, saveProgress, saveState }: StationProps) {
  const [ready, setReady] = useState(() => moduleFilesLoaded(module, ["quiz.md"]));
  const [error, setError] = useState(false);

  const loadQuiz = useCallback(() => {
    if (moduleFilesLoaded(module, ["quiz.md"])) {
      setReady(true);
      setError(false);
      return () => undefined;
    }
    let cancelled = false;
    setReady(false);
    setError(false);
    void ensureModuleFiles(bundle, module.id, ["quiz.md"])
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [bundle, module]);

  useEffect(() => {
    return loadQuiz();
  }, [loadQuiz]);

  if (error) {
    return (
      <section className="screen station-screen">
        <div className="load-error" role="alert">
          <p>Не удалось загрузить зачёт.</p>
          <p>Проверьте соединение и попробуйте снова.</p>
          <button className="primary-action" type="button" onClick={() => loadQuiz()}>Повторить</button>
        </div>
      </section>
    );
  }

  if (!ready) {
    return (
      <section className="screen station-screen">
        <div className="loading" role="status">Загрузка зачёта...</div>
      </section>
    );
  }

  return (
    <section className="screen station-screen station-check">
      <header className="station-head">
        <div className="section-kicker">Блок · {module.phaseTitle}</div>
        <h2>{module.id}. {module.title}</h2>
        <p>Зачёт</p>
      </header>
      <div className="station-product">
        <QuizStep bundle={bundle} module={module} step={step} progress={progress} appState={appState} saveProgress={saveProgress} saveState={saveState} />
      </div>
    </section>
  );
}

export function CheckpointRemediationView({ module, plan }: { module: CourseModule; plan: RemediationPlan }) {
  const [index, setIndex] = useState(0);
  const answers = plan.failedAnswers;

  if (answers.length === 0) {
    return (
      <section className="screen station-screen">
        <header className="station-head">
          <div className="section-kicker">Разбор ошибок</div>
          <h2>{module.id}. {module.title}</h2>
        </header>
        <article className="remediation-empty">
          <p>Не удалось восстановить список вопросов.</p>
          <p>Откройте материал блока и попробуйте пройти зачёт ещё раз.</p>
        </article>
        <div className="remediation-actions">
          <a className="primary-action" href={routeHash({ screen: "station", moduleId: module.id, step: "understand" })} onClick={(event) => {
            event.preventDefault();
            navigate({ screen: "station", moduleId: module.id, step: "understand" });
          }}>
            Открыть материал
          </a>
          <a className="primary-action" href={routeHash({ screen: "station", moduleId: module.id, step: "check" })} onClick={(event) => {
            event.preventDefault();
            navigate({ screen: "station", moduleId: module.id, step: "check" });
          }}>
            Пройти зачёт
          </a>
        </div>
      </section>
    );
  }

  const current = answers[index];
  const hasNext = index < answers.length - 1;
  const targetStep = routeStepFromWeakSpot(current);

  return (
    <section className="screen station-screen remediation-screen">
      <header className="station-head">
        <div className="section-kicker">Разбор ошибок</div>
        <h2>{module.id}. {module.title}</h2>
        <p>Ошибка {index + 1} из {answers.length}</p>
      </header>
      <article className="remediation-card">
        <p className="remediation-block">Блок {module.id}</p>
        <p className="remediation-question-title">Вопрос: {current.questionText}</p>
        <p><strong>Ваш ответ:</strong> {current.chosenOptionText || "—"}</p>
        <p><strong>Правильная идея:</strong> {current.correctOptionText || "—"}</p>
        <p><strong>Почему это важно:</strong> {current.explanation}</p>
        <p><strong>Связанный материал:</strong> {sourceLabel(current, module.id)}</p>
      </article>
      <div className="remediation-actions">
        <a className="primary-action" href={routeHash({ screen: "station", moduleId: module.id, step: targetStep })} onClick={(event) => {
          event.preventDefault();
          navigate({ screen: "station", moduleId: module.id, step: targetStep });
        }}>
          Открыть материал
        </a>
        <button className="primary-action" type="button" onClick={() => {
          if (hasNext) setIndex(index + 1);
          else navigate({ screen: "station", moduleId: module.id, step: "check" });
        }}>
          {hasNext ? "Следующая ошибка" : plan.canRetake ? "Попробовать зачёт ещё раз" : "Вернуться к зачёту"}
        </button>
      </div>
    </section>
  );
}

function sourceLabel(answer: FailedCheckpointAnswer, fallbackLessonId: string): string {
  if (answer.sourceBlock) return answer.sourceBlock;
  if (answer.sourceLesson) return answer.sourceLesson;
  return fallbackLessonId;
}

interface StationProps {
  bundle: CourseBundle;
  module: CourseModule;
  step: StationStepKey;
  progress: ModuleProgress;
  appState: AppState;
  saveProgress: (moduleId: string, patch: ModuleProgress) => Promise<void>;
  saveState: (patch: Partial<AppState>) => Promise<void>;
}


function QuizStep(props: StationProps) {
  const parsed = parseQuiz(props.module.files["quiz.md"], `${props.module.id}:${props.progress.quizVersion || QUIZ_PROGRESS_VERSION}`);
  const questions = typeof props.progress.quizSeed === "number" ? seededShuffle(parsed, props.progress.quizSeed) : parsed;
  return <QuizFlow questions={questions} {...props} />;
}

function QuizFlow(props: { module: CourseModule; progress: ModuleProgress; questions: QuizQuestion[]; appState: AppState; saveProgress: StationProps["saveProgress"]; saveState: StationProps["saveState"] }) {
  const { module, progress, questions, appState, saveProgress, saveState } = props;
  const answered = progress.quizAnswered || 0;
  const current = questions[answered];
  const autoTotal = questions.filter((question) => question.kind === "auto").length;
  const moduleProgress: ProgressMap = { [module.id]: progress };
  const outcome = getCheckpointOutcome(module.id, moduleProgress);
  const canRetake = canRetakeCheckpoint(module.id, moduleProgress);
  if (!current) return <QuizResult module={module} outcome={outcome} canRetake={canRetake} saveProgress={saveProgress} />;
  return <QuestionCard key={current.number} module={module} question={current} progress={progress} isLast={answered + 1 >= questions.length} autoTotal={autoTotal} appState={appState} saveProgress={saveProgress} saveState={saveState} />;
}

function QuizResult({ module, outcome, canRetake, saveProgress }: { module: CourseModule; outcome: ReturnType<typeof getCheckpointOutcome>; canRetake: boolean; questions?: QuizQuestion[]; saveProgress: StationProps["saveProgress"] }) {
  const isFailed = outcome.status === "failed";
  const resultRoute = isFailed ? routeHash({ screen: "remediation", moduleId: module.id }) : routeHash({ screen: "today" });
  return (
    <div className="quiz-result">
      <CheckCircle2 size={32} />
      <h3>Зачёт</h3>
      <p>{outcome.score.correct} / {outcome.score.total}</p>
      <p>{isFailed ? "Зачёт не сдан" : "Зачёт сдан"}</p>
      <p>{isFailed ? "Следующий блок пока закрыт." : "Следующий блок открыт."}</p>
      <div className="result-actions">
        {isFailed ? (
          <>
            <a className="primary-action" href={resultRoute} onClick={(event) => {
              event.preventDefault();
              navigate({ screen: "remediation", moduleId: module.id });
            }}>
              Разобрать ошибки
            </a>
            {canRetake ? (
              <button type="button" className="primary-action" onClick={() => void retryQuiz(module.id, saveProgress)}>
                Попробовать ещё раз
              </button>
            ) : (
              <p className="retry-cooldown">Следующая попытка доступна примерно через {minutesUntilRetake(outcome.failureDate)} мин.</p>
            )}
          </>
        ) : (
          <>
            <button className="primary-action" type="button" onClick={() => navigate({ screen: "atlas" })}>
              К следующему шагу
            </button>
            <a href={routeHash({ screen: "today" })} onClick={(event) => {
              event.preventDefault();
              navigate({ screen: "today" });
            }}>
              Вернуться в маршрут
            </a>
          </>
        )}
      </div>
    </div>
  );
}

function minutesUntilRetake(failureDate: string | null): number {
  if (!failureDate) return Math.ceil(RETAKE_COOLDOWN_MS / 60000);
  const remaining = RETAKE_COOLDOWN_MS - (Date.now() - new Date(failureDate).getTime());
  return Math.max(1, Math.ceil(remaining / 60000));
}

function QuestionCard({ module, question, progress, isLast, autoTotal, appState, saveProgress, saveState }: { module: CourseModule; question: QuizQuestion; progress: ModuleProgress; isLast: boolean; autoTotal: number; appState: AppState; saveProgress: StationProps["saveProgress"]; saveState: StationProps["saveState"] }) {
  return (
    <article className="quiz-card product-question">
      <div className="section-kicker">Вопрос {question.number}</div>
      <Md className="quiz-question">{question.text}</Md>
      {question.kind === "application" ? <ApplicationQuestion module={module} question={question} progress={progress} isLast={isLast} saveProgress={saveProgress} /> : <AutoQuestion module={module} question={question} progress={progress} isLast={isLast} autoTotal={autoTotal} appState={appState} saveProgress={saveProgress} saveState={saveState} />}
    </article>
  );
}

function AutoQuestion({ module, question, progress, isLast, autoTotal, appState, saveProgress, saveState }: { module: CourseModule; question: QuizQuestion; progress: ModuleProgress; isLast: boolean; autoTotal: number; appState: AppState; saveProgress: StationProps["saveProgress"]; saveState: StationProps["saveState"] }) {
  const [locked, setLocked] = useState(false);
  const [feedback, setFeedback] = useState<"right" | "wrong" | null>(null);
  const [resultText, setResultText] = useState("");
  const lockRef = useRef(false);
  const feedbackTimeout = useRef<number | null>(null);

  useEffect(() => () => {
    if (feedbackTimeout.current) window.clearTimeout(feedbackTimeout.current);
  }, []);

  const choose = (key: string) => {
    if (lockRef.current) return;
    const isRight = String(question.answer) === key;
    lockRef.current = true;
    setLocked(true);
    setFeedback(isRight ? "right" : "wrong");
    setResultText(isRight ? "Верно, переходим к следующему" : "Неверно, сохранено для разбора");
    feedbackTimeout.current = window.setTimeout(() => {
      setFeedback(null);
    }, ANSWER_FEEDBACK_MS);
    void answerAuto({ module, question, progress, isLast, autoTotal, appState, saveProgress, saveState }, key);
  };

  return (
    <div className="answer-list">
      {question.options.map((option) => <button type="button" disabled={locked} key={option.key} onClick={() => void choose(option.key)}><span>{option.key}</span><MdInline>{option.text}</MdInline></button>)}
      {feedback ? <p className={`quiz-feedback quiz-feedback-${feedback}`} role="status">{resultText}</p> : null}
    </div>
  );
}

function ApplicationQuestion({ module, question, progress, isLast, saveProgress }: { module: CourseModule; question: QuizQuestion; progress: ModuleProgress; isLast: boolean; saveProgress: StationProps["saveProgress"] }) {
  return <div className="application-block"><Md>{question.explain}</Md><button type="button" onClick={() => void recordOpenAnswer(module.id, progress, isLast, saveProgress)}>Продолжить</button></div>;
}

async function answerAuto(context: AnswerContext, chosen: string): Promise<void> {
  const isRight = String(context.question.answer) === chosen;
  const now = new Date().toISOString();
  await context.saveProgress(context.module.id, nextQuizProgress(context, isRight, now, chosen));
  if (!isRight) await saveWrongAnswer(context.module, context.question, context.appState, context.saveState);
}

async function saveWrongAnswer(module: CourseModule, question: QuizQuestion, appState: AppState, saveState: StationProps["saveState"]): Promise<void> {
  const review = upsertWrongQuestion(appState.review, { moduleId: module.id, questionNumber: question.number, questionText: question.text, explanation: question.explain, userLabel: "Слабое место из зачёта", reviewStrategy: "Перейти к разбору ошибки после ошибки." });
  await saveState({ review, sessions: recordSessionActivity(appState.sessions, { reviews: 1, moduleStep: true }) });
}

async function recordOpenAnswer(moduleId: string, progress: ModuleProgress, isLast: boolean, saveProgress: StationProps["saveProgress"]): Promise<void> {
  await saveProgress(moduleId, { quizAnswered: (progress.quizAnswered || 0) + 1, quizAttemptStatus: isLast ? "complete" : "in-progress", quizCompletedAt: isLast ? new Date().toISOString() : progress.quizCompletedAt });
}

export async function retryQuiz(moduleId: string, saveProgress: StationProps["saveProgress"]): Promise<void> {
  await saveProgress(moduleId, {
    quizAnswered: 0,
    quizCorrect: 0,
    quizCompletedAt: undefined,
    quizAttemptStatus: "in-progress",
    quizSeed: Math.floor(Math.random() * 2_147_483_647),
  });
  navigate({ screen: "station", moduleId, step: "check" });
}


export function nextQuizProgress(context: AnswerContext, isRight: boolean, now: string, chosen: string): ModuleProgress {
  const answered = (context.progress.quizAnswered || 0) + 1;
  const correct = (context.progress.quizCorrect || 0) + (isRight ? 1 : 0);
  const weakSpots = nextWeakSpotState(context, isRight, chosen);
  const nextProgress: ModuleProgress = {
    quizAttemptStatus: quizAttemptStatus(context.isLast),
    quizAnswered: answered,
    quizCorrect: correct,
    quizStartedAt: quizStartedAt(context, now),
    quizCompletedAt: quizCompletedAt(context, now),
    quizBest: Math.max(context.progress.quizBest || 0, correct),
    quizTotal: context.autoTotal,
    quizVersion: QUIZ_PROGRESS_VERSION,
    weakSpots,
  };
  if (context.isLast) {
    nextProgress.checkpointAttempts = appendCheckpointAttempt(
      context.progress.checkpointAttempts,
      buildCheckpointAttempt(context, {
        wrongQuestion: isRight ? null : context.question.number,
        weakSpots,
        correct,
        total: context.autoTotal,
        startedAt: context.progress.quizStartedAt || now,
        completedAt: now,
      }),
    );
  }
  return nextProgress;
}

function appendCheckpointAttempt(current: ModuleProgress["checkpointAttempts"], attempt: CheckpointAttempt): ModuleProgress["checkpointAttempts"] {
  const currentAttempts = current ? [...current] : [];
  currentAttempts.push(attempt);
  return currentAttempts;
}

function buildCheckpointAttempt(
  context: AnswerContext,
  details: {
    wrongQuestion: number | null;
    weakSpots: ModuleProgress["weakSpots"];
    correct: number;
    total: number;
    startedAt: string;
    completedAt: string;
  },
): CheckpointAttempt {
  const failedQuestionIds = deriveFailedQuestionIds(context, details.wrongQuestion, details.weakSpots);
  return {
    blockId: context.module.id,
    startedAt: details.startedAt,
    completedAt: details.completedAt,
    correct: details.correct,
    total: details.total,
    passed: isPassed(details.correct, details.total),
    failedQuestionIds,
  };
}

function deriveFailedQuestionIds(context: AnswerContext, wrongQuestion: number | null, weakSpots: ModuleProgress["weakSpots"]): string[] {
  const ids = new Set<string>();
  if (wrongQuestion !== null) ids.add(String(wrongQuestion));
  if (weakSpots) {
    for (const key of Object.keys(weakSpots)) ids.add(String(key));
  }
  return Array.from(ids).sort((left, right) => Number(left) - Number(right));
}

function isPassed(correct: number, total: number): boolean {
  if (total < 0) return false;
  if (total === 0) return true;
  return correct / total >= PASS_RATIO;
}

function quizAttemptStatus(isLast: boolean): ModuleProgress["quizAttemptStatus"] {
  return isLast ? "complete" : "in-progress";
}

function quizCompletedAt(context: AnswerContext, now: string): string | undefined {
  return context.isLast ? now : context.progress.quizCompletedAt;
}

function quizStartedAt(context: AnswerContext, now: string): string {
  if ((context.progress.quizAnswered || 0) === 0) return now;
  return context.progress.quizStartedAt || now;
}

export function nextWeakSpotState(context: AnswerContext, isRight: boolean, chosenKey: string): ModuleProgress["weakSpots"] {
  if (isRight) return removeWeakSpot(context.progress.weakSpots, context.question.number);
  return nextWeakSpots(context.progress, context.question, chosenKey, context.module.id);
}

export function removeWeakSpot(weakSpots: ModuleProgress["weakSpots"], questionNumber: number): ModuleProgress["weakSpots"] {
  if (!weakSpots || !Object.prototype.hasOwnProperty.call(weakSpots, String(questionNumber))) return weakSpots;
  const next = { ...weakSpots };
  delete next[questionNumber];
  return next;
}

// eslint-disable-next-line complexity
function nextWeakSpots(progress: ModuleProgress, question: QuizQuestion, chosenKey: string, moduleId: string): ModuleProgress["weakSpots"] {
  const correctOption = question.options.find((option) => String(question.answer) === option.key);
  const chosenOption = question.options.find((option) => option.key === chosenKey);
  return {
    ...(progress.weakSpots || {}),
    [question.number]: {
      questionNumber: question.number,
      text: question.text,
      questionText: question.text,
      shortExplanation: question.explain,
      userLabel: "Слабое место из зачёта",
      reviewStrategy: "Перейти к разбору вопроса и запомнить.",
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

function routeStepFromWeakSpot(answer: FailedCheckpointAnswer): StationStepKey {
  if (answer.sourceBlock === "practice") return "apply";
  return "understand";
}

export interface AnswerContext {
  module: CourseModule;
  question: QuizQuestion;
  progress: ModuleProgress;
  isLast: boolean;
  autoTotal: number;
  appState: AppState;
  saveProgress: StationProps["saveProgress"];
  saveState: StationProps["saveState"];
}

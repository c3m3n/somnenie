import { useRef, useState } from "react";
import { ArrowRight, BookOpen, CheckCircle2, ClipboardCheck, NotebookPen } from "lucide-react";
import { parseQuiz } from "../../domain/quiz";
import { recordSessionActivity, upsertWrongQuestion } from "../../domain/review";
import { QUIZ_PROGRESS_VERSION, type AppState, type CourseModule, type ModuleProgress, type QuizQuestion, type StationStepKey } from "../../domain/types";
import { navigate } from "../route";
import { renderInlineMarkdown, renderMarkdown } from "../markdown";

export function StationView(props: StationProps) {
  return (
    <section className={`screen station-screen station-${props.step}`}>
      <StationHead module={props.module} step={props.step} />
      <StationTabs moduleId={props.module.id} active={props.step} />
      <div className="station-product">{props.step === "check" ? <QuizStep {...props} /> : <LearningStep {...props} />}</div>
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

interface AnswerContext {
  module: CourseModule;
  question: QuizQuestion;
  progress: ModuleProgress;
  isLast: boolean;
  autoTotal: number;
  appState: AppState;
  saveProgress: StationProps["saveProgress"];
  saveState: StationProps["saveState"];
}

function StationHead({ module, step }: { module: CourseModule; step: StationStepKey }) {
  return <header className="station-head"><div className="section-kicker">{module.phaseTitle}</div><h2>{module.id}. {module.title}</h2><p>{stepLabel(step)}</p></header>;
}

function StationTabs({ moduleId, active }: { moduleId: string; active: StationStepKey }) {
  return <nav className="station-tabs" aria-label="Маршрут станции">{steps().map((step) => <button aria-label={step.label} className={active === step.key ? "active" : ""} type="button" key={step.key} onClick={() => navigate({ screen: "station", moduleId, step: step.key })}>{step.icon}<span className="step-full">{step.label}</span><span className="step-short">{step.shortLabel}</span></button>)}</nav>;
}

function LearningStep(props: StationProps) {
  if (props.step === "anchor") return <AnchorStep {...props} />;
  const files = filesForStep(props.step);
  return <div className={`reading-flow reading-flow-${props.step}`}>{files.map((file, index) => <article className={index === 0 ? "markdown-block primary-sheet" : "markdown-block"} key={file} dangerouslySetInnerHTML={{ __html: renderMarkdown(props.module.files[file]) }} />)}<NextStepButton {...props} /></div>;
}

function AnchorStep({ module, progress, saveProgress }: StationProps) {
  const [draft, setDraft] = useState(progress.takeawayDraft ?? progress.takeaway ?? "");
  const saveDraft = (value: string) => {
    setDraft(value);
    void saveProgress(module.id, { takeawayDraft: value });
  };
  return <div className="reading-flow"><article className="markdown-block" dangerouslySetInnerHTML={{ __html: renderMarkdown(module.files["summary.md"]) }} /><label className="journal-editor"><span>Главный вывод станции</span><textarea value={draft} onChange={(event) => saveDraft(event.target.value)} /></label><button className="primary-action" type="button" onClick={() => void commitTakeaway(module.id, draft, saveProgress)}><NotebookPen size={20} />Продолжить</button></div>;
}

function QuizStep({ module, progress, appState, saveProgress, saveState }: StationProps) {
  const questions = parseQuiz(module.files["quiz.md"]);
  return <QuizFlow module={module} progress={progress} questions={questions} appState={appState} saveProgress={saveProgress} saveState={saveState} />;
}

function QuizFlow({ module, progress, questions, appState, saveProgress, saveState }: { module: CourseModule; progress: ModuleProgress; questions: QuizQuestion[]; appState: AppState; saveProgress: StationProps["saveProgress"]; saveState: StationProps["saveState"] }) {
  const answered = progress.quizAnswered || 0;
  const current = questions[answered];
  const autoTotal = questions.filter((question) => question.kind === "auto").length;
  if (!current) return <QuizResult module={module} progress={progress} questions={questions} saveProgress={saveProgress} />;
  return <QuestionCard module={module} question={current} progress={progress} isLast={answered + 1 >= questions.length} autoTotal={autoTotal} appState={appState} saveProgress={saveProgress} saveState={saveState} />;
}

function QuestionCard({ module, question, progress, isLast, autoTotal, appState, saveProgress, saveState }: { module: CourseModule; question: QuizQuestion; progress: ModuleProgress; isLast: boolean; autoTotal: number; appState: AppState; saveProgress: StationProps["saveProgress"]; saveState: StationProps["saveState"] }) {
  return <article className="quiz-card product-question"><div className="section-kicker">Вопрос {question.number}</div><div className="quiz-question" dangerouslySetInnerHTML={{ __html: renderMarkdown(question.text) }} />{question.kind === "application" ? <ApplicationQuestion module={module} question={question} progress={progress} isLast={isLast} saveProgress={saveProgress} /> : <AutoQuestion module={module} question={question} progress={progress} isLast={isLast} autoTotal={autoTotal} appState={appState} saveProgress={saveProgress} saveState={saveState} />}</article>;
}

function AutoQuestion({ module, question, progress, isLast, autoTotal, appState, saveProgress, saveState }: { module: CourseModule; question: QuizQuestion; progress: ModuleProgress; isLast: boolean; autoTotal: number; appState: AppState; saveProgress: StationProps["saveProgress"]; saveState: StationProps["saveState"] }) {
  const [locked, setLocked] = useState(false);
  const lockedRef = useRef(false);
  const choose = (key: string) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    void answerAuto({ module, question, progress, isLast, autoTotal, appState, saveProgress, saveState }, key);
  };
  return <div className="answer-list">{question.options.map((option) => <button type="button" disabled={locked} key={option.key} onClick={() => void choose(option.key)}><span>{option.key}</span><span dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(option.text) }} /></button>)}</div>;
}

function ApplicationQuestion({ module, question, progress, isLast, saveProgress }: { module: CourseModule; question: QuizQuestion; progress: ModuleProgress; isLast: boolean; saveProgress: StationProps["saveProgress"] }) {
  return <div className="application-block"><div dangerouslySetInnerHTML={{ __html: renderMarkdown(question.explain) }} /><button type="button" onClick={() => void recordOpenAnswer(module.id, progress, isLast, saveProgress)}>Понятно</button></div>;
}

function QuizResult({ module, progress, questions, saveProgress }: { module: CourseModule; progress: ModuleProgress; questions: QuizQuestion[]; saveProgress: StationProps["saveProgress"] }) {
  const total = questions.filter((question) => question.kind === "auto").length;
  return <div className="quiz-result"><CheckCircle2 size={32} /><h3>{progress.quizCorrect || 0} / {total}</h3><p>Проверка завершена. Ошибки уже попали в память.</p><button type="button" onClick={() => navigate({ screen: "station", moduleId: module.id, step: "anchor" })}>К выводу станции</button><button type="button" onClick={() => void retryQuiz(module.id, saveProgress)}>Пройти заново</button></div>;
}

async function answerAuto(context: AnswerContext, chosen: string): Promise<void> {
  const isRight = String(context.question.answer) === chosen;
  await context.saveProgress(context.module.id, nextQuizProgress(context, isRight));
  if (!isRight) await saveWrongAnswer(context.module, context.question, context.appState, context.saveState);
}

async function saveWrongAnswer(module: CourseModule, question: QuizQuestion, appState: AppState, saveState: StationProps["saveState"]): Promise<void> {
  const review = upsertWrongQuestion(appState.review, { moduleId: module.id, questionNumber: question.number, questionText: question.text, explanation: question.explain, userLabel: "Ошибка в проверке", reviewStrategy: "Ответить на похожий вопрос после повторения." });
  await saveState({ review, sessions: recordSessionActivity(appState.sessions, { reviews: 1 }) });
}

async function recordOpenAnswer(moduleId: string, progress: ModuleProgress, isLast: boolean, saveProgress: StationProps["saveProgress"]): Promise<void> {
  await saveProgress(moduleId, { quizAnswered: (progress.quizAnswered || 0) + 1, quizAttemptStatus: isLast ? "complete" : "in-progress", quizCompletedAt: isLast ? new Date().toISOString() : progress.quizCompletedAt });
}

async function retryQuiz(moduleId: string, saveProgress: StationProps["saveProgress"]): Promise<void> {
  await saveProgress(moduleId, { quizAnswered: 0, quizCorrect: 0, quizMistakes: 0, quizAttemptStatus: "in-progress", quizStartedAt: new Date().toISOString() });
}

async function commitTakeaway(moduleId: string, draft: string, saveProgress: StationProps["saveProgress"]): Promise<void> {
  const takeaway = draft.trim() || "Вывод сохранен.";
  await saveProgress(moduleId, { theoryRead: true, takeaway, takeawayDraft: "", takeawayUpdatedAt: new Date().toISOString() });
  navigate({ screen: "today" });
}

function nextQuizProgress(context: AnswerContext, isRight: boolean): ModuleProgress {
  const answered = (context.progress.quizAnswered || 0) + 1;
  const correct = (context.progress.quizCorrect || 0) + (isRight ? 1 : 0);
  return {
    quizAttemptStatus: quizAttemptStatus(context.isLast),
    quizAnswered: answered,
    quizCorrect: correct,
    quizMistakes: nextMistakeCount(context.progress, isRight),
    quizCompletedAt: quizCompletedAt(context),
    quizTotalQuestions: answered,
    quizBest: Math.max(context.progress.quizBest || 0, correct),
    quizTotal: context.autoTotal,
    quizVersion: QUIZ_PROGRESS_VERSION,
    weakSpots: nextWeakSpotState(context, isRight),
  };
}

function quizAttemptStatus(isLast: boolean): ModuleProgress["quizAttemptStatus"] {
  return isLast ? "complete" : "in-progress";
}

function nextMistakeCount(progress: ModuleProgress, isRight: boolean): number {
  return (progress.quizMistakes || 0) + (isRight ? 0 : 1);
}

function quizCompletedAt(context: AnswerContext): string | undefined {
  return context.isLast ? new Date().toISOString() : context.progress.quizCompletedAt;
}

function nextWeakSpotState(context: AnswerContext, isRight: boolean): ModuleProgress["weakSpots"] {
  return isRight ? context.progress.weakSpots : nextWeakSpots(context.progress, context.question);
}

function nextWeakSpots(progress: ModuleProgress, question: QuizQuestion): ModuleProgress["weakSpots"] {
  return { ...(progress.weakSpots || {}), [question.number]: { number: question.number, text: question.text, shortExplanation: question.explain, userLabel: "Ошибка в проверке", reviewStrategy: "Ответить на похожий вопрос после повторения.", misses: ((progress.weakSpots || {})[question.number]?.misses || 0) + 1, updatedAt: new Date().toISOString() } };
}

function NextStepButton({ module, step, saveProgress }: StationProps) {
  const next = nextStep(step);
  return <button className="next-inline" type="button" onClick={() => void markAndMove(module.id, step, next, saveProgress)}><ArrowRight size={18} />{next ? stepLabel(next) : "Сегодня"}</button>;
}

async function markAndMove(moduleId: string, step: StationStepKey, next: StationStepKey | null, saveProgress: StationProps["saveProgress"]): Promise<void> {
  if (step === "understand") await saveProgress(moduleId, { theoryRead: true });
  if (next) navigate({ screen: "station", moduleId, step: next });
  else navigate({ screen: "today" });
}

function steps() {
  return [
    { key: "understand" as const, label: "Понять", shortLabel: "Чтение", icon: <BookOpen size={16} /> },
    { key: "apply" as const, label: "Применить", shortLabel: "Задача", icon: <ClipboardCheck size={16} /> },
    { key: "check" as const, label: "Проверить", shortLabel: "Квиз", icon: <CheckCircle2 size={16} /> },
    { key: "anchor" as const, label: "Закрепить", shortLabel: "Вывод", icon: <NotebookPen size={16} /> },
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
  return steps().find((item) => item.key === step)?.label || "Станция";
}

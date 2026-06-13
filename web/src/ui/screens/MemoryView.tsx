import { Brain, CheckCircle2, RotateCcw } from "lucide-react";
import { moduleById } from "../../content/api";
import { parseQuiz } from "../../domain/quiz";
import { applyReviewResult, dueReviewItems, recordSessionActivity } from "../../domain/review";
import type { AppState, CourseBundle, ReviewItem } from "../../domain/types";
import { renderInlineMarkdown } from "../markdown";

export function MemoryView({ bundle, appState, saveState }: { bundle: CourseBundle; appState: AppState; saveState: (patch: Partial<AppState>) => Promise<void> }) {
  const due = dueReviewItems(appState.review, new Date(), 5);
  if (!due.length) return <EmptyMemory />;
  return <section className="screen memory-screen"><div className="section-kicker">Память</div><h2>Короткое повторение</h2><div className="memory-list">{due.map((item) => <MemoryCard key={item.id} item={item} bundle={bundle} appState={appState} saveState={saveState} />)}</div></section>;
}

function MemoryCard({ item, bundle, appState, saveState }: { item: ReviewItem; bundle: CourseBundle; appState: AppState; saveState: (patch: Partial<AppState>) => Promise<void> }) {
  const question = questionForItem(bundle, item);
  return <article className="memory-card"><Brain size={24} /><h3>{item.userLabel || "Слабое место"}</h3><p>{item.shortExplanation || item.text}</p>{question ? <div className="answer-list">{question.options.map((option) => <button type="button" key={option.key} onClick={() => void answer(item, option.key === question.answer, appState, saveState)}><span>{option.key}</span><span dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(option.text) }} /></button>)}</div> : <ConceptButtons item={item} appState={appState} saveState={saveState} />}</article>;
}

function ConceptButtons({ item, appState, saveState }: { item: ReviewItem; appState: AppState; saveState: (patch: Partial<AppState>) => Promise<void> }) {
  return <div className="memory-actions"><button type="button" onClick={() => void answer(item, true, appState, saveState)}><CheckCircle2 size={18} />Помню</button><button type="button" onClick={() => void answer(item, false, appState, saveState)}><RotateCcw size={18} />Повторить завтра</button></div>;
}

function EmptyMemory() {
  return <section className="screen memory-screen"><div className="section-kicker">Память</div><h2>Нет повторений на сегодня</h2><p className="lead">Ошибки из проверки знаний появятся здесь как короткие карточки.</p></section>;
}

async function answer(item: ReviewItem, isRight: boolean, appState: AppState, saveState: (patch: Partial<AppState>) => Promise<void>): Promise<void> {
  const review = applyReviewResult(appState.review, item.id, isRight);
  const sessions = recordSessionActivity(appState.sessions, { reviews: 1 });
  await saveState({ review, sessions });
}

function questionForItem(bundle: CourseBundle, item: ReviewItem) {
  const module = moduleById(bundle, item.moduleId);
  if (!module || !item.questionNumber) return null;
  return parseQuiz(module.files["quiz.md"]).find((question) => question.number === item.questionNumber) || null;
}

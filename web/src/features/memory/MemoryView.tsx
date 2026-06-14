import { useState, type Dispatch, type SetStateAction } from "react";
import { Brain, CheckCircle2, Play, RotateCcw } from "lucide-react";
import { moduleById } from "../../content/api";
import { parseQuiz } from "../../domain/quiz";
import { applyReviewResult, dueReviewItems, DAILY_REVIEW_LIMIT, recordSessionActivity } from "../../domain/review";
import type { AppState, CourseBundle, CourseId, ReviewItem, ReviewState, SessionsState } from "../../domain/types";
import { MdInline } from "../../ui/md";
import { navigate, routeHash } from "../../ui/route";
import { Button, ButtonLink } from "../../ui/components/Button";
import { Kicker } from "../../ui/components/Kicker";
import { Card } from "../../ui/components/Card";
import styles from "./MemoryView.module.css";

export function MemoryView({ bundle, appState, saveState }: { bundle: CourseBundle; appState: AppState; saveState: (patch: Partial<AppState>) => Promise<void> }) {
  const courseId = bundle.courseId;
  const [items] = useState(() => dueReviewItems(appState.review, new Date(), DAILY_REVIEW_LIMIT));
  const [review, setReview] = useState<ReviewState>(appState.review);
  const [sessions, setSessions] = useState<SessionsState>(appState.sessions);
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [feedback, setFeedback] = useState<"right" | "wrong" | null>(null);

  if (!items.length) return <EmptyTrainer />;
  if (!started) return <TrainerIntro items={items} onStart={() => setStarted(true)} />;
  if (index >= items.length) return <TrainerResult results={results} total={items.length} courseId={courseId} />;

  const item = items[index];
  return (
    <section className={styles.screen}>
      <Kicker>Тренировка</Kicker>
      <h2 className={styles.title}>Вопрос {index + 1} из {items.length}</h2>
      {feedback ? (
        <TrainerFeedback
          feedback={feedback}
          isLast={index + 1 >= items.length}
          onNext={() => {
            setFeedback(null);
            setIndex(index + 1);
          }}
        />
      ) : (
        <TrainerCard
          item={item}
          bundle={bundle}
          onAnswer={(isRight) => void answer(item, isRight, { review, sessions, saveState, setReview, setSessions, setResults, setFeedback })}
        />
      )}
    </section>
  );
}

function TrainerIntro({ items, onStart }: { items: ReviewItem[]; onStart: () => void }) {
  return (
    <section className={styles.screen}>
      <Kicker>Тренажёр</Kicker>
      <h2 className={styles.title}>{trainerTitle(items.length)}</h2>
      <p className={styles.lead}>Это короткая тренировка на 3-5 минут.</p>
      <Button variant="primary" size="large" onClick={onStart}>
        <Play size={18} />
        Начать тренировку
      </Button>
      <ul className={styles.spotList}>
        {items.map((item) => <li key={item.id}>{item.userLabel || item.shortExplanation || item.text}</li>)}
      </ul>
    </section>
  );
}

function TrainerCard({ item, bundle, onAnswer }: { item: ReviewItem; bundle: CourseBundle; onAnswer: (isRight: boolean) => void }) {
  const question = questionForItem(bundle, item);
  return (
    <Card className={styles.card} flat>
      <Brain size={24} className={styles.cardIcon} />
      <h3>{item.userLabel || "Слабое место"}</h3>
      {question ? (
        <>
          <MdInline as="div" className={styles.question}>{question.text}</MdInline>
          <div className={styles.answerList}>
            {question.options.map((option) => (
              <button type="button" key={option.key} className={styles.answerButton} onClick={() => onAnswer(String(option.key) === String(question.answer))}>
                <span>{option.key}</span>
                <MdInline>{option.text}</MdInline>
              </button>
            ))}
          </div>
        </>
      ) : (
        <ConceptTrainer item={item} onAnswer={onAnswer} />
      )}
    </Card>
  );
}

function ConceptTrainer({ item, onAnswer }: { item: ReviewItem; onAnswer: (isRight: boolean) => void }) {
  return (
    <>
      <p className={styles.prompt}>Объясните себе:</p>
      <p>{item.shortExplanation || item.text}</p>
      <div className={styles.selfCheckActions}>
        <Button variant="secondary" onClick={() => onAnswer(true)}><CheckCircle2 size={18} />Помню</Button>
        <Button variant="secondary" onClick={() => onAnswer(false)}><RotateCcw size={18} />Не помню</Button>
      </div>
    </>
  );
}

function TrainerFeedback({ feedback, isLast, onNext }: { feedback: "right" | "wrong"; isLast: boolean; onNext: () => void }) {
  const isRight = feedback === "right";
  const feedbackClass = isRight ? styles.feedbackRight : styles.feedbackWrong;
  return (
    <Card className={styles.card} flat role="status">
      <h3>{isRight ? "Верно" : "Пока не закрепилось"}</h3>
      <p className={[styles.feedback, feedbackClass].filter(Boolean).join(" ")}>{isRight ? "Вернём этот вопрос позже, чтобы закрепить." : "Вопрос вернётся завтра."}</p>
      <Button variant="primary" onClick={onNext}>{isLast ? "Завершить тренировку" : "Следующий вопрос"}</Button>
    </Card>
  );
}

function TrainerResult({ results, total, courseId }: { results: boolean[]; total: number; courseId: CourseId }) {
  const closed = results.filter(Boolean).length;
  const returned = total - closed;
  return (
    <section className={styles.screen}>
      <Kicker>Тренажёр</Kicker>
      <h2 className={styles.title}>Тренировка завершена</h2>
      <div className={styles.resultLines}>
        <p>Закрыто: {closed} из {total}</p>
        <p>Вернётся позже: {returned} {weakSpotNoun(returned)}</p>
      </div>
      <ButtonLink variant="primary" href={routeHash({ screen: "today", courseId })} onClick={(event) => {
        event.preventDefault();
        navigate({ screen: "today", courseId });
      }}>
        Вернуться к учёбе
      </ButtonLink>
    </section>
  );
}

function EmptyTrainer() {
  return (
    <section className={styles.screen}>
      <Kicker>Тренажёр</Kicker>
      <h2 className={styles.title}>Пока всё чисто.</h2>
      <p className={styles.lead}>Слабые места появятся после зачётов.</p>
      <p className={styles.lead}>Продолжайте маршрут — тренажёр подключится, когда появятся слабые места.</p>
    </section>
  );
}

async function answer(item: ReviewItem, isRight: boolean, context: AnswerContext): Promise<void> {
  const review = applyReviewResult(context.review, item.id, isRight);
  const sessions = recordSessionActivity(context.sessions, { reviews: 1 });
  context.setReview(review);
  context.setSessions(sessions);
  context.setResults((current) => [...current, isRight]);
  context.setFeedback(isRight ? "right" : "wrong");
  await context.saveState({ review, sessions });
}

function questionForItem(bundle: CourseBundle, item: ReviewItem) {
  const module = moduleById(bundle, item.moduleId);
  if (!module || !item.questionNumber) return null;
  return parseQuiz(module.files["quiz.md"], `${module.id}:review`).find((question) => question.number === item.questionNumber) || null;
}

function weakSpotPlural(count: number): string {
  return count === 1 ? "слабое место" : count >= 2 && count <= 4 ? "слабых места" : "слабых мест";
}

function trainerTitle(count: number): string {
  return `${count} ${weakSpotPlural(count)} ${count === 1 ? "готово" : "готовы"} к работе`;
}

function weakSpotNoun(count: number): string {
  return count === 1 ? "слабое место" : "слабых мест";
}

interface AnswerContext {
  review: ReviewState;
  sessions: SessionsState;
  saveState: (patch: Partial<AppState>) => Promise<void>;
  setReview: (review: ReviewState) => void;
  setSessions: (sessions: SessionsState) => void;
  setResults: Dispatch<SetStateAction<boolean[]>>;
  setFeedback: (feedback: "right" | "wrong") => void;
}

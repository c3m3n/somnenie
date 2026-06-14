import { Brain, Play, ScrollText } from "lucide-react";
import { pluralize } from "../../shared/utils/pluralize";
import { completedCount } from "../../domain/today";
import { toISODate } from "../../domain/date";
import type { CourseBundle, CourseModule, ModuleProgress, ProgressMap, SessionsState, TodayAction } from "../../domain/types";
import { navigate } from "../../ui/route";

export function TodayView({ bundle, progress, action, lastSessionDate, sessions }: { bundle: CourseBundle; progress: ProgressMap; action: TodayAction; lastSessionDate?: string | null; sessions?: SessionsState }) {
  const screen = buildLearningScreenCopy(action, bundle, progress);
  const streakLine = buildStreakLine(sessions);
  return (
    <section className="screen today-screen">
      <h2>{screen.title}</h2>
      <article className="learning-dispatcher-card">
        <div>
          <strong>{screen.cardTitle}</strong>
          <p>{screen.description}</p>
          {screen.context ? <span>{screen.context}</span> : null}
        </div>
      </article>
      <button className="primary-action" type="button" onClick={() => runAction(action)}>
        {iconFor(action.kind)}<span>{screen.primaryCta}</span>
      </button>
      <p className="after-action"><strong>После этого:</strong> {screen.afterAction}</p>
      <div className="progress-strip">
        <span>{screen.progressLabel}</span>
        <progress max={bundle.modules.length} value={screen.completed} aria-label="Прогресс маршрута" />
      </div>
      {streakLine ? <p className="streak-line">{streakLine}</p> : null}
      {lastSessionDate ? <p className="last-session">Последний раз: {lastSessionLabel(lastSessionDate)}</p> : null}
      <p className="safety-note">Курс не заменяет врача, диагностику, лечение или индивидуальные рекомендации по питанию.</p>
    </section>
  );
}

function buildStreakLine(sessions?: SessionsState): string | null {
  if (!sessions || sessions.streakDays <= 0) return null;
  if (sessions.bestStreakDays > sessions.streakDays) {
    return `Серия: ${sessions.streakDays} ${pluralize(sessions.streakDays, "день", "дня", "дней")} (лучшая: ${sessions.bestStreakDays})`;
  }
  return `Серия: ${sessions.streakDays} ${pluralize(sessions.streakDays, "день", "дня", "дней")}`;
}

function runAction(action: TodayAction): void {
  if (action.kind === "review") navigate({ screen: "memory" });
  else if (action.kind === "journal") navigate({ screen: "journal" });
  else if (action.kind === "remediation" && action.moduleId) navigate({ screen: "remediation", moduleId: action.moduleId });
  else if (action.kind === "station" && action.moduleId) navigate({ screen: "station", moduleId: action.moduleId, step: action.step || "understand" });
  else navigate({ screen: "today" });
}

function iconFor(kind: TodayAction["kind"]) {
  if (kind === "review") return <Brain size={20} />;
  if (kind === "journal") return <ScrollText size={20} />;
  if (kind === "remediation") return <ScrollText size={20} />;
  return <Play size={20} />;
}

type LearningScreenState = "start" | "continue_block" | "checkpoint_ready" | "checkpoint_failed" | "training" | "course_complete";

interface LearningScreenCopy {
  state: LearningScreenState;
  title: string;
  cardTitle: string;
  description: string;
  context?: string;
  primaryCta: string;
  afterAction: string;
  progressLabel: string;
  completed: number;
}

function buildLearningScreenCopy(action: TodayAction, bundle: CourseBundle, progress: ProgressMap): LearningScreenCopy {
  const completed = completedCount(bundle.modules, progress);
  const module = findModule(bundle, action.moduleId);
  const progressLabel = `Маршрут: ${completed} из ${bundle.modules.length} блоков завершено`;
  const base = { bundle, completed, module, progress, progressLabel };

  switch (action.kind) {
    case "remediation":
      return module ? checkpointFailedCopy(base) : fallbackStartCopy(base, action);
    case "review":
      return trainingCopy(base, action.reviewItems?.length || 0);
    case "journal":
      return courseCompleteCopy(base);
    case "station":
      return stationCopy(base, action);
  }
}

function findModule(bundle: CourseBundle, moduleId?: string): CourseModule | null {
  if (!moduleId) return null;
  return bundle.modules.find((item) => item.id === moduleId) ?? null;
}

interface LearningScreenBase {
  bundle: CourseBundle;
  completed: number;
  module: CourseModule | null;
  progress: ProgressMap;
  progressLabel: string;
}

function checkpointFailedCopy(base: LearningScreenBase): LearningScreenCopy {
  const module = base.module as CourseModule;
  return {
    ...base,
    state: "checkpoint_failed",
    title: "Пока закрыто",
    cardTitle: `Зачёт блока ${module.id} не сдан`,
    description: "Следующий блок откроется после разбора ошибок.",
    context: moduleLine(module),
    primaryCta: "Разобрать ошибки",
    afterAction: "можно будет пройти зачёт ещё раз.",
  };
}

function trainingCopy(base: LearningScreenBase, count: number): LearningScreenCopy {
  return {
    ...base,
    state: "training",
    title: "Тренировка на сегодня",
    cardTitle: weakSpotLine(count),
    description: "Закрепите то, что просело после зачётов или прошлых тренировок.",
    primaryCta: "Начать тренировку",
    afterAction: "можно продолжить маршрут.",
  };
}

function courseCompleteCopy(base: LearningScreenBase): LearningScreenCopy {
  return {
    ...base,
    state: "course_complete",
    title: "Маршрут завершён",
    cardTitle: "Все блоки закрыты",
    description: "Можно открыть конспект или потренировать слабые места.",
    primaryCta: "Открыть конспект",
    afterAction: "вы вернётесь к собранной сути и прогрессу.",
  };
}

function checkpointReadyCopy(base: LearningScreenBase): LearningScreenCopy {
  const module = base.module as CourseModule;
  return {
    ...base,
    state: "checkpoint_ready",
    title: "Пора на зачёт",
    cardTitle: `Блок ${module.id} прочитан`,
    description: "Чтобы открыть следующий блок, нужно подтвердить понимание.",
    context: moduleLine(module),
    primaryCta: "Пройти зачёт",
    afterAction: "если зачёт сдан, откроется следующий блок.",
  };
}

function blockCopy(base: LearningScreenBase): LearningScreenCopy {
  const module = base.module as CourseModule;
  if (isFirstStart(module, base.bundle.modules, base.progress)) return firstStartCopy(base, module);
  return continueBlockCopy(base, module);
}

function stationCopy(base: LearningScreenBase, action: TodayAction): LearningScreenCopy {
  if (!base.module) return fallbackStartCopy(base, action);
  if (action.step === "check") return checkpointReadyCopy(base);
  return blockCopy(base);
}

function firstStartCopy(base: LearningScreenBase, module: CourseModule): LearningScreenCopy {
  return {
    ...base,
    state: "start",
    title: "Начните маршрут",
    cardTitle: base.bundle.course.title,
    description: `Первый блок: ${module.id} · ${module.title}`,
    primaryCta: "Начать первый блок",
    afterAction: "пройдёте блок и откроете зачёт.",
  };
}

function continueBlockCopy(base: LearningScreenBase, module: CourseModule): LearningScreenCopy {
  const started = Boolean(base.progress[module.id]);
  return {
    ...base,
    state: "continue_block",
    title: started ? "Продолжить блок" : "Начать блок",
    cardTitle: moduleLine(module),
    description: started ? "Вы уже начали этот блок." : "Это следующий доступный блок маршрута.",
    context: started ? readerContextLine(base.progress[module.id]) : undefined,
    primaryCta: started ? "Продолжить" : "Начать блок",
    afterAction: "дойдёте до зачёта блока.",
  };
}

function fallbackStartCopy(base: LearningScreenBase, action: TodayAction): LearningScreenCopy {
  return {
    ...base,
    state: "start",
    title: "Начните маршрут",
    cardTitle: base.bundle.course.title,
    description: normalizeCopy(action.reason),
    primaryCta: normalizeCopy(action.label),
    afterAction: "пройдёте блок и откроете зачёт.",
  };
}

function moduleLine(module: CourseModule): string {
  return `${module.id} · ${module.title}`;
}

function isFirstStart(module: CourseModule, modules: CourseModule[], progress: ProgressMap): boolean {
  return module.id === modules[0]?.id && Object.keys(progress).length === 0;
}

function weakSpotLine(count: number): string {
  if (!count) return "Слабые места готовы к работе";
  return `${count} ${pluralize(count, "слабое место готово", "слабых места готовы", "слабых мест готовы")} к работе`;
}


const READER_PAGE_LABELS = ["Теория", "Термины", "Применение", "Схемы", "Суть"] as const;
const READER_PAGE_COUNT = READER_PAGE_LABELS.length;

function readerContextLine(progress: ModuleProgress | undefined): string | undefined {
  if (!progress) return undefined;
  const idx = Math.min(Math.max(0, progress.readerPageIndex ?? 0), READER_PAGE_COUNT - 1);
  const label = READER_PAGE_LABELS[idx];
  const pagesLeft = READER_PAGE_COUNT - idx;
  const tail = idx === READER_PAGE_COUNT - 1
    ? "последняя страница"
    : `ещё ${pagesLeft} ${pluralize(pagesLeft, "страница", "страницы", "страниц")}`;
  return `${label} · ${idx + 1} / ${READER_PAGE_COUNT} · ${tail}`;
}

function lastSessionLabel(dateStr: string): string {
  const today = toISODate();
  const yesterday = toISODate(new Date(Date.now() - 86400000));
  if (dateStr === today) return "сегодня";
  if (dateStr === yesterday) return "вчера";
  const diff = Math.round((Date.now() - new Date(dateStr).getTime()) / 86400000);
  return `${diff} ${pluralize(diff, "день", "дня", "дней")} назад`;
}

function normalizeCopy(value: string): string {
  return value
    .replaceAll("Контрольная", "Зачёт")
    .replaceAll("контрольная", "зачёт")
    .replaceAll("контрольную", "зачёт")
    .replaceAll("проверку", "зачёт")
    .replaceAll("повторение", "тренировку");
}

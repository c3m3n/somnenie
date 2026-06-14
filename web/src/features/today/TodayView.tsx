import { Brain, Play, ScrollText } from "lucide-react";
import { pluralize } from "../../shared/utils/pluralize";
import { completedCount } from "../../domain/today";
import { toISODate } from "../../domain/date";
import type { CourseBundle, CourseId, CourseModule, ModuleFileName, ModuleProgress, ProgressMap, SessionsState, TodayAction } from "../../domain/types";
import { readerFilesFromManifest } from "../../content/api";
import { navigate } from "../../ui/route";
import { Button } from "../../ui/components/Button";
import { Kicker } from "../../ui/components/Kicker";
import { ProgressBar } from "../../ui/components/ProgressBar";
import { SafetyNote } from "../../ui/components/SafetyNote";
import styles from "./TodayView.module.css";

export function TodayView({ bundle, progress, action, lastSessionDate, sessions }: { bundle: CourseBundle; progress: ProgressMap; action: TodayAction; lastSessionDate?: string | null; sessions?: SessionsState }) {
  const courseId = bundle.courseId;
  const screen = buildLearningScreenCopy(action, bundle, progress);
  const streakLine = buildStreakLine(sessions);
  return (
    <section className={styles.screen} data-state={screen.state}>
      <article className={styles.sessionCard} aria-labelledby="today-heading">
        <Kicker className={styles.kicker}>{screen.kicker}</Kicker>
        <h2 id="today-heading" className={styles.title}>{screen.title}</h2>
        {screen.context ? <p className={styles.contextLine}>{screen.context}</p> : null}

        <ol className={styles.actionGrid} aria-label="Режимы сессии">
          {sessionTiles(screen.activeTile).map((tile) => (
            <li key={tile.number} className={[styles.actionTile, tile.active ? styles.actionTileActive : ""].filter(Boolean).join(" ")} aria-current={tile.active ? "step" : undefined}>
              <span>{tile.number}</span>
              <strong>{tile.label}</strong>
            </li>
          ))}
        </ol>

        <div className={styles.timeBox}>
          <strong>{screen.minutes} минут</strong>
          <p>{screen.description}</p>
        </div>

        <Button variant="primary" size="large" className={styles.cta} onClick={() => runAction(action, courseId)}>
          {iconFor(action.kind)}<span>{screen.primaryCta}</span>
        </Button>
      </article>

      <div className={styles.statusGrid}>
        <p className={styles.afterAction}><strong>После этого</strong><span>{screen.afterAction}</span></p>
        <div className={styles.progress}>
          <span>{screen.progressLabel}</span>
          <ProgressBar max={bundle.modules.length} value={screen.completed} label="Прогресс маршрута" />
        </div>
        {streakLine ? <p className={styles.streak}>{streakLine}</p> : null}
        {lastSessionDate ? <p className={styles.lastSession}>Последний раз: {lastSessionLabel(lastSessionDate)}</p> : null}
      </div>
      <SafetyNote>
        Курс не заменяет профессиональную консультацию или индивидуальные рекомендации.
      </SafetyNote>
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

function runAction(action: TodayAction, courseId: CourseId): void {
  if (action.kind === "review") navigate({ screen: "memory", courseId });
  else if (action.kind === "journal") navigate({ screen: "journal", courseId });
  else if (action.kind === "remediation" && action.moduleId) navigate({ screen: "remediation", courseId, moduleId: action.moduleId });
  else if (action.kind === "station" && action.moduleId) navigate({ screen: "station", courseId, moduleId: action.moduleId, step: action.step || "understand" });
  else navigate({ screen: "today", courseId });
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
  activeTile: number;
  kicker: string;
  minutes: number;
}

function buildLearningScreenCopy(action: TodayAction, bundle: CourseBundle, progress: ProgressMap): LearningScreenCopy {
  const completed = completedCount(bundle.modules, progress);
  const module = findModule(bundle, action.moduleId);
  const progressLabel = `Маршрут: ${completed} из ${bundle.modules.length} блоков завершено`;
  const base = { bundle, completed, module, progress, progressLabel, action };

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
  action: TodayAction;
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
    activeTile: 3,
    kicker: kickerLine(module),
    minutes: 8,
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
    activeTile: 3,
    kicker: "Сегодня / тренажёр",
    minutes: 5,
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
    activeTile: 4,
    kicker: "Сегодня / итог",
    minutes: 4,
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
    activeTile: 3,
    kicker: kickerLine(module),
    minutes: 10,
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
    activeTile: 1,
    kicker: kickerLine(module),
    minutes: 12,
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
    context: started ? readerContextLine(base.bundle, base.progress[module.id]) : undefined,
    primaryCta: started ? "Продолжить" : "Начать блок",
    afterAction: "дойдёте до зачёта блока.",
    activeTile: activeTileForAction(base.action),
    kicker: kickerLine(module),
    minutes: 12,
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
    activeTile: activeTileForAction(action),
    kicker: "Сегодня / маршрут",
    minutes: 12,
  };
}

function moduleLine(module: CourseModule): string {
  return `${module.id} · ${module.title}`;
}

function kickerLine(module: CourseModule): string {
  return `Сегодня / ${module.id}`;
}

function activeTileForAction(action: TodayAction): number {
  if (action.kind === "remediation" || action.kind === "review") return 3;
  if (action.kind === "journal") return 4;
  if (action.step === "apply") return 2;
  if (action.step === "check") return 3;
  if (action.step === "anchor") return 4;
  return 1;
}

function sessionTiles(activeTile: number) {
  return [
    { number: "01", label: "Идея", active: activeTile === 1 },
    { number: "02", label: "Действие", active: activeTile === 2 },
    { number: "03", label: "Зачёт", active: activeTile === 3 },
    { number: "04", label: "Вывод", active: activeTile === 4 },
  ];
}

function isFirstStart(module: CourseModule, modules: CourseModule[], progress: ProgressMap): boolean {
  return module.id === modules[0]?.id && Object.keys(progress).length === 0;
}

function weakSpotLine(count: number): string {
  if (!count) return "Слабые места готовы к работе";
  return `${count} ${pluralize(count, "слабое место готово", "слабых места готовы", "слабых мест готовы")} к работе`;
}


const DEFAULT_READER_LABELS: Record<ModuleFileName, string> = {
  "theory.md": "Теория",
  "terms.md": "Термины",
  "practice.md": "Применение",
  "diagrams.md": "Схемы",
  "summary.md": "Суть",
  "reading.md": "Чтение",
  "video-notes.md": "Конспект видео",
  "lab.md": "Лабораторная",
};

function readerContextLine(bundle: CourseBundle, progress: ModuleProgress | undefined): string | undefined {
  if (!progress) return undefined;
  const readerFiles = readerFilesFromManifest(bundle.manifest);
  const pageCount = readerFiles.length;
  if (!pageCount) return undefined;
  const idx = Math.min(Math.max(0, progress.readerPageIndex ?? 0), pageCount - 1);
  const file = readerFiles[idx];
  const label = DEFAULT_READER_LABELS[file] || file;
  const pagesLeft = pageCount - idx;
  const tail = idx === pageCount - 1
    ? "последняя страница"
    : `ещё ${pagesLeft} ${pluralize(pagesLeft, "страница", "страницы", "страниц")}`;
  return `${label} · ${idx + 1} / ${pageCount} · ${tail}`;
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

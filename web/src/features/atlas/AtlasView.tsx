import { CheckCircle2, Circle, LockKeyhole, RotateCcw } from "lucide-react";
import { getCourseBlockViewModels, type CourseBlockViewModel } from "../../domain/learningPath";
import type { CourseBundle, CourseId, CourseModule, ProgressMap, StationStepKey } from "../../domain/types";
import { navigate } from "../../ui/route";
import { Kicker } from "../../ui/components/Kicker";
import styles from "./AtlasView.module.css";

const stateVariant: Record<CourseBlockViewModel["state"], string> = {
  available: styles.available,
  in_progress: styles.inProgress,
  checkpoint_ready: styles.checkpointReady,
  checkpoint_failed: styles.checkpointFailed,
  checkpoint_passed: styles.checkpointPassed,
  course_complete: styles.checkpointPassed,
  locked: styles.locked,
};

export function AtlasView({ bundle, progress }: { bundle: CourseBundle; progress: ProgressMap }) {
  const courseId = bundle.courseId;
  const ordered = getCourseBlockViewModels(bundle.modules, progress);
  const viewModels = new Map(ordered.map((viewModel) => [viewModel.id, viewModel]));
  const currentIndex = currentBlockIndex(ordered);

  return (
    <section className={styles.screen}>
      <Kicker>Маршрут</Kicker>
      <h2 className={styles.title}>{bundle.course.title}</h2>
      <div className={styles.phaseList}>
        {bundle.course.phases.map((phase) => (
          <section className={styles.phaseBand} key={phase.id}>
            <h3 className={styles.phaseTitle}>{phase.title}</h3>
            {phase.subtitle ? <p className={styles.phaseSubtitle}>{phase.subtitle}</p> : null}
            <div className={styles.moduleGrid}>
              {modulesForPhase(bundle, phase.id).map((module) => (
                <ModuleButton
                  key={module.id}
                  module={module}
                  isCurrent={moduleIndex(ordered, module.id) === currentIndex}
                  viewModel={viewModels.get(module.id)}
                  courseId={courseId}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

function ModuleButton({
  module,
  isCurrent,
  viewModel,
  courseId,
}: { module: CourseModule; isCurrent: boolean; viewModel?: CourseBlockViewModel; courseId: CourseId }) {
  const view = viewModel || fallbackViewModel(module);
  const isLocked = view.state === "locked";
  const status = statusText(view);
  const reason = isLocked ? lockReason(view, module.id) : null;
  const routeStep = stepFor(view);
  const tileClasses = [
    styles.moduleTile,
    stateVariant[view.state],
    isCurrent ? styles.current : "",
  ].filter(Boolean).join(" ");

  return (
    <button
      className={tileClasses}
      type="button"
      onClick={() => navigate({ screen: "station", courseId, moduleId: module.id, step: routeStep })}
      aria-label={`Блок ${module.id} ${module.title} ${status}`}
    >
      <div className={styles.tileHeader}>
        {iconFor(view)}
        <span className={styles.moduleId}>{module.id}</span>
        {isCurrent ? <span className={styles.currentLabel}>Текущий</span> : null}
      </div>
      <strong className={styles.moduleTitle}>{module.title}</strong>
      <span className={styles.moduleStatus}>{status}</span>
      {reason ? <span className={styles.lockedReason}>{reason}</span> : null}
    </button>
  );
}

function modulesForPhase(bundle: CourseBundle, phaseId: string): CourseModule[] {
  return bundle.modules.filter((module) => module.phaseId === phaseId);
}

function moduleIndex(models: CourseBlockViewModel[], moduleId: string): number {
  return models.findIndex((item) => item.id === moduleId);
}

function currentBlockIndex(viewModels: CourseBlockViewModel[]): number {
  const firstNotPassed = viewModels.findIndex((item) => item.state !== "checkpoint_passed");
  if (firstNotPassed >= 0) return firstNotPassed;
  return Math.max(0, viewModels.length - 1);
}

function fallbackViewModel(module: CourseModule): CourseBlockViewModel {
  return {
    id: module.id,
    title: module.title,
    state: "available",
    progressLabel: "Доступен",
    canOpen: true,
    reason: null,
    requiredBlockId: null,
  };
}

function stepFor(viewModel: CourseBlockViewModel): StationStepKey {
  return viewModel.state === "checkpoint_failed" || viewModel.state === "checkpoint_ready" ? "check" : "understand";
}

function iconFor(viewModel: CourseBlockViewModel) {
  if (viewModel.state === "locked") return <LockKeyhole size={18} />;
  if (viewModel.state === "checkpoint_passed" || viewModel.state === "course_complete") return <CheckCircle2 size={18} />;
  if (viewModel.state === "checkpoint_failed") return <RotateCcw size={18} />;
  return <Circle size={18} />;
}

function statusText(viewModel: CourseBlockViewModel): string {
  if (viewModel.state === "checkpoint_passed" || viewModel.state === "course_complete") return "Зачёт сдан";
  if (viewModel.state === "checkpoint_failed") return "Зачёт не сдан";
  if (viewModel.state === "checkpoint_ready") return "Нужен зачёт";
  if (viewModel.state === "in_progress") return "В процессе";
  if (viewModel.state === "locked") return "Закрыт";
  return "Доступен";
}

function lockReason(viewModel: CourseBlockViewModel, fallbackId: string): string {
  if (viewModel.requiredBlockId) return `Откроется после зачёта ${viewModel.requiredBlockId}`;
  return `Откроется после блока ${fallbackId}`;
}

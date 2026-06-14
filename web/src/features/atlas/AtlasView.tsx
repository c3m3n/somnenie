import { CheckCircle2, Circle, LockKeyhole, RotateCcw } from "lucide-react";
import { getCourseBlockViewModels, type CourseBlockViewModel } from "../../domain/learningPath";
import type { CourseBundle, CourseModule, ProgressMap, StationStepKey } from "../../domain/types";
import { navigate } from "../../ui/route";

export function AtlasView({ bundle, progress }: { bundle: CourseBundle; progress: ProgressMap }) {
  const ordered = getCourseBlockViewModels(bundle.modules, progress);
  const viewModels = new Map(ordered.map((viewModel) => [viewModel.id, viewModel]));
  const currentIndex = currentBlockIndex(ordered);

  return (
    <section className="screen atlas-screen">
      <div className="section-kicker">Маршрут</div>
      <h2>{bundle.course.title}</h2>
      <div className="phase-list">
        {bundle.course.phases.map((phase) => (
          <section className="phase-band" key={phase.id}>
            <h3>{phase.title}</h3>
            {phase.subtitle ? <p>{phase.subtitle}</p> : null}
            <div className="module-grid">
              {modulesForPhase(bundle, phase.id).map((module) => (
                <ModuleButton
                  key={module.id}
                  module={module}
                  isCurrent={moduleIndex(ordered, module.id) === currentIndex}
                  viewModel={viewModels.get(module.id)}
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
}: { module: CourseModule; isCurrent: boolean; viewModel?: CourseBlockViewModel }) {
  const view = viewModel || fallbackViewModel(module);
  const isLocked = view.state === "locked";
  const status = statusText(view);
  const reason = isLocked ? lockReason(view, module.id) : null;
  const routeStep = stepFor(view);

  return (
    <button
      className={`module-tile module-tile-${view.state} ${isCurrent ? "module-tile-current" : ""}`}
      type="button"
      onClick={() => navigate({ screen: "station", moduleId: module.id, step: routeStep })}
      aria-label={`Блок ${module.id} ${module.title} ${status}`}
    >
      {iconFor(view)}
      <div>
        <span className="section-kicker">{module.id}</span>
        {isCurrent ? <small className="module-current-label">Текущий блок</small> : null}
      </div>
      <strong>{module.title}</strong>
      <small className="module-status">{status}</small>
      {reason ? <small className="module-locked-reason">{reason}</small> : null}
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
  if (viewModel.state === "checkpoint_passed") return <CheckCircle2 size={18} />;
  if (viewModel.state === "checkpoint_failed") return <RotateCcw size={18} />;
  return <Circle size={18} />;
}

function statusText(viewModel: CourseBlockViewModel): string {
  if (viewModel.state === "checkpoint_passed") return "Зачёт сдан";
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

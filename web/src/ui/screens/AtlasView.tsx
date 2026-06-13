import { CheckCircle2, Circle, LockKeyhole, RotateCcw } from "lucide-react";
import { getCourseBlockViewModels, type CourseBlockViewModel } from "../../domain/learningPath";
import { quizScoreLabel } from "../../domain/today";
import type { CourseBundle, CourseModule, ProgressMap, StationStepKey } from "../../domain/types";
import { navigate } from "../route";

export function AtlasView({ bundle, progress }: { bundle: CourseBundle; progress: ProgressMap }) {
  const viewModels = new Map(getCourseBlockViewModels(bundle.modules, progress).map((viewModel) => [viewModel.id, viewModel]));
  return (
    <section className="screen atlas-screen">
      <div className="section-kicker">Атлас</div>
      <h2>{bundle.course.title}</h2>
      <div className="phase-list">{bundle.course.phases.map((phase) => <section className="phase-band" key={phase.id}><h3>{phase.title}</h3><p>{phase.subtitle}</p><div className="module-grid">{modulesForPhase(bundle, phase.id).map((module) => <ModuleButton key={module.id} module={module} progress={progress[module.id]} viewModel={viewModels.get(module.id)} />)}</div></section>)}</div>
    </section>
  );
}

function ModuleButton({ module, progress, viewModel }: { module: CourseModule; progress: ProgressMap[string]; viewModel?: CourseBlockViewModel }) {
  const view = viewModel || fallbackViewModel(module);
  return (
    <button className={`module-tile module-tile-${view.state}`} type="button" onClick={() => navigate({ screen: "station", moduleId: module.id, step: stepFor(view) })}>
      {iconFor(view)}
      <span>{module.id}</span>
      <strong>{module.title}</strong>
      <small>{statusText(view, progress)}</small>
    </button>
  );
}

function modulesForPhase(bundle: CourseBundle, phaseId: string): CourseModule[] {
  return bundle.modules.filter((module) => module.phaseId === phaseId);
}

function fallbackViewModel(module: CourseModule): CourseBlockViewModel {
  return { id: module.id, title: module.title, state: "available", progressLabel: "Можно начать", canOpen: true, reason: null, requiredBlockId: null };
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

function statusText(viewModel: CourseBlockViewModel, progress: ProgressMap[string]): string {
  if (viewModel.state === "locked") return viewModel.progressLabel;
  if (viewModel.state === "checkpoint_passed" || viewModel.state === "checkpoint_failed") return `${viewModel.progressLabel}: ${quizScoreLabel(progress)}`;
  return viewModel.progressLabel;
}

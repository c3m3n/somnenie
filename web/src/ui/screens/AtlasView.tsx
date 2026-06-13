import { CheckCircle2, Circle, RotateCcw } from "lucide-react";
import { isModuleComplete, quizScoreLabel } from "../../domain/today";
import type { CourseBundle, CourseModule, ProgressMap } from "../../domain/types";
import { navigate } from "../route";

export function AtlasView({ bundle, progress }: { bundle: CourseBundle; progress: ProgressMap }) {
  return (
    <section className="screen atlas-screen">
      <div className="section-kicker">Атлас</div>
      <h2>{bundle.course.title}</h2>
      <div className="phase-list">{bundle.course.phases.map((phase) => <section className="phase-band" key={phase.id}><h3>{phase.title}</h3><p>{phase.subtitle}</p><div className="module-grid">{modulesForPhase(bundle, phase.id).map((module) => <ModuleButton key={module.id} module={module} progress={progress[module.id]} />)}</div></section>)}</div>
    </section>
  );
}

function ModuleButton({ module, progress }: { module: CourseModule; progress: ProgressMap[string] }) {
  const complete = isModuleComplete(progress);
  const review = Object.keys(progress?.weakSpots || {}).length > 0;
  return (
    <button className="module-tile" type="button" onClick={() => navigate({ screen: "station", moduleId: module.id, step: "understand" })}>
      {complete ? <CheckCircle2 size={18} /> : review ? <RotateCcw size={18} /> : <Circle size={18} />}
      <span>{module.id}</span>
      <strong>{module.title}</strong>
      <small>результат: {quizScoreLabel(progress)}</small>
    </button>
  );
}

function modulesForPhase(bundle: CourseBundle, phaseId: string): CourseModule[] {
  return bundle.modules.filter((module) => module.phaseId === phaseId);
}

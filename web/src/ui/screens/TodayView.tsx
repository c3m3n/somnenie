import { Brain, Play, ScrollText } from "lucide-react";
import { completedCount } from "../../domain/today";
import type { CourseBundle, ProgressMap, TodayAction } from "../../domain/types";
import { navigate } from "../route";

export function TodayView({ bundle, progress, action }: { bundle: CourseBundle; progress: ProgressMap; action: TodayAction }) {
  const completed = completedCount(bundle.modules, progress);
  return (
    <section className="screen today-screen">
      <div className="section-kicker">Сегодня</div>
      <h2>Один следующий шаг</h2>
      <p className="lead">{action.reason}</p>
      <button className="primary-action" type="button" onClick={() => runAction(action)}>
        {iconFor(action.kind)}<span>{action.label}</span>
      </button>
      <div className="progress-strip">
        <span>{completed} из {bundle.modules.length} станций завершено</span>
        <progress max={bundle.modules.length} value={completed} aria-label="Прогресс курса" />
      </div>
      <p className="safety-note">Курс не заменяет врача, диагностику, лечение или индивидуальные рекомендации по питанию.</p>
    </section>
  );
}

function runAction(action: TodayAction): void {
  if (action.kind === "review") navigate({ screen: "memory" });
  else if (action.kind === "journal") navigate({ screen: "journal" });
  else if (action.kind === "remediation" && action.moduleId) navigate({ screen: "remediation", moduleId: action.moduleId });
  else navigate({ screen: "station", moduleId: action.moduleId || "M01", step: action.step || "understand" });
}

function iconFor(kind: TodayAction["kind"]) {
  if (kind === "review") return <Brain size={20} />;
  if (kind === "journal") return <ScrollText size={20} />;
  if (kind === "remediation") return <ScrollText size={20} />;
  return <Play size={20} />;
}

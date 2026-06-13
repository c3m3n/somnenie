import { useEffect, useState } from "react";
import { ArrowLeft, Brain, Gauge, LibraryBig, NotebookPen } from "lucide-react";
import { moduleById } from "../content/api";
import { getBlockAccess, getBlockState, getRemediationPlan, type BlockAccess } from "../domain/learningPath";
import { buildTodayAction } from "../domain/today";
import type { CourseBundle, ProgressMap, StationStepKey } from "../domain/types";
import { useAppData } from "./useAppData";
import { navigate, parseRoute, type Route } from "./route";
import { AtlasView } from "./screens/AtlasView";
import { JournalView } from "./screens/JournalView";
import { MemoryView } from "./screens/MemoryView";
import { CheckpointRemediationView, StationView } from "./screens/StationView";
import { TodayView } from "./screens/TodayView";
import "./styles.css";

export function App() {
  const data = useAppData();
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    const handler = () => setRoute(parseRoute());
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  if (data.loading) return <Shell route={route}><div className="loading">Загрузка курса...</div></Shell>;
  if (data.error || !data.bundle || !data.appState) return <Shell route={route}><div className="loading">{data.error || "Курс не загрузился"}</div></Shell>;

  const todayAction = buildTodayAction(data.bundle.modules, data.progress, data.appState);
  return <Shell route={route}>{renderRoute(route, { ...data, todayAction })}</Shell>;
}

function Shell({ route, children }: { route: Route; children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-button" type="button" aria-label="Назад" onClick={() => navigate({ screen: "today" })}><ArrowLeft size={18} /></button>
        <div className="brand"><img src="/assets/generated/icon-today.png" alt="" /><div><span>Somnenie</span><strong>{titleFor(route)}</strong></div></div>
        <nav className="topnav" aria-label="Основные разделы">
          <button className={navClass(route, "today")} type="button" onClick={() => navigate({ screen: "today" })}><Gauge size={16} />Сегодня</button>
          <button className={navClass(route, "atlas")} type="button" onClick={() => navigate({ screen: "atlas" })}><LibraryBig size={16} />Карта</button>
          <button className={navClass(route, "memory")} type="button" onClick={() => navigate({ screen: "memory" })}><Brain size={16} />Повторение</button>
          <button className={navClass(route, "journal")} type="button" onClick={() => navigate({ screen: "journal" })}><NotebookPen size={16} />Журнал</button>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

function navClass(route: Route, screen: Route["screen"]): string {
  return route.screen === screen ? "active" : "";
}

function renderRoute(route: Route, data: NonNullable<ReturnType<typeof useAppData>>): React.ReactNode {
  if (route.screen === "atlas") return <AtlasView bundle={data.bundle!} progress={data.progress} />;
  if (route.screen === "memory") return <MemoryView bundle={data.bundle!} appState={data.appState!} saveState={data.saveState} />;
  if (route.screen === "journal") return <JournalView bundle={data.bundle!} profile={data.profile} progress={data.progress} saveProfile={data.saveProfile} resetProgress={data.resetProgress} exportData={data.exportData} />;
  if (route.screen === "station") return stationRoute(route.moduleId, route.step, data);
  if (route.screen === "remediation") return remediationRoute(route.moduleId, data);
  return <TodayView bundle={data.bundle!} progress={data.progress} action={data.todayAction!} />;
}

function stationRoute(moduleId: string, step: StationStepKey, data: NonNullable<ReturnType<typeof useAppData>>): React.ReactNode {
  const module = moduleById(data.bundle!, moduleId);
  const access = getBlockAccess(moduleId, data.bundle!.modules, data.progress);
  if (!access.canOpen) return <LockedStationView access={access} bundle={data.bundle!} progress={data.progress} />;
  if (!module) return <div className="loading">Содержимое не найдено</div>;
  return <StationView module={module} step={step} progress={data.progress[moduleId] || {}} appState={data.appState!} saveProgress={data.saveProgress} saveState={data.saveState} />;
}

function remediationRoute(moduleId: string, data: NonNullable<ReturnType<typeof useAppData>>): React.ReactNode {
  const module = moduleById(data.bundle!, moduleId);
  const plan = getRemediationPlan(moduleId, data.progress, data.appState?.review);
  if (!module || !plan) return <TodayView bundle={data.bundle!} progress={data.progress} action={data.todayAction!} />;
  return <CheckpointRemediationView module={module} plan={plan} />;
}

function LockedStationView({ access, bundle, progress }: { access: BlockAccess; bundle: CourseBundle; progress: ProgressMap }) {
  const required = access.requiredBlockId ? moduleById(bundle, access.requiredBlockId) : null;
  const step = requiredStep(access.requiredBlockId, progress);
  return (
    <section className="screen station-screen locked-station">
      <header className="station-head">
        <div className="section-kicker">Блок закрыт · {access.blockId}</div>
        <h2>Блок закрыт для прохождения</h2>
        <p>{reasonLabel(access.reason)}</p>
      </header>
      <article className="locked-panel">
        <span className="section-kicker">Причина</span>
        <strong>{required ? `${required.id}. ${required.title}` : access.requiredBlockId}</strong>
        <p>Сначала нужно закрыть предыдущий блок, чтобы разблокировать следующий.</p>
        {required ? <button className="primary-action" type="button" onClick={() => navigate({ screen: "station", moduleId: required.id, step })}>Открыть {required.id}</button> : null}
      </article>
    </section>
  );
}

function requiredStep(moduleId: string | null, progress: ProgressMap): StationStepKey {
  const state = moduleId ? getBlockState(progress[moduleId]) : "available";
  return state === "checkpoint_failed" || state === "checkpoint_ready" ? "check" : "understand";
}

function reasonLabel(reason: BlockAccess["reason"]): string {
  return reason === "previous_checkpoint_failed" ? "Предыдущая контрольная не сдана." : "Предыдущая контрольная ещё не сдана.";
}

function titleFor(route: Route): string {
  if (route.screen === "atlas") return "Карта курса";
  if (route.screen === "memory") return "Повторение";
  if (route.screen === "journal") return "Журнал";
  if (route.screen === "remediation") return "Разбор ошибок";
  if (route.screen === "station") return route.moduleId;
  return "Сегодня";
}

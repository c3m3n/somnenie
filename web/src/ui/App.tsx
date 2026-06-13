import { useEffect, useState } from "react";
import { ArrowLeft, Brain, Gauge, LibraryBig, NotebookPen } from "lucide-react";
import { moduleById } from "../content/api";
import { buildTodayAction } from "../domain/today";
import type { StationStepKey } from "../domain/types";
import { useAppData } from "./useAppData";
import { navigate, parseRoute, type Route } from "./route";
import { AtlasView } from "./screens/AtlasView";
import { JournalView } from "./screens/JournalView";
import { MemoryView } from "./screens/MemoryView";
import { StationView } from "./screens/StationView";
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
  if (data.error || !data.bundle || !data.appState) return <Shell route={route}><div className="loading">{data.error || "Курс не найден"}</div></Shell>;

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
          <button className={navClass(route, "atlas")} type="button" onClick={() => navigate({ screen: "atlas" })}><LibraryBig size={16} />Атлас</button>
          <button className={navClass(route, "memory")} type="button" onClick={() => navigate({ screen: "memory" })}><Brain size={16} />Память</button>
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
  return <TodayView bundle={data.bundle!} progress={data.progress} action={data.todayAction!} />;
}

function stationRoute(moduleId: string, step: StationStepKey, data: NonNullable<ReturnType<typeof useAppData>>): React.ReactNode {
  const module = moduleById(data.bundle!, moduleId);
  if (!module) return <div className="loading">Станция не найдена</div>;
  return <StationView module={module} step={step} progress={data.progress[moduleId] || {}} appState={data.appState!} saveProgress={data.saveProgress} saveState={data.saveState} />;
}

function titleFor(route: Route): string {
  if (route.screen === "atlas") return "Карта курса";
  if (route.screen === "memory") return "Память";
  if (route.screen === "journal") return "Журнал";
  if (route.screen === "station") return route.moduleId;
  return "Сегодня";
}

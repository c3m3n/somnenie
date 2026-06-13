import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Brain, Gauge, LibraryBig, NotebookPen } from "lucide-react";
import { registerServiceWorker } from "../pwa/register";
import { forceServiceWorkerUpdate } from "../pwa/register";
import { moduleById } from "../content/api";
import { getBlockAccess, getRemediationPlan, getBlockState } from "../domain/learningPath";
import { buildTodayAction } from "../domain/today";
import type { CourseBundle, ProgressMap, StationStepKey } from "../domain/types";
import { useAppData } from "./useAppData";
import { navigate, parseRoute, routeHash, type Route } from "./route";
import { AtlasView } from "./screens/AtlasView";
import { JournalView } from "./screens/JournalView";
import { MemoryView } from "./screens/MemoryView";
import { CheckpointRemediationView, StationView } from "./screens/StationView";
import { TodayView } from "./screens/TodayView";
import { ErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

type AppScreenData = Omit<ReturnType<typeof useAppData>, "appState" | "bundle" | "progress"> & {
  bundle: CourseBundle;
  progress: ProgressMap;
  appState: NonNullable<ReturnType<typeof useAppData>["appState"]>;
};

export function App() {
  const data = useAppData();
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    registerServiceWorker();
    const handler = () => setRoute(parseRoute());
    window.addEventListener("hashchange", handler);
    window.addEventListener("popstate", handler);
    return () => {
      window.removeEventListener("hashchange", handler);
      window.removeEventListener("popstate", handler);
    };
  }, []);

  useEffect(() => {
    const onUpdateFound = () => setUpdateAvailable(true);
    window.addEventListener("nutrio-sw-update-found", onUpdateFound);
    return () => {
      window.removeEventListener("nutrio-sw-update-found", onUpdateFound);
    };
  }, []);

  useEffect(() => {
    if (!mainRef.current) return;
    window.scrollTo(0, 0);
    const heading = mainRef.current.querySelector("h1, h2, h3");
    if (heading instanceof HTMLElement) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }, [route]);

  if (data.loading) {
    return <Shell route={route} onUpdate={() => {}} updateAvailable={false}><div className="loading" role="status">Загрузка приложения...</div></Shell>;
  }
  if (data.error || !data.bundle || !data.appState) {
    return <Shell route={route} onUpdate={() => {}} updateAvailable={false}><section className="screen" role="alert"><h2>Ошибка загрузки</h2><p>{data.error || "Не удалось загрузить приложение."}</p></section></Shell>;
  }

  const readyData = data as AppScreenData;
  const todayAction = data.todayAction ?? buildTodayAction(data.bundle.modules, data.progress, data.appState);

  const handleUpdateFlow = () => {
    forceServiceWorkerUpdate();
    setUpdateAvailable(false);
  };

  return (
    <Shell route={route} onUpdate={handleUpdateFlow} updateAvailable={updateAvailable}>
      <ErrorBoundary>
        <RenderRoute route={route} data={{ ...readyData, todayAction }} />
      </ErrorBoundary>
    </Shell>
  );

  function goBack(): void {
    if (window.history.length > 1) window.history.back();
    else navigate({ screen: "today" });
  }

  function Shell({
    route,
    children,
    updateAvailable,
    onUpdate,
  }: {
    route: Route;
    children: React.ReactNode;
    updateAvailable: boolean;
    onUpdate: () => void;
  }) {
    return (
      <div className="app-shell" role="application" aria-label="Приложение обучения">
        <a className="skip-link" href="#main-content">Перейти к содержимому</a>
        <header className="topbar">
          <a
            href={routeHash({ screen: "today" })}
            className="icon-button"
            aria-label="Назад"
            onClick={(event) => {
              event.preventDefault();
              goBack();
            }}
          >
            <ArrowLeft size={18} />
          </a>
          <div className="brand">
            <img src="/assets/generated/icon-today.png" alt="" />
            <div><span>Somnenie</span><strong>{titleFor(route)}</strong></div>
          </div>
          <nav className="topnav" aria-label="Основные разделы">
            <a className={route.screen === "today" ? "active" : ""} aria-current={route.screen === "today" ? "page" : undefined} href={routeHash({ screen: "today" })} onClick={(event) => {
              event.preventDefault();
              navigate({ screen: "today" });
            }}>
              <Gauge size={16} />Сегодня
            </a>
            <a className={route.screen === "atlas" ? "active" : ""} aria-current={route.screen === "atlas" ? "page" : undefined} href={routeHash({ screen: "atlas" })} onClick={(event) => {
              event.preventDefault();
              navigate({ screen: "atlas" });
            }}>
              <LibraryBig size={16} />Атлас
            </a>
            <a className={route.screen === "memory" ? "active" : ""} aria-current={route.screen === "memory" ? "page" : undefined} href={routeHash({ screen: "memory" })} onClick={(event) => {
              event.preventDefault();
              navigate({ screen: "memory" });
            }}>
              <Brain size={16} />Повторение
            </a>
            <a className={route.screen === "journal" ? "active" : ""} aria-current={route.screen === "journal" ? "page" : undefined} href={routeHash({ screen: "journal" })} onClick={(event) => {
              event.preventDefault();
              navigate({ screen: "journal" });
            }}>
              <NotebookPen size={16} />Журнал
            </a>
          </nav>
        </header>
        {updateAvailable ? (
          <section className="update-banner" role="status" aria-live="polite">
            <span>Доступно обновление приложения</span>
            <button type="button" onClick={onUpdate}>Обновить</button>
          </section>
        ) : null}
        <main id="main-content" ref={mainRef} tabIndex={-1}>{children}</main>
      </div>
    );
  }
}

function RenderRoute({ route, data }: { route: Route; data: AppScreenData & { todayAction: ReturnType<typeof buildTodayAction> } }): React.ReactNode {
  if (route.screen === "atlas") return <AtlasView bundle={data.bundle} progress={data.progress} />;
  if (route.screen === "memory") return <MemoryView bundle={data.bundle} appState={data.appState} saveState={data.saveState} />;
  if (route.screen === "journal") return <JournalView bundle={data.bundle} profile={data.profile} progress={data.progress} saveProfile={data.saveProfile} resetProgress={data.resetProgress} exportData={data.exportData} />;
  if (route.screen === "station") return stationRoute(route.moduleId, route.step, data);
  if (route.screen === "remediation") return remediationRoute(route.moduleId, data);
  return <TodayView bundle={data.bundle} progress={data.progress} action={data.todayAction} />;
}

function stationRoute(moduleId: string, step: StationStepKey, data: AppScreenData & { todayAction: ReturnType<typeof buildTodayAction> }): React.ReactNode {
  const module = moduleById(data.bundle, moduleId);
  if (!module) return <MissingModule moduleId={moduleId} />;
  const access = getBlockAccess(module.id, data.bundle.modules, data.progress);
  if (!access.canOpen) return <LockedStationView access={access} bundle={data.bundle} progress={data.progress} />;
  return <StationView bundle={data.bundle} module={module} step={step} progress={data.progress[moduleId] || {}} appState={data.appState} saveProgress={data.saveProgress} saveState={data.saveState} />;
}

function remediationRoute(moduleId: string, data: AppScreenData & { todayAction: ReturnType<typeof buildTodayAction> }): React.ReactNode {
  const module = moduleById(data.bundle, moduleId);
  const plan = module && getRemediationPlan(module.id, data.progress, data.appState?.review);
  if (!module || !plan) return <TodayView bundle={data.bundle} progress={data.progress} action={data.todayAction} />;
  return <CheckpointRemediationView module={module} plan={plan} />;
}

function MissingModule({ moduleId }: { moduleId: string }) {
  return <section className="screen" role="status"><h2>Модуль не найден</h2><p>Запрошенный модуль {moduleId} отсутствует.</p></section>;
}

function LockedStationView({ access, bundle, progress }: { access: { reason: "previous_checkpoint_failed" | "previous_checkpoint_required" | null; blockId: string; state: string; canOpen: boolean; requiredBlockId: string | null }; bundle: CourseBundle; progress: ProgressMap }) {
  const required = access.requiredBlockId ? moduleById(bundle, access.requiredBlockId) : null;
  const step = requiredStep(access.requiredBlockId, progress);
  return (
    <section className="screen station-screen locked-station">
      <header className="station-head">
        <div className="section-kicker">Блок закрыт до {access.blockId}</div>
        <h2>Блок закрыт для продолжения</h2>
        <p>{reasonLabel(access.reason)}</p>
      </header>
      <article className="locked-panel">
        <span className="section-kicker">Необходимый</span>
        <strong>{required ? `${required.id}. ${required.title}` : access.requiredBlockId}</strong>
        <p>Пройдите обязательный предыдущий блок, затем вернитесь.</p>
        {required ? (
          <a className="primary-action" href={routeHash({ screen: "station", moduleId: required.id, step })} onClick={(event) => {
            event.preventDefault();
            navigate({ screen: "station", moduleId: required.id, step });
          }}>
            Перейти в {required.id}
          </a>
        ) : null}
      </article>
    </section>
  );
}

function requiredStep(moduleId: string | null, progress: ProgressMap): StationStepKey {
  const state = moduleId ? getBlockState(progress[moduleId]) : "available";
  return state === "checkpoint_failed" || state === "checkpoint_ready" ? "check" : "understand";
}

function reasonLabel(reason: "previous_checkpoint_failed" | "previous_checkpoint_required" | null): string {
  return reason === "previous_checkpoint_failed" ? "Предыдущая контрольная не сдана." : "Предыдущая контрольная должна быть закрыта.";
}

function titleFor(route: Route): string {
  if (route.screen === "atlas") return "Атлас курса";
  if (route.screen === "memory") return "Повторение";
  if (route.screen === "journal") return "Журнал";
  if (route.screen === "remediation") return "Проход контрольной";
  if (route.screen === "station") return route.moduleId;
  return "Сегодня";
}

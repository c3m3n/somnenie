import { useEffect, useRef, useState } from "react";
import { registerServiceWorker } from "../pwa/register";
import { forceServiceWorkerUpdate } from "../pwa/register";
import { moduleById } from "../content/api";
import { getBlockAccess, getRemediationPlan, getBlockState } from "../domain/learningPath";
import { buildTodayAction } from "../domain/today";
import type { AppState, CourseBundle, CourseId, ProgressMap, StationStepKey } from "../domain/types";
import { useAppData } from "../ui/useAppData";
import { navigate, parseRoute, routeHash, type Route } from "../ui/route";
import { AtlasView } from "../features/atlas/AtlasView";
import { OnboardingView } from "../features/onboarding/OnboardingView";
import { JournalView } from "../features/journal/JournalView";
import { MemoryView } from "../features/memory/MemoryView";
import { CheckpointRemediationView, StationView } from "../features/station/StationView";
import { TodayView } from "../features/today/TodayView";
import { ErrorBoundary } from "./ErrorBoundary";
import { CourseCatalogView } from "../features/courses/CourseCatalogView";
import { Shell } from "./Shell";
import "../ui/styles.css";

type AppScreenData = Omit<ReturnType<typeof useAppData>, "appState" | "bundle" | "progress"> & {
  bundle: CourseBundle;
  progress: ProgressMap;
  appState: AppState;
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

  const handleUpdateFlow = () => {
    forceServiceWorkerUpdate();
    setUpdateAvailable(false);
  };

  if (route.screen === "courses" || !data.activeCourseId) {
    return (
      <Shell route={route} onUpdate={() => {}} updateAvailable={false} activeCourseId={data.activeCourseId}>
        <CourseCatalogView catalog={data.catalog} progress={data.progress} onSelectCourse={handleSelectCourse} saveProfile={data.saveProfile} />
      </Shell>
    );
  }

  if (data.loading) {
    return <Shell route={route} onUpdate={() => {}} updateAvailable={false} activeCourseId={data.activeCourseId}><div className="loading" role="status">Загрузка приложения...</div></Shell>;
  }
  if (data.error || !data.bundle || !data.appState) {
    return <Shell route={route} onUpdate={() => {}} updateAvailable={false} activeCourseId={data.activeCourseId}><section className="screen" role="alert"><h2>Ошибка загрузки</h2><p>{data.error || "Не удалось загрузить приложение."}</p></section></Shell>;
  }
  if (!data.profile) {
    return <OnboardingView saveProfile={data.saveProfile} />;
  }

  const readyData = data as AppScreenData;
  const todayAction = data.todayAction ?? buildTodayAction(data.bundle.modules, data.progress, data.appState);

  return (
    <Shell route={route} onUpdate={handleUpdateFlow} updateAvailable={updateAvailable} saveError={data.saveError} mainRef={mainRef} activeCourseId={data.activeCourseId}>
      <ErrorBoundary>
        <RenderRoute route={route} data={{ ...readyData, todayAction }} />
      </ErrorBoundary>
    </Shell>
  );

  function handleSelectCourse(courseId: CourseId) {
    void data.saveProfile({ ...data.profile, activeCourseId: courseId });
    navigate({ screen: "today", courseId });
  }
}

function RenderRoute({ route, data }: { route: Route; data: AppScreenData & { todayAction: ReturnType<typeof buildTodayAction> } }): React.ReactNode {
  if (route.screen === "atlas") return <AtlasView bundle={data.bundle} progress={data.progress} />;
  if (route.screen === "memory") return <MemoryView bundle={data.bundle} appState={data.appState} saveState={data.saveState} />;
  if (route.screen === "journal") return <JournalView bundle={data.bundle} profile={data.profile} progress={data.progress} saveProfile={data.saveProfile} resetProgress={data.resetProgress} exportData={data.exportData} />;
  if (route.screen === "station") return stationRoute(route.moduleId, route.step, data);
  if (route.screen === "remediation") return remediationRoute(route.moduleId, data);
  return <TodayView bundle={data.bundle} progress={data.progress} action={data.todayAction} lastSessionDate={data.appState.sessions.lastDate} sessions={data.appState.sessions} />;
}

function stationRoute(moduleId: string, step: StationStepKey, data: AppScreenData & { todayAction: ReturnType<typeof buildTodayAction> }): React.ReactNode {
  const module = moduleById(data.bundle, moduleId);
  if (!module) return <MissingModule moduleId={moduleId} />;
  const access = getBlockAccess(module.id, data.bundle.modules, data.progress);
  if (!access.canOpen) return <LockedStationView access={access} bundle={data.bundle} progress={data.progress} />;
  const moduleProgress = data.progress[moduleId] || {};
  const resolvedStep: StationStepKey = step === "check" && !moduleProgress.theoryRead ? "understand" : step;
  return <StationView bundle={data.bundle} module={module} step={resolvedStep} progress={moduleProgress} appState={data.appState} saveProgress={data.saveProgress} saveState={data.saveState} />;
}

function remediationRoute(moduleId: string, data: AppScreenData & { todayAction: ReturnType<typeof buildTodayAction> }): React.ReactNode {
  const module = moduleById(data.bundle, moduleId);
  const plan = module && getRemediationPlan(module.id, data.progress, data.appState?.review);
  if (!module || !plan) return <TodayView bundle={data.bundle} progress={data.progress} action={data.todayAction} sessions={data.appState.sessions} />;
  return <CheckpointRemediationView module={module} plan={plan} courseId={data.bundle.courseId} />;
}

function MissingModule({ moduleId }: { moduleId: string }) {
  return <section className="screen" role="status"><h2>Блок не найден</h2><p>Запрошенный блок {moduleId} отсутствует.</p></section>;
}

function LockedStationView({ access, bundle, progress }: { access: { reason: "previous_checkpoint_failed" | "previous_checkpoint_required" | null; blockId: string; state: string; canOpen: boolean; requiredBlockId: string | null }; bundle: CourseBundle; progress: ProgressMap }) {
  const required = access.requiredBlockId ? moduleById(bundle, access.requiredBlockId) : null;
  const step = requiredStep(access.requiredBlockId, progress);
  return (
    <section className="screen">
      <header>
        <div>Блок закрыт до {access.blockId}</div>
        <h2>Блок закрыт для продолжения</h2>
        <p>{reasonLabel(access.reason)}</p>
      </header>
      <article>
        <span>Необходимый блок</span>
        <strong>{required ? `${required.id}. ${required.title}` : access.requiredBlockId}</strong>
        <p>Пройдите обязательный предыдущий блок, затем вернитесь.</p>
        {required ? (
          <a className="primary-action" href={routeHash({ screen: "station", courseId: bundle.courseId, moduleId: required.id, step })} onClick={(event) => {
            event.preventDefault();
            navigate({ screen: "station", courseId: bundle.courseId, moduleId: required.id, step });
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
  return reason === "previous_checkpoint_failed" ? "Зачёт предыдущего блока не сдан." : "Зачёт предыдущего блока должен быть закрыт.";
}



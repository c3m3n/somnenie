import { useCallback, useEffect, useRef, useState } from "react";
import { buildTodayAction } from "../domain/today";
import { COURSE_ID, SCHEMA_VERSION, type AppState, type ContentCatalog, type CourseBundle, type CourseId, type LearnerProfile, type ModuleProgress, type ProgressMap } from "../domain/types";
import { useAppServices } from "../shared/services/AppServicesContext";
import type { AppServices } from "../shared/services/AppServicesContext";

interface AppDataState {
  catalog: ContentCatalog | null;
  bundle: CourseBundle | null;
  profile: LearnerProfile | null;
  progress: ProgressMap;
  appState: AppState | null;
  activeCourseId: CourseId | null;
  todayAction: ReturnType<typeof buildTodayAction> | null;
  loading: boolean;
  error: string | null;
  saveError: string | null;
}

interface SaveQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export interface AppData {
  catalog: ContentCatalog | null;
  bundle: CourseBundle | null;
  profile: LearnerProfile | null;
  progress: ProgressMap;
  appState: AppState | null;
  activeCourseId: CourseId | null;
  todayAction: ReturnType<typeof buildTodayAction> | null;
  loading: boolean;
  error: string | null;
  saveError: string | null;
  reload: () => Promise<void>;
  saveProgress: (moduleId: string, patch: ModuleProgress) => Promise<void>;
  saveState: (patch: Partial<AppState>) => Promise<void>;
  saveProfile: (profile: LearnerProfile) => Promise<void>;
  resetProgress: () => Promise<void>;
  exportData: () => Promise<void>;
}

export function useAppData(): AppData {
  const services = useAppServices();
  const [state, setState] = useState<AppDataState>(createInitialState());
  const writeQueue = useRef(createSaveQueue());
  const todayActionRef = useRef<AppDataState["todayAction"]>(null);
  const moduleCountRef = useRef(0);
  const activeCourseRef = useRef<CourseId | null>(null);

  const loadBundleAndState = useCallback(async () => {
    const stateResult = await loadState(services);
    activeCourseRef.current = stateResult.activeCourseId;
    moduleCountRef.current = Object.keys(stateResult.progress).length;
    return stateResult;
  }, [services]);

  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    const next = await loadBundleAndState();
    setState(next);
    todayActionRef.current = next.todayAction;
  }, [loadBundleAndState]);

  const saveProgress = useCallback(async (moduleId: string, patch: ModuleProgress) => {
    const courseId = activeCourseRef.current;
    if (!courseId) throw new Error("No active course");
    try {
      const nextProgress = await writeQueue.current.enqueue(() => services.storage.saveModuleProgress(courseId, moduleId, patch));
      setState((current) => {
        const progress = { ...current.progress, [moduleId]: nextProgress };
        const nextAction = current.bundle && current.appState
          ? buildTodayAction(current.bundle.modules, progress, current.appState)
          : current.todayAction;
        todayActionRef.current = nextAction;
        return { ...current, progress, todayAction: nextAction, saveError: null };
      });
    } catch (error) {
      setState((current) => ({ ...current, saveError: error instanceof Error ? error.message : "Не удалось сохранить прогресс" }));
      throw error;
    }
  }, [services.storage]);

  const saveState = useCallback(async (patch: Partial<AppState>) => {
    const courseId = activeCourseRef.current;
    if (!courseId) throw new Error("No active course");
    try {
      const courseState = await writeQueue.current.enqueue(() => services.storage.saveCourseAppState(courseId, patch));
      const nextState: AppState = { schemaVersion: SCHEMA_VERSION, review: courseState.review, sessions: courseState.sessions };
      setState((current) => {
        const nextAction = current.bundle ? buildTodayAction(current.bundle.modules, current.progress, nextState) : current.todayAction;
        todayActionRef.current = nextAction;
        return { ...current, appState: nextState, todayAction: nextAction, saveError: null };
      });
    } catch (error) {
      setState((current) => ({ ...current, saveError: error instanceof Error ? error.message : "Не удалось сохранить состояние" }));
      throw error;
    }
  }, [services.storage]);

  const saveProfile = useCallback(async (profile: LearnerProfile) => {
    try {
      await writeQueue.current.enqueue(() => services.storage.saveProfile(profile));
      setState((current) => ({ ...current, profile, saveError: null }));
    } catch (error) {
      setState((current) => ({ ...current, saveError: error instanceof Error ? error.message : "Не удалось сохранить профиль" }));
      throw error;
    }
  }, [services.storage]);

  const resetProgress = useCallback(async () => {
    const courseId = activeCourseRef.current || COURSE_ID;
    await writeQueue.current.enqueue(() => services.storage.resetProgress(courseId));
    await reload();
  }, [reload, services.storage]);

  const exportData = useCallback(async () => {
    const courseId = activeCourseRef.current || COURSE_ID;
    const payload = await services.storage.exportData(courseId);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `nutrio-data-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }, [services.storage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    ...state,
    todayAction: todayActionRef.current ?? state.todayAction,
    reload,
    saveProgress,
    saveState,
    saveProfile,
    resetProgress,
    exportData,
  };
}

function createInitialState(): AppDataState {
  return {
    catalog: null,
    bundle: null,
    profile: null,
    progress: {},
    appState: null,
    activeCourseId: null,
    todayAction: null,
    loading: true,
    error: null,
    saveError: null,
  };
}

async function loadState(services: AppServices) {
  try {
    await services.storage.initStorage();
    await services.storage.migrateFromLocalStorage();
    const [catalog, profile, globalAppState] = await Promise.all([
      services.content.loadCatalog(),
      services.storage.getProfile(),
      services.storage.getAppState(),
    ]);

    const activeCourseId = resolveActiveCourseId(services, catalog, profile, globalAppState);
    if (!activeCourseId) {
      return {
        ...createInitialState(),
        catalog,
        profile,
        activeCourseId: null,
        loading: false,
        error: null,
      };
    }

    const [bundle, progress, courseAppState] = await Promise.all([
      services.content.loadCourseBundle(activeCourseId),
      services.storage.getAllProgress(activeCourseId),
      services.storage.getCourseAppState(activeCourseId),
    ]);

    const appStateValue: AppState = {
      schemaVersion: SCHEMA_VERSION,
      review: courseAppState?.review || { schemaVersion: 2, courseId: activeCourseId, items: [] },
      sessions: courseAppState?.sessions || { courseId: activeCourseId, todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 },
    };

    return {
      ...createInitialState(),
      catalog,
      bundle,
      profile,
      progress,
      appState: appStateValue,
      activeCourseId,
      todayAction: buildTodayAction(bundle.modules, progress, appStateValue),
      loading: false,
      error: null,
    };
  } catch (error) {
    return {
      ...createInitialState(),
      loading: false,
      error: error instanceof Error ? error.message : "Не удалось загрузить приложение",
    };
  }
}

function resolveActiveCourseId(
  services: AppServices,
  catalog: ContentCatalog | null,
  profile: LearnerProfile | null,
  globalAppState: { activeCourseId?: CourseId } | null,
): CourseId | null {
  const route = services.navigation.parseRoute();
  if (route.screen !== "courses" && route.courseId) return route.courseId;
  if (profile?.activeCourseId) return profile.activeCourseId;
  if (globalAppState?.activeCourseId) return globalAppState.activeCourseId;
  return catalog?.courses[0]?.id || null;
}

function createSaveQueue(): SaveQueue {
  let chain: Promise<void> = Promise.resolve();
  return {
    enqueue(task) {
      const run = chain.then(task).catch((error: unknown) => {
        console.error("Storage write failed", error);
        throw error;
      });
      chain = run.then(() => undefined).catch(() => undefined);
      return run;
    },
  };
}

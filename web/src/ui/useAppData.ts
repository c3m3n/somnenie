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
  bundleError: string | null;
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
  bundleError: string | null;
  saveError: string | null;
  reload: () => Promise<void>;
  loadCourse: (courseId: CourseId) => Promise<void>;
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

  const loadBase = useCallback(async () => {
    await services.storage.initStorage();
    await services.storage.migrateFromLocalStorage();
    const [catalog, profile, globalAppState] = await Promise.all([
      services.content.loadCatalog(),
      services.storage.getProfile(),
      services.storage.getAppState(),
    ]);
    const activeCourseId = resolveActiveCourseId(services, catalog, profile, globalAppState);
    activeCourseRef.current = activeCourseId;
    return { catalog, profile, globalAppState, activeCourseId };
  }, [services]);

  const loadCourse = useCallback(async (courseId: CourseId) => {
    const [bundle, progress, courseAppState] = await Promise.all([
      services.content.loadCourseBundle(courseId),
      services.storage.getAllProgress(courseId),
      services.storage.getCourseAppState(courseId),
    ]);
    const appStateValue: AppState = {
      schemaVersion: SCHEMA_VERSION,
      review: courseAppState?.review || { schemaVersion: 2, courseId, items: [] },
      sessions: courseAppState?.sessions || { courseId, todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 },
    };
    moduleCountRef.current = Object.keys(progress).length;
    return { bundle, progress, appState: appStateValue };
  }, [services]);

  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null, bundleError: null }));
    try {
      const base = await loadBase();
      if (!base.activeCourseId) {
        setState({
          ...createInitialState(),
          catalog: base.catalog,
          profile: base.profile,
          activeCourseId: null,
          loading: false,
          error: null,
          bundleError: null,
        });
        todayActionRef.current = null;
        return;
      }
      try {
        const course = await loadCourse(base.activeCourseId);
        setState({
          ...createInitialState(),
          catalog: base.catalog,
          bundle: course.bundle,
          profile: base.profile,
          progress: course.progress,
          appState: course.appState,
          activeCourseId: base.activeCourseId,
          todayAction: buildTodayAction(course.bundle.modules, course.progress, course.appState),
          loading: false,
          error: null,
          bundleError: null,
        });
        todayActionRef.current = buildTodayAction(course.bundle.modules, course.progress, course.appState);
      } catch (courseError) {
        setState({
          ...createInitialState(),
          catalog: base.catalog,
          profile: base.profile,
          activeCourseId: base.activeCourseId,
          loading: false,
          error: null,
          bundleError: courseError instanceof Error ? courseError.message : "Не удалось загрузить курс",
        });
        todayActionRef.current = null;
      }
    } catch (error) {
      setState({
        ...createInitialState(),
        loading: false,
        error: error instanceof Error ? error.message : "Не удалось загрузить приложение",
        bundleError: null,
      });
      todayActionRef.current = null;
    }
  }, [loadBase, loadCourse]);

  const loadCourseById = useCallback(async (courseId: CourseId) => {
    setState((current) => ({ ...current, loading: true, bundleError: null, error: null }));
    activeCourseRef.current = courseId;
    try {
      const course = await loadCourse(courseId);
      setState((current) => ({
        ...current,
        bundle: course.bundle,
        progress: course.progress,
        appState: course.appState,
        activeCourseId: courseId,
        todayAction: buildTodayAction(course.bundle.modules, course.progress, course.appState),
        loading: false,
        bundleError: null,
        error: null,
      }));
      todayActionRef.current = buildTodayAction(course.bundle.modules, course.progress, course.appState);
    } catch (courseError) {
      setState((current) => ({
        ...current,
        loading: false,
        bundleError: courseError instanceof Error ? courseError.message : "Не удалось загрузить курс",
        error: null,
      }));
      todayActionRef.current = null;
    }
  }, [loadCourse]);

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
    loadCourse: loadCourseById,
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
    bundleError: null,
    saveError: null,
  };
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

import { useCallback, useEffect, useRef, useState } from "react";
import { loadCourseBundle } from "../content/api";
import { buildTodayAction } from "../domain/today";
import type { AppState, CourseBundle, LearnerProfile, ModuleProgress, ProgressMap } from "../domain/types";
import * as storage from "../storage/idb";

interface AppDataState {
  bundle: CourseBundle | null;
  profile: LearnerProfile | null;
  progress: ProgressMap;
  appState: AppState | null;
  todayAction: ReturnType<typeof buildTodayAction> | null;
  loading: boolean;
  error: string | null;
}

interface SaveQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export interface AppData {
  bundle: CourseBundle | null;
  profile: LearnerProfile | null;
  progress: ProgressMap;
  appState: AppState | null;
  todayAction: ReturnType<typeof buildTodayAction> | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  saveProgress: (moduleId: string, patch: ModuleProgress) => Promise<void>;
  saveState: (patch: Partial<AppState>) => Promise<void>;
  saveProfile: (profile: LearnerProfile) => Promise<void>;
  resetProgress: () => Promise<void>;
  exportData: () => Promise<void>;
}

export function useAppData(): AppData {
  const [state, setState] = useState<AppDataState>(createInitialState());
  const writeQueue = useRef(createSaveQueue());
  const todayActionRef = useRef<AppDataState["todayAction"]>(null);
  const moduleCountRef = useRef(0);

  const loadBundleAndState = useCallback(async () => {
    const stateResult = await loadState();
    moduleCountRef.current = Object.keys(stateResult.progress).length;
    return stateResult;
  }, []);

  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    const next = await loadBundleAndState();
    setState(next);
    todayActionRef.current = next.todayAction;
  }, [loadBundleAndState]);

  const saveProgress = useCallback(async (moduleId: string, patch: ModuleProgress) => {
    const nextProgress = await writeQueue.current.enqueue(() => storage.saveModuleProgress(moduleId, patch));
    setState((current) => {
      const progress = { ...current.progress, [moduleId]: nextProgress };
      const nextAction = current.bundle && current.appState
        ? buildTodayAction(current.bundle.modules, progress, current.appState)
        : current.todayAction;
      todayActionRef.current = nextAction;
      return { ...current, progress, todayAction: nextAction };
    });
  }, []);

  const saveState = useCallback(async (patch: Partial<AppState>) => {
    const nextState = await writeQueue.current.enqueue(() => storage.saveAppState(patch));
    setState((current) => {
      const nextAction = current.bundle ? buildTodayAction(current.bundle.modules, current.progress, nextState) : current.todayAction;
      todayActionRef.current = nextAction;
      return { ...current, appState: nextState, todayAction: nextAction };
    });
  }, []);

  const saveProfile = useCallback(async (profile: LearnerProfile) => {
    await writeQueue.current.enqueue(() => storage.saveProfile(profile));
    setState((current) => ({ ...current, profile }));
  }, []);

  const resetProgress = useCallback(async () => {
    await writeQueue.current.enqueue(() => storage.resetProgress());
    await reload();
  }, [reload]);

  const exportData = useCallback(async () => {
    const payload = await storage.exportData();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `nutrio-data-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (state.todayAction) {
      todayActionRef.current = state.todayAction;
    }
  }, [state.todayAction]);

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
    bundle: null,
    profile: null,
    progress: {},
    appState: null,
    todayAction: null,
    loading: true,
    error: null,
  };
}

async function loadState() {
  try {
    await storage.initStorage();
    await storage.migrateFromLocalStorage();
    const [bundle, profile, progress, appState] = await Promise.all([
      loadCourseBundle(),
      storage.getProfile(),
      storage.getAllProgress(),
      storage.getAppState(),
    ]);

    const appStateValue = appState || { schemaVersion: 2, review: { schemaVersion: 2, courseId: "nutrition", items: [] }, sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } };
    return {
      ...createInitialState(),
      bundle,
      profile,
      progress,
      appState: appStateValue,
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

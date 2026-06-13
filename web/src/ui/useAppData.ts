import { useCallback, useEffect, useState } from "react";
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
  const reload = useCallback(async () => setState(await loadState()), []);
  const saveProgress = useCallback(async (moduleId: string, patch: ModuleProgress) => {
    await storage.saveModuleProgress(moduleId, patch);
    await reload();
  }, [reload]);
  const saveState = useCallback(async (patch: Partial<AppState>) => {
    await storage.saveAppState(patch);
    await reload();
  }, [reload]);
  const saveProfile = useCallback(async (profile: LearnerProfile) => {
    await storage.saveProfile(profile);
    await reload();
  }, [reload]);
  const resetProgress = useCallback(async () => {
    await storage.resetProgress();
    await reload();
  }, [reload]);
  const exportData = useCallback(async () => downloadExport(), []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { ...state, reload, saveProgress, saveState, saveProfile, resetProgress, exportData };
}

function createInitialState(): AppDataState {
  return { bundle: null, profile: null, progress: {}, appState: null, todayAction: null, loading: true, error: null };
}

async function loadState() {
  try {
    const [bundle] = await Promise.all([loadCourseBundle(), storage.initStorage().then(storage.migrateFromLocalStorage)]);
    const [profile, progress, appState] = await Promise.all([storage.getProfile(), storage.getAllProgress(), storage.getAppState()]);
    return { bundle, profile, progress, appState, todayAction: buildTodayAction(bundle.modules, progress, appState), loading: false, error: null };
  } catch (error) {
    return { ...createInitialState(), loading: false, error: error instanceof Error ? error.message : "Не удалось загрузить приложение" };
  }
}

async function downloadExport(): Promise<void> {
  const payload = await storage.exportData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `nutrio-data-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

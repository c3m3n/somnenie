import type { AppState, ExportPayload, LearnerProfile, ModuleProgress, ProgressMap } from "../../domain/types";
import * as idb from "../../storage/idb";

export interface StorageService {
  initStorage(): Promise<void>;
  migrateFromLocalStorage(): Promise<{ migrated: boolean; skipped?: boolean }>;
  getProfile(): Promise<LearnerProfile | null>;
  saveProfile(profile: LearnerProfile): Promise<void>;
  getAllProgress(): Promise<ProgressMap>;
  saveModuleProgress(moduleId: string, patch: ModuleProgress): Promise<ModuleProgress>;
  getAppState(): Promise<AppState>;
  saveAppState(patch: Partial<AppState>): Promise<AppState>;
  resetProgress(): Promise<void>;
  exportData(): Promise<ExportPayload>;
}

export const idbStorageService: StorageService = {
  initStorage: idb.initStorage,
  migrateFromLocalStorage: idb.migrateFromLocalStorage,
  getProfile: idb.getProfile,
  saveProfile: idb.saveProfile,
  getAllProgress: idb.getAllProgress,
  saveModuleProgress: idb.saveModuleProgress,
  getAppState: idb.getAppState,
  saveAppState: idb.saveAppState,
  resetProgress: idb.resetProgress,
  exportData: idb.exportData,
};

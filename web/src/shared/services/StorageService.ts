import type { CourseAppState, CourseId, ExportPayload, LearnerProfile, ModuleProgress, MultiCourseAppState, ProgressMap } from "../../domain/types";
import * as idb from "../../storage/idb";

export interface StorageService {
  initStorage(): Promise<void>;
  migrateFromLocalStorage(): Promise<{ migrated: boolean; skipped?: boolean }>;
  getProfile(): Promise<LearnerProfile | null>;
  saveProfile(profile: LearnerProfile): Promise<void>;
  getAllProgress(courseId: CourseId): Promise<ProgressMap>;
  saveModuleProgress(courseId: CourseId, moduleId: string, patch: ModuleProgress): Promise<ModuleProgress>;
  getAppState(): Promise<MultiCourseAppState>;
  saveAppState(patch: Partial<MultiCourseAppState>): Promise<MultiCourseAppState>;
  getCourseAppState(courseId: CourseId): Promise<CourseAppState>;
  saveCourseAppState(courseId: CourseId, patch: Partial<CourseAppState>): Promise<CourseAppState>;
  resetProgress(courseId?: CourseId): Promise<void>;
  exportData(courseId?: CourseId): Promise<ExportPayload>;
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
  getCourseAppState: idb.getCourseAppState,
  saveCourseAppState: idb.saveCourseAppState,
  resetProgress: idb.resetProgress,
  exportData: idb.exportData,
};

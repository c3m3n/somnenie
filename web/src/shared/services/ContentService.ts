import { ensureModuleFiles, loadCourseBundle, moduleById } from "../../content/api";
import type { CourseBundle, CourseModule, ModuleFileName } from "../../domain/types";
import { clearCaches } from "../utils/clearCaches";

export interface ContentService {
  loadCourseBundle(): Promise<CourseBundle>;
  ensureModuleFiles(bundle: CourseBundle, moduleId: string, requestedFiles: readonly ModuleFileName[]): Promise<CourseModule | null>;
  moduleById(bundle: CourseBundle, moduleId: string): CourseModule | null;
  clearCaches(): void;
}

export const fetchContentService: ContentService = {
  loadCourseBundle,
  ensureModuleFiles,
  moduleById,
  clearCaches,
};

import { ensureModuleFiles, loadCatalog, loadCourseBundle, moduleById } from "../../content/api";
import type { ContentCatalog, CourseBundle, CourseId, CourseModule, ModuleFileName } from "../../domain/types";
import { clearCaches } from "../utils/clearCaches";

export interface ContentService {
  loadCatalog(): Promise<ContentCatalog>;
  loadCourseBundle(courseId: CourseId): Promise<CourseBundle>;
  ensureModuleFiles(bundle: CourseBundle, moduleId: string, requestedFiles: readonly ModuleFileName[]): Promise<CourseModule | null>;
  moduleById(bundle: CourseBundle, moduleId: string): CourseModule | null;
  clearCaches(): void;
}

export const fetchContentService: ContentService = {
  loadCatalog,
  loadCourseBundle,
  ensureModuleFiles,
  moduleById,
  clearCaches,
};

import { DEFAULT_MODULE_FILES, type ClaimsContract, type ContentManifest, type CourseBundle, type CourseId, type CourseMap, type CourseModule, type ModuleFileName } from "../domain/types";
import { LRUCache } from "../shared/utils/LRUCache";

const textCache = new LRUCache<string, string>(50);
const jsonCache = new LRUCache<string, unknown>(20);
const loadedModuleFiles = new Map<string, Set<ModuleFileName>>();

export interface ContentCatalog {
  schemaVersion: number;
  courses: { id: CourseId; title: string; description?: string; manifest: string }[];
}

export async function loadCatalog(): Promise<ContentCatalog> {
  return fetchJson<ContentCatalog>("/content/catalog.json");
}

export async function loadCourseBundle(courseId: CourseId): Promise<CourseBundle> {
  const manifest = await fetchJson<ContentManifest>(`/content/${courseId}/manifest.json`);
  const course = await fetchJson<CourseMap>(`/content/${courseId}/course.json`);
  const claims = await fetchJson<ClaimsContract>(`/content/${courseId}/claims.json`);
  const moduleFiles = normalizeModuleFiles(manifest.moduleFiles);
  const modules = manifest.modules.map((module) => loadModuleSkeleton(module.id, module.title, course, moduleFiles));
  return { courseId: manifest.courseId || courseId, manifest, course, claims, modules };
}

export function moduleById(bundle: CourseBundle, moduleId: string): CourseModule | null {
  return bundle.modules.find((module) => module.id === moduleId) || null;
}

export function clearContentCaches(): void {
  textCache.clear();
  jsonCache.clear();
  loadedModuleFiles.clear();
}

export function moduleFilesLoaded(module: CourseModule, neededFiles: readonly ModuleFileName[] = DEFAULT_MODULE_FILES): boolean {
  const loaded = loadedModuleFiles.get(module.id);
  return neededFiles.every((file) => loaded?.has(file) || Boolean(module.files[file]?.trim()));
}

export async function ensureModuleFiles(bundle: CourseBundle, moduleId: string, requestedFiles: readonly ModuleFileName[]): Promise<CourseModule | null> {
  const module = moduleById(bundle, moduleId);
  if (!module) return null;

  const moduleFiles = normalizeModuleFiles(bundle.manifest.moduleFiles);
  const needed = requestedFiles.length ? requestedFiles : moduleFiles;
  const loaded = loadedModuleFiles.get(module.id) || new Set<ModuleFileName>();
  const missing = needed.filter((file) => !loaded.has(file));
  if (!missing.length) return module;

  const loadedFiles = await loadModuleFiles(bundle.courseId, module.id, missing);
  for (const [file, content] of Object.entries(loadedFiles)) {
    module.files[file] = content;
    loaded.add(file);
  }
  loadedModuleFiles.set(module.id, loaded);
  return module;
}

export function readerFilesFromManifest(manifest: { moduleFiles?: ModuleFileName[] }): ModuleFileName[] {
  const files = normalizeModuleFiles(manifest.moduleFiles);
  return files.filter((file) => file !== "quiz.md");
}

export function quizFileFromManifest(manifest: { moduleFiles?: ModuleFileName[] }): ModuleFileName {
  const files = normalizeModuleFiles(manifest.moduleFiles);
  return files.find((file) => file.endsWith("quiz.md")) || "quiz.md";
}

function normalizeModuleFiles(moduleFiles: unknown): ModuleFileName[] {
  if (!Array.isArray(moduleFiles) || !moduleFiles.length) return [...DEFAULT_MODULE_FILES];
  const normalized = moduleFiles
    .map((value) => String(value || "").trim())
    .filter((value) => Boolean(value));
  return normalized.length ? normalized : [...DEFAULT_MODULE_FILES];
}

function loadModuleSkeleton(id: string, title: string, course: CourseMap, moduleFiles: ModuleFileName[]): CourseModule {
  const phase = course.phases.find((item) => item.modules.includes(id));
  const files = Object.fromEntries(moduleFiles.map((file) => [file, ""])) as Record<ModuleFileName, string>;
  return { id, title, phaseId: phase?.id || "phase", phaseTitle: phase?.title || "Блок", files };
}

const LOAD_TIMEOUT_MS = 10_000;

async function loadModuleFiles(courseId: CourseId, moduleId: string, moduleFiles: readonly ModuleFileName[]): Promise<Record<ModuleFileName, string>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    const entries = await Promise.all(moduleFiles.map(async (file) => [file, await fetchText(`/content/${courseId}/${moduleId}/${file}`, controller.signal)] as const));
    return Object.fromEntries(entries);
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const cached = jsonCache.get(url);
  if (cached !== undefined) return cached as T;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Не удалось загрузить ${url}`);
  const value = await response.json() as T;
  jsonCache.set(url, value);
  return value;
}

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const cached = textCache.get(url);
  if (cached !== undefined) return cached;
  const response = await fetch(url, signal ? { signal } : undefined);
  if (!response.ok) throw new Error(`Не удалось загрузить ${url}: ${response.status}`);
  const value = await response.text();
  textCache.set(url, value);
  return value;
}

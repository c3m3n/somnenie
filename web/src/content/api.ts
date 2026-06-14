import { MODULE_FILES, type ClaimsContract, type ContentManifest, type CourseBundle, type CourseMap, type CourseModule, type ModuleFileName } from "../domain/types";
import { LRUCache } from "../shared/utils/LRUCache";

const textCache = new LRUCache<string, string>(50);
const jsonCache = new LRUCache<string, unknown>(20);
const loadedModuleFiles = new Map<string, Set<ModuleFileName>>();

type ManifestModuleFiles = {
  modules: { id: string; title: string }[];
  moduleFiles: ModuleFileName[];
};

export async function loadCourseBundle(): Promise<CourseBundle> {
  const manifest = await fetchJson<ContentManifest>("/content/manifest.json");
  const course = await fetchJson<CourseMap>("/content/course.json");
  const claims = await fetchJson<ClaimsContract>("/content/claims.json");
  const moduleFiles = normalizeModuleFiles(manifest.moduleFiles);
  const modules = manifest.modules.map((module) => loadModuleSkeleton(module.id, module.title, course, moduleFiles));
  return { manifest, course, claims, modules };
}

export function moduleById(bundle: CourseBundle, moduleId: string): CourseModule | null {
  return bundle.modules.find((module) => module.id === moduleId) || null;
}

export function clearContentCaches(): void {
  textCache.clear();
  jsonCache.clear();
  loadedModuleFiles.clear();
}

export function moduleFilesLoaded(module: CourseModule, neededFiles: readonly ModuleFileName[] = MODULE_FILES): boolean {
  const loaded = loadedModuleFiles.get(module.id);
  return neededFiles.every((file) => loaded?.has(file) || Boolean(module.files[file]?.trim()));
}

export async function ensureModuleFiles(bundle: CourseBundle, moduleId: string, requestedFiles: readonly ModuleFileName[]): Promise<CourseModule | null> {
  const module = moduleById(bundle, moduleId);
  if (!module) return null;

  const manifestModules = (bundle.manifest as ManifestModuleFiles).moduleFiles || MODULE_FILES;
  const moduleFiles = normalizeModuleFiles(manifestModules);
  const needed = requestedFiles.length ? requestedFiles : moduleFiles;
  const loaded = loadedModuleFiles.get(module.id) || new Set<ModuleFileName>();
  const missing = needed.filter((file) => !loaded.has(file));
  if (!missing.length) return module;

  const loadedFiles = await loadModuleFiles(module.id, missing);
  for (const [file, content] of Object.entries(loadedFiles)) {
    module.files[file as ModuleFileName] = content;
    loaded.add(file as ModuleFileName);
  }
  loadedModuleFiles.set(module.id, loaded);
  return module;
}

function normalizeModuleFiles(moduleFiles: unknown): ModuleFileName[] {
  if (!Array.isArray(moduleFiles) || !moduleFiles.length) return [...MODULE_FILES];
  const normalized = moduleFiles
    .map((value) => String(value || "").trim())
    .filter((value) => MODULE_FILES.includes(value as ModuleFileName));
  return (normalized.length ? normalized : MODULE_FILES) as ModuleFileName[];
}

function loadModuleSkeleton(id: string, title: string, course: CourseMap, moduleFiles: ModuleFileName[]): CourseModule {
  const phase = course.phases.find((item) => item.modules.includes(id));
  const files = Object.fromEntries(moduleFiles.map((file) => [file, ""])) as Record<ModuleFileName, string>;
  return { id, title, phaseId: phase?.id || "phase", phaseTitle: phase?.title || "Блок", files };
}

const LOAD_TIMEOUT_MS = 10_000;

async function loadModuleFiles(moduleId: string, moduleFiles: readonly ModuleFileName[]): Promise<Record<ModuleFileName, string>> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
  try {
    const entries = await Promise.all(moduleFiles.map(async (file) => [file, await fetchText(`/content/${moduleId}/${file}`, controller.signal)] as const));
    return Object.fromEntries(entries) as Record<ModuleFileName, string>;
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

import { MODULE_FILES, type ClaimsContract, type ContentManifest, type CourseBundle, type CourseMap, type CourseModule, type ModuleFileName } from "../domain/types";

export async function loadCourseBundle(): Promise<CourseBundle> {
  const manifest = await fetchJson<ContentManifest>("/content/manifest.json");
  const course = await fetchJson<CourseMap>("/content/course.json");
  const claims = await fetchJson<ClaimsContract>("/content/claims.json");
  const modules = await Promise.all(manifest.modules.map((module) => loadModule(module.id, module.title, course)));
  return { manifest, course, claims, modules };
}

export function moduleById(bundle: CourseBundle, moduleId: string): CourseModule | null {
  return bundle.modules.find((module) => module.id === moduleId) || null;
}

export function nextModuleId(bundle: CourseBundle, moduleId: string): string | null {
  const index = bundle.modules.findIndex((module) => module.id === moduleId);
  return index >= 0 ? bundle.modules[index + 1]?.id || null : null;
}

async function loadModule(id: string, title: string, course: CourseMap): Promise<CourseModule> {
  const files = Object.fromEntries(await Promise.all(MODULE_FILES.map(async (file) => [file, await fetchText(`/content/${id}/${file}`)]))) as Record<ModuleFileName, string>;
  const phase = course.phases.find((item) => item.modules.includes(id));
  return { id, title, phaseId: phase?.id || "phase", phaseTitle: phase?.title || "Курс", files };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Не удалось загрузить ${url}`);
  return await response.json() as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-cache" });
  return response.ok ? await response.text() : "";
}

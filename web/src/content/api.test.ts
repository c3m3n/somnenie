import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearContentCaches, loadCatalog, loadCourseBundle } from "./api";

describe("content api cache", () => {
  beforeEach(() => {
    clearContentCaches();
    vi.restoreAllMocks();
  });

  it("throws on failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch);
    await expect(loadCourseBundle("nutrition")).rejects.toThrow("/content/nutrition/manifest.json");
  });

  it("loads catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => jsonFor(url),
    })) as unknown as typeof fetch);
    const catalog = await loadCatalog();
    expect(catalog.courses).toHaveLength(1);
    expect(catalog.courses[0]?.id).toBe("nutrition");
  });

  it("caches json responses", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => jsonFor(url),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    await loadCourseBundle("nutrition");
    await loadCourseBundle("nutrition");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function jsonFor(url: string): unknown {
  if (url.endsWith("catalog.json")) return { schemaVersion: 1, courses: [{ id: "nutrition", title: "Nutrition", manifest: "content/nutrition/manifest.json" }] };
  if (url.endsWith("manifest.json")) return { schemaVersion: 1, contentVersion: "test", courseId: "nutrition", course: "course.json", claims: "claims.json", moduleFiles: ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"], modules: [] };
  if (url.endsWith("course.json")) return { title: "Course", phases: [] };
  return { schemaVersion: 1, reviewedAt: "2026-01-01", sources: [], claims: [] };
}

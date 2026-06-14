import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearContentCaches, loadCourseBundle } from "./api";

describe("content api cache", () => {
  beforeEach(() => {
    clearContentCaches();
    vi.restoreAllMocks();
  });

  it("throws on failed fetch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch);
    await expect(loadCourseBundle()).rejects.toThrow("/content/manifest.json");
  });

  it("caches json responses", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => jsonFor(url),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    await loadCourseBundle();
    await loadCourseBundle();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function jsonFor(url: string): unknown {
  if (url.endsWith("manifest.json")) return { schemaVersion: 1, contentVersion: "test", course: "course.json", claims: "claims.json", moduleFiles: ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"], modules: [] };
  if (url.endsWith("course.json")) return { title: "Course", phases: [] };
  return { schemaVersion: 1, reviewedAt: "2026-01-01", sources: [], claims: [] };
}

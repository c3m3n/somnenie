import { describe, expect, it } from "vitest";
import { parseRoute } from "./route";
import { getBlockAccess } from "../domain/learningPath";
import type { CourseModule } from "../domain/types";

describe("route parsing", () => {
  const modules = ["M01", "M02", "M03"].map((id) => moduleFixture(id));

  it("parses course-based routes", () => {
    expect(parseRoute("#/nutrition/today")).toEqual({ screen: "today", courseId: "nutrition" });
    expect(parseRoute("#/informatics/today")).toEqual({ screen: "today", courseId: "informatics" });
    expect(parseRoute("#/nutrition/atlas")).toEqual({ screen: "atlas", courseId: "nutrition" });
  });

  it("parses station route with courseId", () => {
    expect(parseRoute("#/nutrition/station/M01/understand")).toEqual({ screen: "station", courseId: "nutrition", moduleId: "M01", step: "understand" });
    expect(parseRoute("#/informatics/station/M02/check")).toEqual({ screen: "station", courseId: "informatics", moduleId: "M02", step: "check" });
  });

  it("parses courses catalog route", () => {
    expect(parseRoute("#/courses")).toEqual({ screen: "courses" });
  });

  it("falls back to courses when courseId is missing", () => {
    expect(parseRoute("#/today")).toEqual({ screen: "courses" });
  });

  it("keeps blocked block route locked after failed prerequisite checkpoint", () => {
    const progress = { M01: { quizAttemptStatus: "complete" as const, quizBest: 6, quizTotal: 10 } };
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({ canOpen: false, reason: "previous_checkpoint_failed" });
  });
});

function moduleFixture(id: string): CourseModule {
  return { id, title: id, phaseId: "phase", phaseTitle: "Phase", files: { "theory.md": "", "terms.md": "", "practice.md": "", "diagrams.md": "", "summary.md": "", "quiz.md": "" } };
}

import { describe, expect, it } from "vitest";
import { parseRoute } from "./route";
import { getBlockAccess } from "../domain/learningPath";
import type { CourseModule } from "../domain/types";

describe("route parsing", () => {
  const modules = ["M01", "M02", "M03"].map((id) => moduleFixture(id));

  it("parses legacy block hash route", () => {
    expect(parseRoute("#/block/M02")).toEqual({ screen: "station", moduleId: "M02", step: "check" });
  });

  it("keeps blocked block route locked after failed prerequisite checkpoint", () => {
    const progress = { M01: { quizAttemptStatus: "complete" as const, quizBest: 6, quizTotal: 10 } };
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({ canOpen: false, reason: "previous_checkpoint_failed" });
  });

  it("supports legacy slash-prefixed block route", () => {
    expect(parseRoute("#block/M02")).toEqual({ screen: "station", moduleId: "M02", step: "check" });
  });

  it("legacy block route is still blocked when previous checkpoint fails", () => {
    const route = parseRoute("#/block/M02");
    const progress = { M01: { quizAttemptStatus: "complete" as const, quizBest: 6, quizTotal: 10 } };
    expect(route).toEqual({ screen: "station", moduleId: "M02", step: "check" });
    expect(getBlockAccess("M02", modules, progress)).toMatchObject({
      canOpen: false,
      reason: "previous_checkpoint_failed",
      requiredBlockId: "M01",
    });
  });
});

function moduleFixture(id: string): CourseModule {
  return { id, title: id, phaseId: "phase", phaseTitle: "Phase", files: { "theory.md": "", "terms.md": "", "practice.md": "", "diagrams.md": "", "summary.md": "", "quiz.md": "" } };
}

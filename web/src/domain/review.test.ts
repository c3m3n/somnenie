import { describe, expect, it } from "vitest";
import { applyReviewAnswer, dueReviewItems, normalizeReviewState, upsertWrongQuestion } from "./review";

describe("review engine", () => {
  it("schedules wrong answers and advances correct intervals", () => {
    const review = normalizeReviewState({});
    const next = upsertWrongQuestion(review, {
      moduleId: "M01",
      questionNumber: 2,
      questionText: "Question",
      explanation: "Repair",
    }, new Date("2026-06-13T10:00:00"));
    const item = next.items[0];
    expect(item.due).toBe("2026-06-14");
    expect(item.errors).toBe(1);
    expect(applyReviewAnswer(item, true, new Date("2026-06-14")).interval).toBe(3);
  });

  it("sorts due queue by errors and retires after the long interval", () => {
    const state = normalizeReviewState({ items: [
      { id: "a", moduleId: "M01", text: "A", due: "2026-06-13", errors: 1, interval: 1 },
      { id: "b", moduleId: "M01", text: "B", due: "2026-06-13", errors: 5, interval: 60 },
    ] });
    expect(dueReviewItems(state, new Date("2026-06-13"))[0].id).toBe("b");
    expect(applyReviewAnswer(state.items[1], true, new Date("2026-06-13")).retired).toBe(true);
  });
});

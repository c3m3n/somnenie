import { describe, expect, it } from "vitest";
import { canTransition, deriveCheckpointStatus, getState } from "./blockStateMachine";

describe("block state machine", () => {
  it("allows only explicit state-to-state transitions", () => {
    expect(canTransition("available", "in_progress")).toBe(true);
    expect(canTransition("checkpoint_failed", "checkpoint_passed")).toBe(true);
    expect(canTransition("checkpoint_passed", "checkpoint_failed")).toBe(false);
  });

  it("derives ready from completed reading", () => {
    expect(deriveCheckpointStatus({ theoryRead: true })).toBe("ready");
    expect(getState({ theoryRead: true })).toBe("checkpoint_ready");
  });

  it("uses latest checkpoint attempt as source of truth", () => {
    expect(deriveCheckpointStatus({
      checkpointAttempts: [
        { blockId: "M01", startedAt: "2026-01-01", completedAt: "2026-01-01", correct: 2, total: 5, passed: false, failedQuestionIds: ["1"] },
        { blockId: "M01", startedAt: "2026-01-02", completedAt: "2026-01-02", correct: 5, total: 5, passed: true, failedQuestionIds: [] },
      ],
    })).toBe("passed");
  });
});

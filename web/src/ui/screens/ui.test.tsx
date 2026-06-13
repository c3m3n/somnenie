import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { normalizeReviewState } from "../../domain/review";
import type { AppState, CourseBundle, CourseModule, ModuleProgress } from "../../domain/types";
import { AtlasView } from "./AtlasView";
import { JournalView } from "./JournalView";
import { MemoryView } from "./MemoryView";
import { StationView } from "./StationView";
import { TodayView } from "./TodayView";

describe("React learner flow", () => {
  it("Today renders one primary action", () => {
    render(<TodayView bundle={bundle()} progress={{}} action={{ kind: "station", label: "Continue", reason: "Next", moduleId: "M01" }} />);
    expect(screen.getAllByRole("button").length).toBe(1);
  });

  it("Atlas renders phases and modules", () => {
    render(<AtlasView bundle={bundle()} progress={{}} />);
    expect(screen.getAllByRole("button")).toHaveLength(24);
    expect(screen.getByText("M01")).toBeInTheDocument();
    expect(screen.getByText("Фаза 1")).toBeInTheDocument();
  });

  it("Station exposes route buttons", () => {
    render(<StationView bundle={bundle()} module={moduleFixture()} step="understand" progress={{}} appState={appState()} saveProgress={async () => undefined} saveState={async () => undefined} />);
    expect(screen.getAllByRole("button")).toBeTruthy();
    expect(screen.getAllByRole("button").length).toBeGreaterThan(2);
  });

  it("Quiz double click creates one progress write and one review write", async () => {
    const saveProgress = vi.fn(async () => undefined);
    const saveState = vi.fn(async () => undefined);
    render(<StationView bundle={bundle()} module={moduleFixture()} step="check" progress={{}} appState={appState()} saveProgress={saveProgress} saveState={saveState} />);
    const wrong = screen.getByRole("button", { name: /A/ });
    fireEvent.click(wrong);
    fireEvent.click(wrong);
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(1));
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it("Journal autosaves draft and commits current takeaway text", async () => {
    const saveProgress = vi.fn(async () => undefined);
    const { container } = render(<StationView bundle={bundle()} module={moduleFixture()} step="anchor" progress={{}} appState={appState()} saveProgress={saveProgress} saveState={async () => undefined} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New takeaway text" } });
    const saveButton = container.querySelector("button.primary-action");
    expect(saveButton).toBeTruthy();
    fireEvent.click(saveButton as HTMLButtonElement);
    await waitFor(() => expect(saveProgress).toHaveBeenCalledWith("M01", expect.objectContaining({ takeaway: "New takeaway text" })));
  });

  it("failed checkpoint result shows remediation action and hides start-next-block action", () => {
    const progress = {
      quizAnswered: 1,
      quizAttemptStatus: "complete" as const,
      quizBest: 0,
      quizTotal: 1,
      weakSpots: {
        "1": {
          text: "Sample wrong answer",
          questionText: "Sample question?",
          shortExplanation: "Sample explanation",
          questionNumber: 1,
          sourceBlock: "theory",
          sourceLesson: "M01",
          sourceFragment: "check",
          chosenOptionKey: "A",
          chosenOptionText: "A",
          correctOptionKey: "B",
          correctOptionText: "B",
        },
      },
    } as ModuleProgress;

    const { container } = render(<StationView bundle={bundle()} module={moduleFixture()} step="check" progress={progress} appState={appState()} saveProgress={async () => undefined} saveState={async () => undefined} />);
    expect(screen.getByRole("link")).toBeInTheDocument();
    expect(container.querySelectorAll(".result-actions button").length).toBe(1);
    expect(screen.queryByRole("button", { name: /next block|следующ/iu })).toBeNull();
  });

  it("Memory answer advances the review interval", async () => {
    const saveState = vi.fn(async () => undefined);
    render(<MemoryView bundle={bundle()} appState={appState("2026-06-13")} saveState={saveState} />);
    fireEvent.click(screen.getByRole("button", { name: /B/ }));
    await waitFor(() => expect(saveState).toHaveBeenCalled());
    const calls = saveState.mock.calls as unknown as Array<[Partial<AppState>]>;
    expect(calls[0]?.[0].review?.items[0]?.interval).toBe(3);
  });

  it("Journal screen exposes export and reset actions", () => {
    render(<JournalView bundle={bundle()} profile={null} progress={{}} saveProfile={async () => undefined} resetProgress={async () => undefined} exportData={async () => undefined} />);
    expect(screen.getAllByRole("button").length).toBe(3);
  });
});

function appState(due?: string): AppState {
  const items = due ? [{ id: "M01-q1", moduleId: "M01", text: "Question", questionNumber: 1, due, errors: 1, interval: 1 }] : [];
  return { schemaVersion: 2, review: normalizeReviewState({ items }), sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } };
}

function bundle(): CourseBundle {
  const modules = Array.from({ length: 24 }, (_, index) => ({ ...moduleFixture(`M${String(index + 1).padStart(2, "0")}`), phaseId: index < 12 ? "phase1" : "phase2", phaseTitle: index < 12 ? "Фаза 1" : "Фаза 2" } as CourseModule));
  return {
    manifest: { schemaVersion: 1, contentVersion: "test", course: "", moduleFiles: ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"] as const, claims: "", modules: modules.map((module) => ({ id: module.id, title: module.title })) },
    course: { title: "Course", phases: [{ id: "phase1", title: "Фаза 1", modules: modules.slice(0, 12).map((item) => item.id) }, { id: "phase2", title: "Фаза 2", modules: modules.slice(12).map((item) => item.id) }], },
    claims: { schemaVersion: 1, reviewedAt: "2026-06-13", sources: [], claims: [] },
    modules,
  };
}

function moduleFixture(id = "M01"): CourseModule {
  return { id, title: "Module", phaseId: "phase1", phaseTitle: "Фаза 1", files: { "theory.md": "# Theory", "terms.md": "Terms", "practice.md": "Practice", "diagrams.md": "Diagrams", "summary.md": "Summary", "quiz.md": quizMarkdown() } };
}

function quizMarkdown(): string {
  return ["## Q1 (MCQ)", "Choose.", "A. Wrong", "B. Right", "C. Other", "D. Other", "**Correct answer:** B", "**Explanation:** Because."].join("\n");
}

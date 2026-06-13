import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { normalizeReviewState } from "../../domain/review";
import { type AppState, type CourseBundle, type CourseModule } from "../../domain/types";
import { AtlasView } from "./AtlasView";
import { JournalView } from "./JournalView";
import { MemoryView } from "./MemoryView";
import { StationView } from "./StationView";
import { TodayView } from "./TodayView";

describe("React learner flow", () => {
  it("Today renders one primary action", () => {
    render(<TodayView bundle={bundle()} progress={{}} action={{ kind: "station", label: "Начать", reason: "Next", moduleId: "M01" }} />);
    expect(screen.getAllByRole("button", { name: /Начать/ })).toHaveLength(1);
  });

  it("Atlas renders all phases and modules", () => {
    render(<AtlasView bundle={bundle()} progress={{}} />);
    expect(screen.getAllByRole("button")).toHaveLength(24);
    expect(screen.getByText("Фаза 1")).toBeInTheDocument();
  });

  it("Station exposes the four-step route", () => {
    render(<StationView module={moduleFixture()} step="understand" progress={{}} appState={appState()} saveProgress={async () => undefined} saveState={async () => undefined} />);
    expect(screen.getByRole("button", { name: /Понять/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Проверить/ })).toBeInTheDocument();
  });

  it("Quiz double click creates one progress write and one review write", async () => {
    const saveProgress = vi.fn(async () => undefined);
    const saveState = vi.fn(async () => undefined);
    render(<StationView module={moduleFixture()} step="check" progress={{}} appState={appState()} saveProgress={saveProgress} saveState={saveState} />);
    const wrong = screen.getByRole("button", { name: /A/ });
    fireEvent.click(wrong);
    fireEvent.click(wrong);
    await waitFor(() => expect(saveProgress).toHaveBeenCalledTimes(1));
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it("Journal autosaves draft and commits current takeaway text", async () => {
    const saveProgress = vi.fn(async () => undefined);
    render(<StationView module={moduleFixture()} step="anchor" progress={{}} appState={appState()} saveProgress={saveProgress} saveState={async () => undefined} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Мой вывод" } });
    fireEvent.click(screen.getByRole("button", { name: /Продолжить/ }));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledWith("M01", expect.objectContaining({ takeaway: "Мой вывод" })));
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
    expect(screen.getByRole("button", { name: /Экспорт данных/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сбросить прогресс/ })).toBeInTheDocument();
  });
});

function appState(due?: string): AppState {
  const items = due ? [{ id: "M01-q1", moduleId: "M01", text: "Question", questionNumber: 1, due, errors: 1, interval: 1 }] : [];
  return { schemaVersion: 2, review: normalizeReviewState({ items }), sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } };
}

function bundle(): CourseBundle {
  const modules = Array.from({ length: 24 }, (_, index) => ({ ...moduleFixture(`M${String(index + 1).padStart(2, "0")}`), phaseId: index < 12 ? "phase1" : "phase2", phaseTitle: index < 12 ? "Фаза 1" : "Фаза 2" }));
  return { manifest: { schemaVersion: 1, contentVersion: "test", course: "", claims: "", moduleFiles: [], modules: [] }, course: { title: "Курс", phases: [{ id: "phase1", title: "Фаза 1", modules: modules.slice(0, 12).map((item) => item.id) }, { id: "phase2", title: "Фаза 2", modules: modules.slice(12).map((item) => item.id) }] }, claims: { schemaVersion: 1, reviewedAt: "2026-06-13", sources: [], claims: [] }, modules };
}

function moduleFixture(id = "M01"): CourseModule {
  return { id, title: "Введение", phaseId: "phase1", phaseTitle: "Фаза 1", files: { "theory.md": "# Theory", "terms.md": "Terms", "practice.md": "Practice", "diagrams.md": "Diagrams", "summary.md": "Summary", "quiz.md": quizMarkdown() } };
}

function quizMarkdown(): string {
  return ["## Q1 (MCQ)", "Choose.", "A. Wrong", "B. Right", "C. Other", "D. Other", "**Правильный ответ: B**", "**Объяснение:** Because."].join("\n");
}

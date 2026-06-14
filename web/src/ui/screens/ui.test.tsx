import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeReviewState } from "../../domain/review";
import type { AppState, CourseBundle, CourseModule, ModuleProgress, ProgressMap, RemediationPlan } from "../../domain/types";
import { App } from "../../app/RoutedApp";
import { AtlasView } from "./AtlasView";
import { JournalView } from "./JournalView";
import { MemoryView } from "./MemoryView";
import { CheckpointRemediationView, StationView } from "./StationView";
import { TodayView } from "./TodayView";

const mockUseAppData = vi.hoisted(() => vi.fn());

vi.mock("../useAppData", () => ({ useAppData: mockUseAppData }));
vi.mock("../../pwa/register", () => ({ forceServiceWorkerUpdate: vi.fn(), registerServiceWorker: vi.fn() }));

describe("React learner flow", () => {
  beforeEach(() => {
    mockUseAppData.mockReturnValue(appData());
    window.scrollTo = vi.fn();
    window.location.hash = "";
  });

  it("app shell exposes three primary navigation tabs and profile separately", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Основные разделы" });

    expect(nav).toHaveTextContent("Сегодня");
    expect(nav).toHaveTextContent("Маршрут");
    expect(nav).toHaveTextContent("Тренажёр");
    expect(nav).not.toHaveTextContent("Учиться");
    expect(nav).not.toHaveTextContent("Конспект");
    expect(nav).not.toHaveTextContent("\u0416\u0443\u0440\u043d\u0430\u043b");
    expect(nav).not.toHaveTextContent("Профиль");
    expect(screen.getByLabelText("Профиль")).toBeInTheDocument();
  });

  it("Учиться renders start state with one primary action, after-action and progress", () => {
    render(<TodayView bundle={bundle()} progress={{}} action={{ kind: "station", label: "Продолжить", reason: "Следующий доступный блок обучения.", moduleId: "M01" }} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Начните маршрут")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Начать первый блок/ })).toBeInTheDocument();
    expect(screen.getByText(/пройдёте блок и откроете зачёт/)).toBeInTheDocument();
    expect(screen.getByText("Маршрут: 0 из 24 блоков завершено")).toBeInTheDocument();
  });

  it("Учиться renders continue block state", () => {
    render(<TodayView bundle={bundle()} progress={{ M02: { theoryRead: true } }} action={{ kind: "station", label: "Продолжить", reason: "Сначала нужно закрыть текущий блок.", moduleId: "M02" }} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Продолжить блок")).toBeInTheDocument();
    expect(screen.getByText("Вы уже начали этот блок.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Продолжить" })).toBeInTheDocument();
  });

  it("Учиться renders checkpoint-ready state", () => {
    render(<TodayView bundle={bundle()} progress={{ M02: { theoryRead: true, takeaway: "Done" } }} action={{ kind: "station", label: "Начать контрольную", reason: "Доступен к выполнению.", moduleId: "M02", step: "check" }} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Пора на зачёт")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Пройти зачёт/ })).toBeInTheDocument();
    expect(screen.getByText(/если зачёт сдан/)).toBeInTheDocument();
  });

  it("Учиться renders failed checkpoint state", () => {
    render(<TodayView bundle={bundle()} progress={{ M02: { quizAttemptStatus: "complete", quizBest: 0, quizTotal: 1 } }} action={{ kind: "remediation", label: "Разобрать ошибки", reason: "Контрольная блока не сдана.", moduleId: "M02", step: "check" }} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Пока закрыто")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Разобрать ошибки/ })).toBeInTheDocument();
    expect(screen.getByText(/можно будет пройти зачёт ещё раз/)).toBeInTheDocument();
  });

  it("Учиться renders training state", () => {
    render(<TodayView bundle={bundle()} progress={{ M01: checkpointPassed() }} action={{ kind: "review", label: "Сделать повторы", reason: "1 опрос на повторение.", reviewItems: [reviewItem()] }} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Тренировка на сегодня")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Начать тренировку/ })).toBeInTheDocument();
  });

  it("Учиться renders course complete state", () => {
    render(<TodayView bundle={bundle()} progress={completeProgress()} action={{ kind: "journal", label: "Смотреть итоги", reason: "Курс закрыт." }} />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("Маршрут завершён")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Открыть конспект/ })).toBeInTheDocument();
    expect(screen.getByText("Маршрут: 24 из 24 блоков завершено")).toBeInTheDocument();
  });

  it("Atlas renders route phases and modules", () => {
    render(<AtlasView bundle={bundle()} progress={{}} />);
    expect(screen.getByText("Маршрут")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(24);
    expect(screen.getByText("M01")).toBeInTheDocument();
    expect(screen.getByText("Фаза 1")).toBeInTheDocument();
  });

  it("Atlas screen shows passed, in-progress and current block marker", () => {
    const progress: ProgressMap = {
      M01: checkpointPassed(),
      M02: { quizAttemptStatus: "in-progress", quizAnswered: 3, takeaway: "Preliminary takeaway" },
      M03: {},
    };
    render(<AtlasView bundle={bundle()} progress={progress} />);

    expect(screen.getByRole("button", { name: /Блок M01.*Зачёт сдан/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Блок M02.*В процессе/ })).toBeInTheDocument();
    expect(screen.getByText("Зачёт сдан")).toBeInTheDocument();
    expect(screen.getByText("В процессе")).toBeInTheDocument();
    expect(screen.getByText("Текущий")).toBeInTheDocument();
    expect(screen.queryByText("Атлас")).toBeNull();
    expect(screen.queryByText("Станция")).toBeNull();
  });

  it("Atlas route shows checkpoint-ready status", () => {
    const progress: ProgressMap = {
      M01: checkpointPassed(),
      M02: { theoryRead: true },
      M03: {},
    };
    render(<AtlasView bundle={bundle()} progress={progress} />);

    expect(screen.getByRole("button", { name: /Блок M02.*Нужен зачёт/ })).toBeInTheDocument();
    expect(screen.getByText("Нужен зачёт")).toBeInTheDocument();
  });

  it("Atlas route shows checkpoint-failed status", () => {
    const progress: ProgressMap = {
      M01: checkpointPassed(),
      M02: checkpointPassed(),
      M03: { quizAttemptStatus: "complete", quizBest: 2, quizTotal: 10, quizAnswered: 10 },
    };
    render(<AtlasView bundle={bundle()} progress={progress} />);

    expect(screen.getByRole("button", { name: /Блок M03.*Зачёт не сдан/ })).toBeInTheDocument();
    expect(screen.getByText("Зачёт не сдан")).toBeInTheDocument();
  });

  it("Locked route block shows reason and does not open module content directly", async () => {
    const progress: ProgressMap = {
      M01: { quizAttemptStatus: "complete", quizBest: 1, quizTotal: 10, quizAnswered: 10 },
      M02: {},
    };
    mockUseAppData.mockReturnValue({
      ...appData(),
      progress,
      todayAction: { kind: "station", label: "Продолжить", reason: "", moduleId: "M02", step: "understand" },
    });
    window.location.hash = "#/nutrition/atlas";

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Блок M02/ }));

    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: /Блок закрыт/ })).toBeInTheDocument());
    expect(screen.getByText(/Модуль|Пройдите обязательный/iu)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Перейти в/ })).toBeInTheDocument();
  });

  it("Station reader shows page indicator and navigation", () => {
    render(<StationView bundle={bundle()} module={moduleFixture()} step="understand" progress={{}} appState={appState()} saveProgress={async () => undefined} saveState={async () => undefined} />);
    expect(screen.getByText(/Блок/)).toBeInTheDocument();
    expect(screen.getByText(/1 \/ 5/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Дальше/ })).toBeInTheDocument();
  });

  it("Station screen says Блок, not Станция", () => {
    render(<StationView bundle={bundle()} module={moduleFixture()} step="understand" progress={{}} appState={appState()} saveProgress={async () => undefined} saveState={async () => undefined} />);
    expect(screen.getByText(/Блок/)).toBeInTheDocument();
    expect(screen.queryByText("Станция")).toBeNull();
  });

  it("Reader shows page labels and no tab navigation", () => {
    render(<StationView bundle={bundle()} module={moduleFixture()} step="understand" progress={{}} appState={appState()} saveProgress={async () => undefined} saveState={async () => undefined} />);
    expect(screen.getByText(/Теория/)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Навигация по страницам" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Навигация по шагам" })).toBeNull();
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

  it("Конспект autosaves draft and commits takeaway when navigating to quiz", async () => {
    const saveProgress = vi.fn(async () => undefined);
    render(<StationView bundle={bundle()} module={moduleFixture()} step="understand" progress={{ readerPageIndex: 4 }} appState={appState()} saveProgress={saveProgress} saveState={async () => undefined} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "New takeaway text" } });
    fireEvent.click(screen.getByRole("button", { name: /К зачёту/ }));
    await waitFor(() => expect(saveProgress).toHaveBeenCalledWith("M01", expect.objectContaining({ takeaway: "New takeaway text" })));
  });

  it("Last reader page commits takeaway and navigates to check", async () => {
    const saveProgress = vi.fn(async () => undefined);
    render(<StationView bundle={bundle()} module={moduleFixture()} step="understand" progress={{ readerPageIndex: 4 }} appState={appData().appState} saveProgress={saveProgress} saveState={async () => undefined} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Суть для следующего шага" } });
    fireEvent.click(screen.getByRole("button", { name: /К зачёту/ }));

    await waitFor(() => expect(saveProgress).toHaveBeenCalledWith("M01", expect.objectContaining({ takeaway: "Суть для следующего шага" })));
    expect(window.location.hash).toContain("#/nutrition/station/M01/check");
  });

  it("Checkpoint result shows passed status and next-step action", async () => {
    const progress: ModuleProgress = { quizAttemptStatus: "complete", quizBest: 4, quizTotal: 5, quizAnswered: 5 };
    render(<StationView bundle={bundle()} module={moduleFixture()} step="check" progress={progress} appState={appData().appState} saveProgress={async () => undefined} saveState={async () => undefined} />);

    await waitFor(() => expect(screen.getByText("Зачёт сдан")).toBeInTheDocument());
    expect(screen.getByText("4 / 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /К следующему шагу/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Вернуться в маршрут/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Разобрать ошибки/ })).toBeNull();
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
    expect(screen.getByText("Зачёт не сдан")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Разобрать ошибки" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Попробовать ещё раз/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button").filter((button) => !(button as HTMLButtonElement).disabled)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /next block|следующ/iu })).toBeNull();
  });

  it("Remediation screen shows linked material and one error at a time", () => {
    const module = moduleFixture();
    const plan: RemediationPlan = {
      blockId: "M01",
      failedAt: "2026-06-13T00:00:00.000Z",
      score: { correct: 1, total: 2, ratio: 0.5 },
      canRetake: true,
      actions: ["review_failed_questions"],
      failedAnswers: [
        {
          questionId: "q1",
          questionNumber: 1,
          questionText: "Что больше: 2+2 или 1+1?",
          chosenOptionKey: "A",
          chosenOptionText: "Три",
          correctOptionKey: "B",
          correctOptionText: "Четыре",
          explanation: "Проверьте правило сложения.",
          sourceBlock: "theory",
          sourceLesson: module.id,
          sourceFragment: "understand",
        },
      ],
    };

    render(<CheckpointRemediationView module={module} plan={plan} courseId="nutrition" />);

    expect(screen.getByText("Ошибка 1 из 1")).toBeInTheDocument();
    expect(screen.getByText(/Вопрос:/)).toBeInTheDocument();
    expect(screen.getByText(/Ваш ответ:/)).toBeInTheDocument();
    expect(screen.getByText(/Правильная идея:/)).toBeInTheDocument();
    expect(screen.getByText(/Почему это важно:/)).toBeInTheDocument();
    expect(screen.getByText("Связанный материал:")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть материал" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Попробовать зачёт ещё раз" })).toBeInTheDocument();
  });

  it("Remediation screen advances through errors", () => {
    const module = moduleFixture();
    const plan: RemediationPlan = {
      blockId: "M01",
      failedAt: "2026-06-13T00:00:00.000Z",
      score: { correct: 1, total: 2, ratio: 0.5 },
      canRetake: true,
      actions: ["review_failed_questions"],
      failedAnswers: [
        {
          questionId: "q1",
          questionNumber: 1,
          questionText: "Вопрос один",
          chosenOptionKey: "A",
          chosenOptionText: "Неверно",
          correctOptionKey: "B",
          correctOptionText: "Верно",
          explanation: "См. теорию.",
          sourceBlock: "theory",
          sourceLesson: module.id,
          sourceFragment: "understand",
        },
        {
          questionId: "q2",
          questionNumber: 2,
          questionText: "Вопрос два",
          chosenOptionKey: "C",
          chosenOptionText: "Неверно",
          correctOptionKey: "D",
          correctOptionText: "Верно",
          explanation: "См. пример.",
          sourceBlock: "practice",
          sourceLesson: module.id,
          sourceFragment: "apply",
        },
      ],
    };

    render(<CheckpointRemediationView module={module} plan={plan} courseId="nutrition" />);
    expect(screen.getByText("Ошибка 1 из 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть материал" })).toHaveAttribute("href", "#/nutrition/station/M01/understand");
    fireEvent.click(screen.getByRole("button", { name: "Следующая ошибка" }));
    expect(screen.getByText("Ошибка 2 из 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть материал" })).toHaveAttribute("href", "#/nutrition/station/M01/apply");
  });

  it("Remediation empty state shows fallback actions", () => {
    const module = moduleFixture();
    const plan: RemediationPlan = {
      blockId: "M01",
      failedAt: null,
      score: { correct: 0, total: 0, ratio: null },
      canRetake: true,
      actions: ["review_failed_questions"],
      failedAnswers: [],
    };

    render(<CheckpointRemediationView module={module} plan={plan} courseId="nutrition" />);
    expect(screen.getByText("Не удалось восстановить список вопросов.")).toBeInTheDocument();
    expect(screen.getByText("Откройте материал блока и попробуйте пройти зачёт ещё раз.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Открыть материал" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Пройти зачёт" })).toBeInTheDocument();
  });

  it("empty trainer shows Пока всё чисто", () => {
    render(<MemoryView bundle={bundle()} appState={appState()} saveState={async () => undefined} />);
    expect(screen.getByText("Тренажёр")).toBeInTheDocument();
    expect(screen.getByText("Пока всё чисто.")).toBeInTheDocument();
    expect(screen.getByText("Слабые места появятся после зачётов.")).toBeInTheDocument();
  });

  it("trainer with due items shows count of weak spots and does not use Память as heading", () => {
    const state = appStateWithReviewItems([
      reviewItem({ id: "M01-q1", text: "нутриент ≠ продукт", errors: 3 }),
      reviewItem({ id: "M01-q2", text: "роль порции", questionNumber: 2, errors: 2 }),
      reviewItem({ id: "M01-q3", text: "контекст рациона", questionNumber: 3, errors: 1 }),
    ]);
    const { container } = render(<MemoryView bundle={bundle()} appState={state} saveState={async () => undefined} />);
    const headingText = Array.from(container.querySelectorAll(".section-kicker, h2")).map((node) => node.textContent).join(" ");

    expect(screen.getByText("3 слабых места готовы к работе")).toBeInTheDocument();
    expect(screen.getByText("Это короткая тренировка на 3-5 минут.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Начать тренировку/ })).toBeInTheDocument();
    expect(screen.getByText("нутриент ≠ продукт")).toBeInTheDocument();
    expect(headingText).not.toMatch(/Память/u);
  });

  it("trainer card shows weak spot label and question options", () => {
    render(<MemoryView bundle={bundle()} appState={appState("2026-06-13")} saveState={async () => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Начать тренировку/ }));

    expect(screen.getByText("Вопрос 1 из 1")).toBeInTheDocument();
    expect(screen.getByText("Слабое место")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /B/ })).toBeInTheDocument();
  });

  it("question card answer updates review state and shows right feedback", async () => {
    const saveState = vi.fn(async () => undefined);
    render(<MemoryView bundle={bundle()} appState={appState("2026-06-13")} saveState={saveState} />);
    fireEvent.click(screen.getByRole("button", { name: /Начать тренировку/ }));
    fireEvent.click(screen.getByRole("button", { name: /B/ }));

    await waitFor(() => expect(saveState).toHaveBeenCalled());
    const calls = saveState.mock.calls as unknown as Array<[Partial<AppState>]>;
    expect(calls[0]?.[0].review?.items[0]?.interval).toBe(3);
    expect(calls[0]?.[0].review?.items[0]?.lastResult).toBe("right");
    expect(screen.getByText("Верно")).toBeInTheDocument();
    expect(screen.getByText("Вернём этот вопрос позже, чтобы закрепить.")).toBeInTheDocument();
  });

  it("wrong answer keeps item active and schedules it again", async () => {
    const saveState = vi.fn(async () => undefined);
    render(<MemoryView bundle={bundle()} appState={appState("2026-06-13")} saveState={saveState} />);
    fireEvent.click(screen.getByRole("button", { name: /Начать тренировку/ }));
    fireEvent.click(screen.getByRole("button", { name: /A/ }));

    await waitFor(() => expect(saveState).toHaveBeenCalled());
    const calls = saveState.mock.calls as unknown as Array<[Partial<AppState>]>;
    const item = calls[0]?.[0].review?.items[0];
    expect(item?.interval).toBe(1);
    expect(item?.lastResult).toBe("wrong");
    expect(item?.retired).toBe(false);
    expect(item?.due).not.toBeNull();
    expect(screen.getByText("Пока не закрепилось")).toBeInTheDocument();
    expect(screen.getByText("Вопрос вернётся завтра.")).toBeInTheDocument();
  });

  it("concept card has Помню / Не помню actions", async () => {
    const saveState = vi.fn(async () => undefined);
    render(<MemoryView bundle={bundle()} appState={appStateWithReviewItems([conceptReviewItem()])} saveState={saveState} />);
    fireEvent.click(screen.getByRole("button", { name: /Начать тренировку/ }));

    expect(screen.getByText("Слабое место")).toBeInTheDocument();
    expect(screen.getByText("Объясните себе:")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Не помню/ }));

    await waitFor(() => expect(saveState).toHaveBeenCalled());
    const calls = saveState.mock.calls as unknown as Array<[Partial<AppState>]>;
    expect(calls[0]?.[0].review?.items[0]?.lastResult).toBe("wrong");
  });

  it("session completion shows result summary and one primary action", async () => {
    const saveState = vi.fn(async () => undefined);
    render(<MemoryView bundle={bundle()} appState={appState("2026-06-13")} saveState={saveState} />);
    fireEvent.click(screen.getByRole("button", { name: /Начать тренировку/ }));
    fireEvent.click(screen.getByRole("button", { name: /B/ }));
    await waitFor(() => expect(screen.getByText("Верно")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Завершить тренировку" }));

    expect(screen.getByText("Тренировка завершена")).toBeInTheDocument();
    expect(screen.getByText(/Закрыто:/)).toHaveTextContent("Закрыто: 1 из 1");
    expect(screen.getByText(/Вернётся позже:/)).toHaveTextContent("Вернётся позже: 0 слабых мест");
    expect(screen.getByRole("link", { name: "Вернуться к учёбе" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Вернуться к учёбе" })).toHaveLength(1);
  });

  it("trainer does not show Разбор ошибок as main flow", () => {
    render(<MemoryView bundle={bundle()} appState={appState("2026-06-13")} saveState={async () => undefined} />);
    expect(screen.queryByText("Разбор ошибок")).toBeNull();
  });

  it("Profile screen shows progress, notes, settings and data", () => {
    render(<JournalView bundle={bundle()} profile={null} progress={{}} saveProfile={async () => undefined} resetProgress={async () => undefined} exportData={async () => undefined} />);
    expect(screen.getByRole("heading", { level: 2, name: "Профиль" })).toBeInTheDocument();
    expect(screen.getByText("Прогресс")).toBeInTheDocument();
    expect(screen.getByText("Конспект")).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByText("Данные")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Экспорт данных/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Сбросить прогресс/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "\u0416\u0443\u0440\u043d\u0430\u043b" })).toBeNull();
  });

  it("Profile progress shows completed blocks, passed checkpoints and active weak spots", () => {
    const progress: ProgressMap = {
      M01: checkpointPassed(),
      M02: checkpointPassed(),
      M03: {
        quizAttemptStatus: "complete",
        quizBest: 1,
        quizTotal: 5,
        weakSpots: {
          "1": { text: "A", questionNumber: 1 },
          "2": { text: "B", questionNumber: 2 },
          "3": { text: "C", questionNumber: 3 },
        },
      },
    };
    render(<JournalView bundle={bundle()} profile={null} progress={progress} saveProfile={async () => undefined} resetProgress={async () => undefined} exportData={async () => undefined} />);
    expect(screen.getByText("2 из 24 блоков завершено")).toBeInTheDocument();
    expect(screen.getByText("2 сдано")).toBeInTheDocument();
    expect(screen.getByText("3 слабых места в работе")).toBeInTheDocument();
  });

  it("Profile notes show an empty state and saved takeaways", () => {
    const { rerender } = render(<JournalView bundle={bundle()} profile={null} progress={{}} saveProfile={async () => undefined} resetProgress={async () => undefined} exportData={async () => undefined} />);
    expect(screen.getByText("Конспект пока пуст.")).toBeInTheDocument();
    expect(screen.getByText("Сохраняйте суть после блоков — она появится здесь.")).toBeInTheDocument();

    rerender(<JournalView bundle={bundle()} profile={null} progress={{ M01: { takeaway: "Рацион нельзя оценивать по одному продукту." } }} saveProfile={async () => undefined} resetProgress={async () => undefined} exportData={async () => undefined} />);
    expect(screen.getByText("M01 · Module")).toBeInTheDocument();
    expect(screen.getByText("Рацион нельзя оценивать по одному продукту.")).toBeInTheDocument();
  });

  it("Profile reset asks for confirmation before destructive reset", () => {
    const resetProgress = vi.fn(async () => undefined);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<JournalView bundle={bundle()} profile={null} progress={{}} saveProfile={async () => undefined} resetProgress={resetProgress} exportData={async () => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /Сбросить прогресс/ }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(resetProgress).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("primary screen headings do not expose old user-facing labels", () => {
    const screens = [
      render(<TodayView bundle={bundle()} progress={{}} action={{ kind: "station", label: "Продолжить", reason: "Следующий доступный блок обучения.", moduleId: "M01" }} />).container,
      render(<AtlasView bundle={bundle()} progress={{}} />).container,
      render(<MemoryView bundle={bundle()} appState={appState()} saveState={async () => undefined} />).container,
      render(<JournalView bundle={bundle()} profile={null} progress={{}} saveProfile={async () => undefined} resetProgress={async () => undefined} exportData={async () => undefined} />).container,
    ];
    const headingText = screens.map((container) => Array.from(container.querySelectorAll(".section-kicker, h2")).map((node) => node.textContent).join(" ")).join(" ");

    expect(headingText).not.toMatch(new RegExp("Учиться|Сегодня|Атлас|Память|\\u0416\\u0443\\u0440\\u043d\\u0430\\u043b|Станция", "u"));
  });
});

function appData() {
  return {
    appState: appState(),
    bundle: bundle(),
    catalog: catalog(),
    activeCourseId: "nutrition" as const,
    error: null,
    exportData: vi.fn(async () => undefined),
    loading: false,
    profile: { startedAt: "2026-06-14T00:00:00.000Z" },
    progress: {},
    reload: vi.fn(async () => undefined),
    resetProgress: vi.fn(async () => undefined),
    saveProfile: vi.fn(async () => undefined),
    saveProgress: vi.fn(async () => undefined),
    saveState: vi.fn(async () => undefined),
    todayAction: { kind: "station" as const, label: "Продолжить", reason: "Следующий доступный блок обучения.", moduleId: "M01" },
  };
}

function catalog() {
  return { schemaVersion: 1, courses: [{ id: "nutrition", title: "Nutrition", manifest: "content/nutrition/manifest.json" }] };
}

function appState(due?: string): AppState {
  const items = due ? [reviewItem({ due })] : [];
  return appStateWithReviewItems(items);
}

function appStateWithReviewItems(items: unknown[]): AppState {
  return { schemaVersion: 2, review: normalizeReviewState({ items }), sessions: { courseId: "nutrition", todayDone: {}, activeDays: [], lastDate: null, streakDays: 0, bestStreakDays: 0 } };
}

function bundle(): CourseBundle {
  const modules = Array.from({ length: 24 }, (_, index) => ({ ...moduleFixture(`M${String(index + 1).padStart(2, "0")}`), phaseId: index < 12 ? "phase1" : "phase2", phaseTitle: index < 12 ? "Фаза 1" : "Фаза 2" } as CourseModule));
  return {
    courseId: "nutrition",
    manifest: { schemaVersion: 1, contentVersion: "test", courseId: "nutrition", course: "", moduleFiles: ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"] as const, claims: "", modules: modules.map((module) => ({ id: module.id, title: module.title })) },
    course: { title: "Course", phases: [{ id: "phase1", title: "Фаза 1", modules: modules.slice(0, 12).map((item) => item.id) }, { id: "phase2", title: "Фаза 2", modules: modules.slice(12).map((item) => item.id) }] },
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

function completeProgress() {
  return Object.fromEntries(bundle().modules.map((module) => [module.id, checkpointPassed()]));
}

function checkpointPassed(): ModuleProgress {
  return { quizAttemptStatus: "complete", quizCompletedAt: "2026-06-13T00:00:00.000Z", quizBest: 7, quizTotal: 10 };
}

function reviewItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "M01-q1",
    courseId: "nutrition",
    moduleId: "M01",
    kind: "question" as const,
    text: "Question",
    questionNumber: 1,
    due: "2026-06-13",
    errors: 1,
    interval: 1,
    streak: 0,
    createdAt: "2026-06-13T00:00:00.000Z",
    updatedAt: "2026-06-13T00:00:00.000Z",
    retired: false,
    ...overrides,
  };
}

function conceptReviewItem() {
  return reviewItem({
    id: "M01-c1",
    kind: "concept",
    text: "нутриент и продукт - разные уровни описания",
    questionNumber: undefined,
  });
}

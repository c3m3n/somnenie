import { describe, expect, it } from "vitest";
import { parseQuiz } from "./quiz";

describe("parseQuiz", () => {
  it("parses MCQ, true-false, application and sourceBlock metadata", () => {
    const questions = parseQuiz([
      "## Q1 (MCQ)",
      "**sourceBlock:** theory",
      "Which level?",
      "A. Molecule",
      "B. Product",
      "C. Diet",
      "D. Habit",
      "**Правильный ответ: B**",
      "**Объяснение:** Product level.",
      "---",
      "## Q2 (True/False)",
      "Evidence is always absolute.",
      "**Правильный ответ: НЕВЕРНО**",
      "**Объяснение:** Confidence has levels.",
      "---",
      "## Q3 (Применение)",
      "**sourceBlock: practice**",
      "Explain in your own words.",
      "**Ответ и разбор:** Use hierarchy.",
    ].join("\n"));
    expect(questions).toHaveLength(3);
    expect(questions.map((question) => question.kind)).toEqual(["auto", "auto", "application"]);
    expect(questions[0].answer).toBe("B");
    expect(questions[0].sourceBlock).toBe("theory");
    expect(questions[0].text).not.toMatch(/sourceBlock/i);
    expect(questions[1].answer).toBe(false);
    expect(questions[2].sourceBlock).toBe("practice");
  });

  it("drops malformed auto questions instead of guessing", () => {
    const questions = parseQuiz("## Q1 (MCQ)\nA. One\nB. Two\n**Правильный ответ: D**");
    expect(questions).toEqual([]);
  });
});

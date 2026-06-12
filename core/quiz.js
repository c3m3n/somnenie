(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.NutrioQuiz = api;
  if (root && root.window) root.window.NutrioQuiz = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Источник истины для разбора test-файлов (content/MXX/quiz.md).
  // Чистые функции без DOM: текст -> структура вопроса. Рендер живёт в app.js.

  function parseQuiz(md) {
    if (!md) return [];

    const blocks = String(md).split(/\r?\n---+\r?\n/);
    const questions = [];

    for (const block of blocks) {
      const head = block.match(/^##\s*Q(\d+)\s*\(([^)]+)\)\s*$/m);
      if (!head) continue;

      const number = Number(head[1]);
      const rawType = head[2].trim();
      const body = block.slice(head.index + head[0].length).trim();

      if (rawType === "MCQ" || rawType === "True/False") {
        const q = parseAutoQuestion(number, rawType, body);
        if (q) questions.push(q);
      } else if (rawType === "Применение") {
        const q = parseApplicationQuestion(number, body);
        if (q) questions.push(q);
      }
    }

    return questions;
  }

  function parseAutoQuestion(number, type, body) {
    const answerMatch = body.match(/\*\*Правильный ответ:\s*(.+?)\*\*/);
    if (!answerMatch) return null;

    const beforeAnswer = body.slice(0, answerMatch.index).trim();
    const answerRaw = answerMatch[1].trim();
    const explainMatch = body.match(/\*\*Объяснение:\*\*\s*([\s\S]*)$/);
    const explain = explainMatch ? explainMatch[1].trim() : "";

    let answer = null;
    let options = [];
    let text = beforeAnswer;

    if (type === "MCQ") {
      options = Array.from(beforeAnswer.matchAll(/^([A-D])\.\s+(.+)$/gm), (m) => ({
        key: m[1],
        text: m[2].trim(),
      }));
      text = beforeAnswer.replace(/^([A-D])\.\s+.+$/gm, "").trim();

      const letter = answerRaw.match(/^([A-D])/i);
      answer = letter ? letter[1].toUpperCase() : null;
      if (!options.some((opt) => opt.key === answer)) return null;
    } else {
      text = beforeAnswer.trim();
      options = [{ key: true, text: "Верно" }, { key: false, text: "Неверно" }];
      if (/НЕВЕРНО|False/i.test(answerRaw)) answer = false;
      else if (/ВЕРНО|True/i.test(answerRaw)) answer = true;
    }

    if (answer === null || !text) return null;
    return { kind: "auto", number, type, text, options, answer, explain };
  }

  function parseApplicationQuestion(number, body) {
    const answerMatch = body.match(/\*\*Ответ и разбор:\*\*\s*/);
    const text = answerMatch ? body.slice(0, answerMatch.index).trim() : body.trim();
    const explain = answerMatch ? body.slice(answerMatch.index + answerMatch[0].length).trim() : "";

    if (!text) return null;
    return { kind: "application", number, type: "Применение", text, explain };
  }

  return {
    parseQuiz,
    parseAutoQuestion,
    parseApplicationQuestion,
  };
});

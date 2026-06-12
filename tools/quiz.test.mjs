import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const quiz = require("../core/quiz.js");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.dirname(__dirname);

test("parses the M01 quiz contract", async () => {
  const md = await fs.readFile(path.join(projectRoot, "content", "M01", "quiz.md"), "utf8");
  const questions = quiz.parseQuiz(md);

  assert.equal(questions.length, 10);
  assert.equal(questions.filter((q) => q.kind === "auto").length, 7);
  assert.equal(questions.filter((q) => q.kind === "application").length, 3);
  assert.equal(questions[0].number, 1);
  assert.equal(questions[0].type, "MCQ");
  assert.equal(questions[0].options.length, 4);
  assert.ok(questions[0].answer);
  assert.ok(questions[0].explain.length > 20);
});

test("parses supported quiz block types", () => {
  const md = `## Q1 (MCQ)
На каком уровне задан вопрос?

A. Уровень нутриента
B. Уровень продукта
C. Уровень рациона
D. Уровень энергии

**Правильный ответ: B**
**Объяснение:** Вопрос сравнивает два продукта.

---

## Q2 (True/False)
Нутриент и продукт - одно и то же.

**Правильный ответ: Неверно**
**Объяснение:** Это разные уровни анализа.

---

## Q3 (Применение)
Объясните разницу между продуктом и рационом.

**Ответ и разбор:**
Продукт - отдельная еда, рацион - набор продуктов за период.`;

  const questions = quiz.parseQuiz(md);

  assert.equal(questions.length, 3);
  assert.deepEqual(questions.map((q) => q.kind), ["auto", "auto", "application"]);
  assert.equal(questions[0].answer, "B");
  assert.equal(questions[1].answer, false);
  assert.equal(questions[2].type, "Применение");
  assert.match(questions[2].explain, /рацион/);
});

import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const contentRoot = path.join(root, "content");
const ALLOWED_TYPES = new Set(["MCQ", "True/False", "Применение"]);
const RAW_HTML = /<[A-Za-z][^>]*>/;

const errors = [];
const fail = (message) => errors.push(message);

async function readText(file) {
  return fs.readFile(file, "utf8");
}

async function readJson(file) {
  return JSON.parse(await readText(path.join(root, file)));
}

async function listModuleDirs(courseDir) {
  const entries = await fs.readdir(courseDir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

function validateMcq(label, body) {
  const options = [...body.matchAll(/^([A-D])\.\s+(.+)$/gm)];
  if (options.length !== 4) fail(`${label} must have exactly 4 MCQ options (found ${options.length})`);
  const letters = new Set();
  const texts = new Set();
  for (const [, letter, text] of options) {
    if (letters.has(letter)) fail(`${label} has duplicate MCQ option letter: ${letter}`);
    letters.add(letter);
    const normalized = text.trim().toLowerCase();
    if (texts.has(normalized)) fail(`${label} has duplicate MCQ option text: ${text.trim()}`);
    texts.add(normalized);
  }
  const answer = body.match(/\*\*Правильный ответ:\s*([A-D])\b[^*]*\*\*/);
  if (!answer) fail(`${label} is missing MCQ answer letter`);
  else if (!letters.has(answer[1])) fail(`${label} answer '${answer[1]}' has no matching option`);
  if (!/\*\*Объяснение:\*\*/.test(body)) fail(`${label} is missing explanation`);
}

function validateTrueFalse(label, body) {
  if (!/\*\*Правильный ответ:\s*(ВЕРНО|НЕВЕРНО|True|False)/.test(body)) fail(`${label} is missing True/False answer`);
  if (!/\*\*Объяснение:\*\*/.test(body)) fail(`${label} is missing explanation`);
}

function validateApplication(label, body) {
  if (!/\*\*Ответ и разбор:\*\*/.test(body)) fail(`${label} is missing answer review block`);
}

function validateQuiz(moduleName, quiz, config) {
  const blocks = quiz.split(/\r?\n---+/);
  const seen = new Set();
  let total = 0;
  let auto = 0;
  let application = 0;

  for (const block of blocks) {
    const head = block.match(/^##\s*Q(\d+)\s*\(([^)]+)\)\s*$/m);
    if (!head) continue;
    total += 1;
    const number = Number(head[1]);
    const type = head[2].trim();
    const body = block.slice(head.index + head[0].length).trim();
    const label = `${moduleName}/quiz.md Q${number}`;

    if (seen.has(number)) fail(`${label} duplicates question number Q${number}`);
    seen.add(number);
    if (number < 1 || number > config.maxQuestions) fail(`${label} question number must be in Q1..Q${config.maxQuestions}`);
    if (!ALLOWED_TYPES.has(type)) {
      fail(`${label} uses unsupported type: ${type}`);
      continue;
    }

    if (type === "MCQ") {
      auto += 1;
      validateMcq(label, body);
    } else if (type === "True/False") {
      auto += 1;
      validateTrueFalse(label, body);
    } else {
      application += 1;
      validateApplication(label, body);
    }
  }

  if (total !== config.totalQuestions) fail(`${moduleName}/quiz.md must have exactly ${config.totalQuestions} questions; found ${total}`);
  if (auto !== config.autoQuestions) fail(`${moduleName}/quiz.md must have exactly ${config.autoQuestions} automatic questions; found ${auto}`);
  if (application !== config.applicationQuestions) fail(`${moduleName}/quiz.md must have exactly ${config.applicationQuestions} application questions; found ${application}`);
  for (let expected = 1; expected <= config.totalQuestions; expected += 1) {
    if (!seen.has(expected)) fail(`${moduleName}/quiz.md is missing Q${expected}`);
  }
  return { total, auto, application };
}

async function validateModule(courseId, moduleName, moduleDir, moduleFiles, quizConfig) {
  if (!/^M\d{2}$/.test(moduleName)) fail(`Unexpected module directory name: ${courseId}/${moduleName}`);
  const counts = { total: 0, auto: 0, application: 0 };

  for (const fileName of moduleFiles) {
    const filePath = path.join(moduleDir, fileName);
    let raw;
    try {
      raw = await readText(filePath);
    } catch {
      fail(`Missing required file: ${courseId}/${moduleName}/${fileName}`);
      continue;
    }
    if (RAW_HTML.test(raw)) fail(`Raw HTML is not allowed: ${courseId}/${moduleName}/${fileName}`);
    if (fileName === "quiz.md") Object.assign(counts, validateQuiz(`${courseId}/${moduleName}`, raw, quizConfig));
  }
  return counts;
}

function inferQuizConfig(manifest, courseId) {
  const defaults = { totalQuestions: 10, autoQuestions: 7, applicationQuestions: 3, maxQuestions: 10 };
  if (manifest.quizConfig && typeof manifest.quizConfig === "object") {
    return {
      totalQuestions: Number(manifest.quizConfig.totalQuestions) || defaults.totalQuestions,
      autoQuestions: Number(manifest.quizConfig.autoQuestions) || defaults.autoQuestions,
      applicationQuestions: Number(manifest.quizConfig.applicationQuestions) || defaults.applicationQuestions,
      maxQuestions: Number(manifest.quizConfig.maxQuestions) || defaults.maxQuestions,
    };
  }
  return defaults;
}

async function validateCourse(courseId) {
  const courseDir = path.join(contentRoot, courseId);
  for (const file of ["manifest.json", "course.json", "claims.json"]) {
    const relative = `content/${courseId}/${file}`;
    try {
      await fs.access(path.join(root, relative));
      const parsed = await readJson(relative);
      if (!parsed || typeof parsed !== "object") fail(`${relative} must be a valid JSON object`);
    } catch (error) {
      fail(`${relative} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const manifest = await readJson(`content/${courseId}/manifest.json`);
  if (manifest.courseId !== courseId) {
    fail(`content/${courseId}/manifest.json courseId mismatch: expected ${courseId}, got ${manifest.courseId}`);
  }
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    fail(`content/${courseId}/manifest.json should define at least one module`);
  }

  const moduleFiles = Array.isArray(manifest.moduleFiles) && manifest.moduleFiles.length
    ? manifest.moduleFiles
    : ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"];

  if (!moduleFiles.includes("quiz.md")) {
    fail(`content/${courseId}/manifest.json moduleFiles must include quiz.md`);
  }

  const moduleDirs = await listModuleDirs(courseDir);
  const manifestIds = new Set((manifest.modules || []).map((module) => module.id));
  for (const id of manifestIds) {
    if (!moduleDirs.includes(id)) fail(`${courseId}: manifest module ${id} has no content directory`);
  }
  for (const dir of moduleDirs) {
    if (/^M\d{2}$/.test(dir) && !manifestIds.has(dir)) fail(`${courseId}: content directory ${dir} is not listed in the manifest`);
  }

  const quizConfig = inferQuizConfig(manifest, courseId);
  const totals = { modules: 0, questions: 0, auto: 0, application: 0 };
  for (const dir of moduleDirs) {
    if (!/^M\d{2}$/.test(dir)) continue;
    const counts = await validateModule(courseId, dir, path.join(courseDir, dir), moduleFiles, quizConfig);
    totals.modules += 1;
    totals.questions += counts.total;
    totals.auto += counts.auto;
    totals.application += counts.application;
  }
  return totals;
}

// Validate catalog.
try {
  const catalog = await readJson("content/catalog.json");
  if (!Array.isArray(catalog.courses) || catalog.courses.length === 0) {
    fail("content/catalog.json should define at least one course");
  }
  for (const course of catalog.courses) {
    if (!course.id || typeof course.id !== "string") fail("content/catalog.json course missing id");
    if (!course.manifest || typeof course.manifest !== "string") fail(`content/catalog.json course ${course.id} missing manifest`);
  }
} catch (error) {
  fail(`content/catalog.json is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
}

const courseDirs = (await fs.readdir(contentRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const grandTotals = { modules: 0, questions: 0, auto: 0, application: 0 };
for (const courseId of courseDirs) {
  const totals = await validateCourse(courseId);
  console.log(`${courseId}: modules ${totals.modules}, questions ${totals.questions} (${totals.auto} automatic, ${totals.application} application).`);
  grandTotals.modules += totals.modules;
  grandTotals.questions += totals.questions;
  grandTotals.auto += totals.auto;
  grandTotals.application += totals.application;
}

if (errors.length) {
  for (const message of errors) console.error(`  - ${message}`);
  console.error(`Content validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`Content validation passed. Total modules: ${grandTotals.modules}, questions: ${grandTotals.questions} (${grandTotals.auto} automatic, ${grandTotals.application} application).`);

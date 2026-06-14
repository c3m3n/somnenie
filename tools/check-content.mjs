import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const contentRoot = path.join(root, "content");
const REQUIRED_FILES = ["theory.md", "terms.md", "quiz.md", "practice.md", "diagrams.md", "summary.md"];
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

async function listModuleDirs() {
  const entries = await fs.readdir(contentRoot, { withFileTypes: true });
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

function validateQuiz(moduleName, quiz) {
  const blocks = quiz.split(/\r?\n---+\r?\n/);
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
    if (number < 1 || number > 10) fail(`${label} question number must be in Q1..Q10`);
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

  if (total !== 10) fail(`${moduleName}/quiz.md must have exactly 10 questions; found ${total}`);
  if (auto !== 7) fail(`${moduleName}/quiz.md must have exactly 7 automatic questions; found ${auto}`);
  if (application !== 3) fail(`${moduleName}/quiz.md must have exactly 3 application questions; found ${application}`);
  for (let expected = 1; expected <= 10; expected += 1) {
    if (!seen.has(expected)) fail(`${moduleName}/quiz.md is missing Q${expected}`);
  }
  return { total, auto, application };
}

async function validateModule(moduleName) {
  if (!/^M\d{2}$/.test(moduleName)) fail(`Unexpected module directory name: ${moduleName}`);
  const moduleDir = path.join(contentRoot, moduleName);
  const counts = { total: 0, auto: 0, application: 0 };

  for (const fileName of REQUIRED_FILES) {
    const filePath = path.join(moduleDir, fileName);
    let raw;
    try {
      raw = await readText(filePath);
    } catch {
      fail(`Missing required file: ${moduleName}/${fileName}`);
      continue;
    }
    if (RAW_HTML.test(raw)) fail(`Raw HTML is not allowed: ${moduleName}/${fileName}`);
    if (fileName === "quiz.md") Object.assign(counts, validateQuiz(moduleName, raw));
  }
  return counts;
}

// JSON contracts.
for (const file of ["content/manifest.json", "content/course.json", "content/claims.json"]) {
  try {
    await fs.access(path.join(root, file));
    const parsed = await readJson(file);
    if (!parsed || typeof parsed !== "object") fail(`${file} must be a valid JSON object`);
  } catch (error) {
    fail(`${file} is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const manifest = await readJson("content/manifest.json");
if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
  fail("content/manifest.json should define at least one module");
}

// Module directories must match the manifest, and every quiz must satisfy the runtime contract.
const moduleDirs = await listModuleDirs();
const manifestIds = new Set((manifest.modules || []).map((module) => module.id));
for (const id of manifestIds) {
  if (!moduleDirs.includes(id)) fail(`Manifest module ${id} has no content directory`);
}
for (const dir of moduleDirs) {
  if (/^M\d{2}$/.test(dir) && !manifestIds.has(dir)) fail(`Content directory ${dir} is not listed in the manifest`);
}

const totals = { modules: 0, questions: 0, auto: 0, application: 0 };
for (const dir of moduleDirs) {
  const counts = await validateModule(dir);
  totals.modules += 1;
  totals.questions += counts.total;
  totals.auto += counts.auto;
  totals.application += counts.application;
}

if (errors.length) {
  for (const message of errors) console.error(`  - ${message}`);
  console.error(`Content validation failed with ${errors.length} error(s).`);
  process.exit(1);
}

console.log(`Content validation passed. Modules: ${totals.modules}, questions: ${totals.questions} (${totals.auto} automatic, ${totals.application} application).`);

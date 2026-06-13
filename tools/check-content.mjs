import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const required = ["content/manifest.json", "content/course.json", "content/claims.json"];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(file) {
  const raw = await fs.readFile(path.join(root, file), "utf8");
  return JSON.parse(raw);
}

for (const file of required) {
  const absolute = path.join(root, file);
  await fs.access(absolute);
  const parsed = await readJson(file);
  assert(parsed && typeof parsed === "object", `${file} must be a valid JSON object`);
}

const manifest = await readJson("content/manifest.json");
assert(Array.isArray(manifest.modules), "content/manifest.json should define modules");
assert(manifest.modules.length > 0, "content manifest should include at least one module");
console.log("Content manifest check passed.");

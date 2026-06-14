import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

async function readJson(file) {
  const raw = await fs.readFile(path.join(root, file), "utf8");
  return JSON.parse(raw);
}

const catalog = await readJson("content/catalog.json");
if (!Array.isArray(catalog.courses) || catalog.courses.length === 0) {
  throw new Error("content/catalog.json must define at least one course");
}

for (const course of catalog.courses) {
  if (!course.id || typeof course.id !== "string") {
    throw new Error("content/catalog.json course missing id");
  }
  const requiredArtifacts = [
    `content/${course.id}/manifest.json`,
    `content/${course.id}/course.json`,
    `content/${course.id}/claims.json`,
  ];
  for (const item of requiredArtifacts) {
    const absolute = path.join(root, item);
    await fs.access(absolute);
  }

  const manifest = await readJson(`content/${course.id}/manifest.json`);
  if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
    throw new Error(`Manifest for ${course.id} has no modules`);
  }
}

console.log("[check-legacy] Required course artifacts exist for all catalog courses.");
console.log("[check-legacy] Legacy validation passed.");

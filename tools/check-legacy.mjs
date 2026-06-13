import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const requiredArtifacts = ["content/manifest.json", "content/course.json", "content/claims.json"];

for (const item of requiredArtifacts) {
  const absolute = path.join(root, item);
  await fs.access(absolute);
}

console.log("[check-legacy] Required course artifacts exist.");

const manifestRaw = await fs.readFile(path.join(root, "content/manifest.json"), "utf8");
const manifest = JSON.parse(manifestRaw);
if (!Array.isArray(manifest.modules) || manifest.modules.length === 0) {
  throw new Error("Manifest has no modules");
}

console.log("[check-legacy] Legacy validation passed.");

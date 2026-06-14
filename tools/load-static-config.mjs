import { readFile } from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";

export async function loadStaticConfig(root = process.cwd()) {
  const filePath = path.join(root, "web", "src", "build", "static-config.ts");
  const source = await readFile(filePath, "utf8");
  const result = await transform(source, { loader: "ts", format: "esm", target: "es2022" });
  const href = `data:text/javascript;base64,${Buffer.from(result.code).toString("base64")}`;
  return import(href);
}

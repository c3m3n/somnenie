import { clearContentCaches } from "../../content/api";
import { clearQuizCache } from "../../domain/quiz";
import { clearMarkdownCache } from "../../ui/markdown";

export function clearCaches(): void {
  clearContentCaches();
  clearQuizCache();
  clearMarkdownCache();
}

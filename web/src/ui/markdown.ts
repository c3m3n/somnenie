import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import { marked } from "marked";

marked.use({
  async: false,
  gfm: true,
});

export function renderMarkdown(text: string): string {
  return String(DOMPurify.sanitize(marked.parse(String(text || ""), { async: false }), sanitizerConfig()));
}

export function renderInlineMarkdown(text: string): string {
  return String(DOMPurify.sanitize(marked.parseInline(String(text || ""), { async: false }), sanitizerConfig()));
}

export function plainText(text: string): string {
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizerConfig(): Config {
  return {
    ALLOWED_TAGS: ["p", "strong", "em", "ul", "ol", "li", "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "a", "hr", "br"],
    ALLOWED_ATTR: ["href", "title"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  };
}

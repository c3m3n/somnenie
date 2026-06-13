import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import { marked } from "marked";

marked.use({
  async: false,
  gfm: true,
});

export function renderMarkdown(text: string): string {
  return enhanceTables(String(DOMPurify.sanitize(marked.parse(String(text || ""), { async: false }), sanitizerConfig())));
}

export function renderInlineMarkdown(text: string): string {
  return String(DOMPurify.sanitize(marked.parseInline(String(text || ""), { async: false }), sanitizerConfig()));
}

function sanitizerConfig(): Config {
  return {
    ALLOWED_TAGS: ["p", "strong", "em", "ul", "ol", "li", "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "a", "hr", "br"],
    ALLOWED_ATTR: ["href", "title"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  };
}

function enhanceTables(html: string): string {
  if (typeof document === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const table of Array.from(template.content.querySelectorAll("table"))) {
    const headers = Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent?.trim() || "");
    if (!headers.length) continue;
    table.classList.add("responsive-table");
    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      Array.from(row.querySelectorAll("td")).forEach((cell, index) => {
        cell.setAttribute("data-label", headers[index] || "");
      });
    }
  }
  return template.innerHTML;
}

import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import { marked } from "marked";
import { LRUCache } from "../shared/utils/LRUCache";

const markdownCache = new LRUCache<string, string>(200);

marked.use({
  async: false,
  gfm: true,
});

export function renderMarkdown(text: string): string {
  const normalized = String(text || "");
  const key = `m:${normalized}`;
  const cached = markdownCache.get(key);
  if (cached) return cached;
  const rendered = enhanceTables(String(DOMPurify.sanitize(marked.parse(normalized, { async: false }), sanitizerConfig())));
  markdownCache.set(key, rendered);
  return rendered;
}

export function renderInlineMarkdown(text: string): string {
  const normalized = String(text || "");
  const key = `i:${normalized}`;
  const cached = markdownCache.get(key);
  if (cached) return cached;
  const rendered = String(DOMPurify.sanitize(marked.parseInline(normalized, { async: false }), sanitizerConfig()));
  markdownCache.set(key, rendered);
  return rendered;
}

export function clearMarkdownCache(): void {
  markdownCache.clear();
}

function sanitizerConfig(): Config {
  return {
    ALLOWED_TAGS: ["p", "strong", "em", "ul", "ol", "li", "blockquote", "code", "pre", "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td", "a", "hr", "br"],
    ALLOWED_ATTR: ["href", "title", "target", "rel"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|#|\/(?!\/)|\.\/|\.\.\/)/i,
  };
}

function enhanceTables(html: string): string {
  if (typeof document === "undefined") return html;
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  for (const table of Array.from(parsed.querySelectorAll("table"))) {
    const headers = Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent?.trim() || "");
    if (!headers.length) continue;
    table.classList.add("responsive-table");
    for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
      Array.from(row.querySelectorAll("td")).forEach((cell, index) => {
        cell.setAttribute("data-label", headers[index] || "");
      });
    }
  }
  for (const anchor of Array.from(parsed.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") || "";
    if (/^(https?:\/\/|mailto:|tel:)/i.test(href) || anchor.getAttribute("target") === "_blank") {
      anchor.setAttribute("rel", "noopener noreferrer");
    }
  }
  return parsed.body.innerHTML;
}

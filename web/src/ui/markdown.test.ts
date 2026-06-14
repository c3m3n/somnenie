import { describe, expect, it } from "vitest";
import { clearMarkdownCache, renderInlineMarkdown, renderMarkdown } from "./markdown";

describe("markdown rendering security", () => {
  it("blocks javascript links", () => {
    clearMarkdownCache();
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("href=");
  });

  it("blocks data links", () => {
    expect(renderMarkdown("[x](data:text/html,evil)")).not.toContain("href=");
  });

  it("blocks vbscript links", () => {
    const html = renderMarkdown("[x](vbscript:msgbox(1))");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("vbscript:");
  });

  it("blocks file links", () => {
    const html = renderMarkdown("[x](file:///C:/secret.txt)");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("file:");
  });

  it("blocks protocol-relative links", () => {
    const html = renderMarkdown("[x](//evil.com/path)");
    expect(html).not.toContain("href=");
    expect(html).not.toContain("//evil.com");
  });

  it("allows https links", () => {
    expect(renderMarkdown("[x](https://example.com)")).toContain('href="https://example.com"');
  });

  it("allows http links", () => {
    expect(renderMarkdown("[x](http://example.com)")).toContain('href="http://example.com"');
  });

  it("allows mailto links", () => {
    expect(renderMarkdown("[x](mailto:test@example.com)")).toContain('href="mailto:test@example.com"');
  });

  it("allows tel links", () => {
    expect(renderMarkdown("[x](tel:+123456789)")).toContain('href="tel:+123456789"');
  });

  it("allows root-relative links", () => {
    expect(renderMarkdown("[x](/content/M01/theory.md)")).toContain('href="/content/M01/theory.md"');
  });

  it("allows dot-relative links", () => {
    expect(renderMarkdown("[x](./terms.md)")).toContain('href="./terms.md"');
  });

  it("allows parent-relative links", () => {
    expect(renderMarkdown("[x](../course.json)")).toContain('href="../course.json"');
  });

  it("allows hash links", () => {
    expect(renderMarkdown("[x](#section)")).toContain('href="#section"');
  });

  it("adds responsive table labels", () => {
    const html = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("responsive-table");
    expect(html).toContain('data-label="A"');
  });

  it("sanitizes raw html in inline markdown", () => {
    expect(renderInlineMarkdown("<img src=x onerror=alert(1)> **ok**")).not.toContain("onerror");
    expect(renderInlineMarkdown("<a href=\"/ok\" onclick=\"alert(1)\">ok</a>")).not.toContain("onclick");
    expect(renderInlineMarkdown("**ok**")).toContain("<strong>ok</strong>");
  });

  it("does not allow script tags", () => {
    const html = renderMarkdown("<script>alert(1)</script>\n\nSafe");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("Safe");
  });
});

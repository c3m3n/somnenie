import { renderMarkdown, renderInlineMarkdown } from "./markdown";

type HtmlTag = "div" | "span" | "article" | "section" | "p";

export function Md({ children, as: Tag = "div", className }: { children: string; as?: HtmlTag; className?: string }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: renderMarkdown(children) }} />;
}

export function MdInline({ children, as: Tag = "span", className }: { children: string; as?: HtmlTag; className?: string }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(children) }} />;
}

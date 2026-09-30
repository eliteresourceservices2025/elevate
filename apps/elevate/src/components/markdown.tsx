import type { ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "@/lib/markdown";

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.type) {
      case "text":
        return n.text;
      case "strong":
        return <strong key={i}>{renderInline(n.children)}</strong>;
      case "em":
        return <em key={i}>{renderInline(n.children)}</em>;
      case "code":
        return (
          <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {n.text}
          </code>
        );
      case "link":
        return (
          <a
            key={i}
            href={n.href}
            {...(n.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="text-primary underline underline-offset-4"
          >
            {renderInline(n.children)}
          </a>
        );
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.type) {
    case "heading": {
      const Tag = `h${b.level}` as "h2" | "h3" | "h4";
      const size = b.level === 2 ? "text-lg" : b.level === 3 ? "text-base" : "text-sm";
      return (
        <Tag key={i} className={`${size} mt-4 font-semibold first:mt-0`}>
          {renderInline(b.children)}
        </Tag>
      );
    }
    case "paragraph":
      return <p key={i}>{renderInline(b.children)}</p>;
    case "quote":
      return (
        <blockquote key={i} className="border-l-2 border-primary/40 pl-3 text-muted-foreground">
          {renderInline(b.children)}
        </blockquote>
      );
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag key={i} className={`${b.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5`}>
          {b.items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </Tag>
      );
    }
  }
}

/** Renders announcement and policy text. Safe by construction: see src/lib/markdown.ts. */
export function Markdown({ source }: { source: string }) {
  return <div className="space-y-3 text-sm leading-relaxed">{parseMarkdown(source).map(renderBlock)}</div>;
}

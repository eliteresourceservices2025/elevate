import type { Block } from "../../../../../learn/src/content/schema";
import type { LintIssue } from "../studio-lint";

/** A block as plain, readable text (the studio's read-only view and the diff pages). Never HTML: everything is a React element. */
export function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case "paragraph":
      return <p className="text-sm">{block.text}</p>;
    case "list":
      return block.ordered ? (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm">{block.items.map((t, i) => <li key={i}>{t}</li>)}</ol>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">{block.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
      );
    case "callout":
      return (
        <p className="rounded-md border-l-4 border-primary/50 bg-secondary/40 p-2 text-sm">
          <strong className="uppercase">{block.tone}</strong>
          {block.title ? <strong>: {block.title}</strong> : null} {block.text}
        </p>
      );
    case "compare":
      return (
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          {[block.left, block.right].map((c) => (
            <div key={c.title}>
              <strong>{c.title}</strong>
              <ul className="list-disc pl-5">{c.items.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
      );
    case "steps":
      return (
        <ol className="list-decimal space-y-0.5 pl-5 text-sm">
          {block.items.map((s, i) => (
            <li key={i}>
              <strong>{s.title}:</strong> {s.text}
            </li>
          ))}
        </ol>
      );
    case "scenario":
      return (
        <div className="space-y-1 text-sm">
          <strong>Scenario: {block.title}</strong>
          <p>{block.prompt}</p>
          <ul className="list-disc pl-5">
            {block.choices.map((c, i) => (
              <li key={i}>
                {c.best ? <strong>(best) </strong> : null}
                {c.text} <span className="text-muted-foreground">{c.feedback}</span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "check":
      return (
        <div className="space-y-1 text-sm">
          <strong>Check: {block.question}</strong>
          <ul className="list-disc pl-5">
            {block.options.map((o, i) => (
              <li key={i}>
                {o.correct ? <strong>(correct) </strong> : null}
                {o.text} <span className="text-muted-foreground">{o.feedback}</span>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

export function LintList({ issues }: { issues: LintIssue[] }) {
  if (issues.length === 0) return <p className="text-sm text-muted-foreground">No problems found.</p>;
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <div className="space-y-2 text-sm">
      {errors.length > 0 ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <p className="font-medium">{errors.length} to fix before it can be saved or published</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{errors.map((i, n) => <li key={n}>{i.where}: {i.message}</li>)}</ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="font-medium">{warnings.length} to consider</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{warnings.map((i, n) => <li key={n}>{i.where}: {i.message}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}

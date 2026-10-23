import type { Block } from "../../../../../learn/src/content/schema";
import type { LintIssue } from "../studio-lint";
import { Alert } from "@/components/ui/alert";

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
    case "table":
      return (
        <div className="overflow-x-auto text-sm">
          {block.caption ? <p className="font-medium">{block.caption}</p> : null}
          <table className="w-full border-collapse">
            <thead>
              <tr>{block.columns.map((c, i) => <th key={i} className="border bg-secondary/40 p-1.5 text-left">{c}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((r, i) => (
                <tr key={i}>{r.map((cell, j) => <td key={j} className="border p-1.5 align-top">{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "layers":
      return (
        <div className="space-y-1 text-sm">
          <strong>Layers{block.title ? ": " + block.title : ""}</strong>
          <ul className="list-disc pl-5">{block.items.map((it, i) => <li key={i}><strong>{it.label}:</strong> {it.text}</li>)}</ul>
        </div>
      );
    case "timeline":
      return (
        <div className="space-y-1 text-sm">
          <strong>Timeline{block.title ? ": " + block.title : ""}</strong>
          <ol className="list-decimal pl-5">{block.items.map((it, i) => <li key={i}><strong>{it.when}:</strong> {it.text}</li>)}</ol>
        </div>
      );
    case "glossary":
      return (
        <div className="space-y-1 text-sm">
          <strong>Terms</strong>
          <ul className="list-disc pl-5">{block.terms.map((t, i) => <li key={i}><strong>{t.term}:</strong> {t.meaning}</li>)}</ul>
        </div>
      );
    case "case":
      return (
        <div className="space-y-1 text-sm">
          <strong>Case: {block.title}</strong>
          <p>{block.scenario}</p>
          <p><em>{block.question}</em></p>
          <p className="text-muted-foreground">Answer: {block.answer}</p>
        </div>
      );
    case "sort":
      return (
        <div className="space-y-1 text-sm">
          <strong>Sort it: {block.title}</strong>
          <p>{block.prompt}</p>
          <ol className="list-decimal pl-5">{block.items.map((t, i) => <li key={i}>{t}</li>)}</ol>
          <p className="text-muted-foreground">{block.explanation}</p>
        </div>
      );
    case "cards":
      return (
        <div className="space-y-1 text-sm">
          <strong>Cards: {block.title}</strong> <span className="text-muted-foreground">({block.groups.join(" / ")})</span>
          <p>{block.prompt}</p>
          <ul className="list-disc pl-5">{block.cards.map((c, i) => <li key={i}>{c.text} <strong>→ {block.groups[c.group]}</strong> <span className="text-muted-foreground">{c.feedback}</span></li>)}</ul>
        </div>
      );
    case "spot":
      return (
        <div className="space-y-1 text-sm">
          <strong>Spot the mistake: {block.title}</strong>
          <p>{block.prompt}</p>
          <ul className="list-disc pl-5">{block.lines.map((l, i) => <li key={i}>{l.wrong ? <strong>(mistake) </strong> : null}{l.speaker}: {l.text}</li>)}</ul>
          <p className="text-muted-foreground">{block.explanation}</p>
        </div>
      );
    case "flip":
      return (
        <div className="space-y-1 text-sm">
          <strong>Flip cards{block.title ? ": " + block.title : ""}</strong>
          <ul className="list-disc pl-5">{block.cards.map((c, i) => <li key={i}><strong>{c.front}:</strong> {c.back}</li>)}</ul>
        </div>
      );
    case "build":
      return (
        <div className="space-y-1 text-sm">
          <strong>Build it: {block.title}</strong>
          <p>{block.prompt}</p>
          {block.slots.map((s, i) => (
            <div key={i}>
              <em>{s.label}</em>
              <ul className="list-disc pl-5">{s.options.map((o, j) => <li key={j}>{o.correct ? <strong>(right) </strong> : null}{o.text}</li>)}</ul>
            </div>
          ))}
        </div>
      );
    case "branch":
      return (
        <div className="space-y-1 text-sm">
          <strong>Call: {block.title}</strong>
          <p>{block.intro}</p>
          {block.turns.map((t, i) => (
            <div key={i}>
              <em>Caller: {t.caller}</em>
              <ul className="list-disc pl-5">{t.choices.map((c, j) => <li key={j}>{c.text} <strong>({c.mood > 0 ? "+" : ""}{c.mood})</strong> <span className="text-muted-foreground">{c.reply}</span></li>)}</ul>
            </div>
          ))}
        </div>
      );
    case "game":
      return (
        <div className="space-y-1 text-sm">
          <strong>Quiz game: {block.title}</strong>{block.seconds ? <span className="text-muted-foreground"> ({block.seconds}s per round)</span> : null}
          {block.rounds.map((r, i) => (
            <div key={i}>
              <em>{r.question}</em>
              <ul className="list-disc pl-5">{r.options.map((o, j) => <li key={j}>{o.correct ? <strong>(right) </strong> : null}{o.text}</li>)}</ul>
            </div>
          ))}
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
        <Alert variant="destructive" role="alert" className="rounded-lg p-3">
          <p className="font-medium">{errors.length} to fix before it can be saved or published</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{errors.map((i, n) => <li key={n}>{i.where}: {i.message}</li>)}</ul>
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <Alert variant="warning" role="note" className="rounded-lg p-3">
          <p className="font-medium">{warnings.length} to consider</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{warnings.map((i, n) => <li key={n}>{i.where}: {i.message}</li>)}</ul>
        </Alert>
      ) : null}
    </div>
  );
}

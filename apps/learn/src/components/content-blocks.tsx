"use client";

import { Fragment, useState } from "react";
import type { Block } from "@/content/schema";

// Renders lesson blocks as React elements. There is no HTML anywhere: text is plain, and **double asterisks** make bold text.

function Inline({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

function Scenario({ block }: { block: Extract<Block, { type: "scenario" }> }) {
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <section className="block scenario" aria-label={block.title}>
      <h3>{block.title}</h3>
      <p>
        <Inline text={block.prompt} />
      </p>
      <div role="group" aria-label="Choices" className="choices">
        {block.choices.map((c, i) => (
          <button key={i} type="button" className={`choice${picked === i ? (c.best ? " good" : " bad") : ""}`} aria-pressed={picked === i} onClick={() => setPicked(i)}>
            {c.text}
          </button>
        ))}
      </div>
      <div role="status" aria-live="polite">
        {picked !== null ? (
          <p className={`feedback ${block.choices[picked].best ? "good" : "bad"}`}>
            <strong>{block.choices[picked].best ? "Good choice. " : "Not quite. "}</strong>
            {block.choices[picked].best ? block.choices[picked].feedback.replace(/^Correct\.\s*/, "") : block.choices[picked].feedback}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CaseStudy({ block }: { block: Extract<Block, { type: "case" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="block casestudy" aria-label={block.title}>
      <h3>{block.title}</h3>
      <p>
        <strong>Scenario. </strong>
        <Inline text={block.scenario} />
      </p>
      <p>
        <strong>Question. </strong>
        <Inline text={block.question} />
      </p>
      <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide the answer" : "Show the answer"}
      </button>
      <div role="status" aria-live="polite">
        {open ? (
          <p className="feedback good">
            <strong>Answer. </strong>
            <Inline text={block.answer} />
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Check({ block }: { block: Extract<Block, { type: "check" }> }) {
  const [picked, setPicked] = useState<number[]>([]);
  const [shown, setShown] = useState(false);
  const toggle = (i: number) => {
    setShown(false);
    setPicked((p) => (block.multiple ? (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]) : [i]));
  };
  const allRight = block.options.every((o, i) => o.correct === picked.includes(i));
  return (
    <section className="block check" aria-label="Quick check">
      <h3>Quick check</h3>
      <p>
        <Inline text={block.question} />
      </p>
      <div role="group" aria-label={block.multiple ? "Select all that apply" : "Choose one"} className="choices">
        {block.options.map((o, i) => (
          <label key={i} className={`option${picked.includes(i) ? " picked" : ""}`}>
            <input type={block.multiple ? "checkbox" : "radio"} name={`check-${block.question.slice(0, 20)}`} checked={picked.includes(i)} onChange={() => toggle(i)} />
            <span>{o.text}</span>
          </label>
        ))}
      </div>
      <button type="button" onClick={() => setShown(true)} disabled={picked.length === 0}>
        Check my answer
      </button>
      <div role="status" aria-live="polite">
        {shown ? (
          <div className={`feedback ${allRight ? "good" : "bad"}`}>
            <p>
              <strong>{allRight ? "That is right." : "Not quite."}</strong>
            </p>
            <ul>
              {block.options.map((o, i) =>
                picked.includes(i) || o.correct ? (
                  <li key={i}>
                    <em>{o.text}</em>: {o.feedback}
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ContentBlocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case "paragraph":
            return (
              <p key={i}>
                <Inline text={block.text} />
              </p>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "callout":
            return (
              <aside key={i} className={`block callout ${block.tone}`}>
                {block.title ? <strong>{block.title}</strong> : null}
                <p>
                  <Inline text={block.text} />
                </p>
              </aside>
            );
          case "compare":
            return (
              <div key={i} className="block compare">
                {[block.left, block.right].map((side, s) => (
                  <section key={s} className={s === 0 ? "yes" : "no"}>
                    <h3>{side.title}</h3>
                    <ul>
                      {side.items.map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            );
          case "steps":
            return (
              <ol key={i} className="block steps">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <strong>{item.title}</strong> <span>{item.text}</span>
                  </li>
                ))}
              </ol>
            );
          case "scenario":
            return <Scenario key={i} block={block} />;
          case "case":
            return <CaseStudy key={i} block={block} />;
          case "table":
            return (
              <div key={i} className="block tablewrap">
                <table className="datatable">
                  {block.caption ? <caption>{block.caption}</caption> : null}
                  <thead>
                    <tr>
                      {block.columns.map((c, j) => (
                        <th key={j} scope="col">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (c === 0 ? (
                          <th key={c} scope="row">
                            <Inline text={cell} />
                          </th>
                        ) : (
                          <td key={c}>
                            <Inline text={cell} />
                          </td>
                        )))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "layers":
            return (
              <section key={i} className="block layers" aria-label={block.title ?? "Layers"}>
                {block.title ? <h3>{block.title}</h3> : null}
                <ul>
                  {block.items.map((item, j) => (
                    <li key={j}>
                      <strong>{item.label}</strong>
                      <span>
                        <Inline text={item.text} />
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          case "timeline":
            return (
              <section key={i} className="block timeline" aria-label={block.title ?? "Timeline"}>
                {block.title ? <h3>{block.title}</h3> : null}
                <ol>
                  {block.items.map((item, j) => (
                    <li key={j}>
                      <strong>{item.when}</strong>
                      <span>
                        <Inline text={item.text} />
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            );
          case "glossary":
            return (
              <section key={i} className="block glossary" aria-label="Terms in this module">
                <h3>Terms in this module</h3>
                <dl>
                  {block.terms.map((t, j) => (
                    <Fragment key={j}>
                      <dt>{t.term}</dt>
                      <dd>
                        <Inline text={t.meaning} />
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              </section>
            );
          case "check":
            return <Check key={i} block={block} />;
        }
      })}
    </>
  );
}

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
          case "check":
            return <Check key={i} block={block} />;
        }
      })}
    </>
  );
}

import { Fragment } from "react";

/** Plain text with **double asterisks** for bold. There is no HTML anywhere in lesson text. */
export function Inline({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>))}
    </>
  );
}

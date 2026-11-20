import { splitMentions } from "../mentions";

/** A message's text with @mentions shown as chips. Plain text only: nothing in a message is ever treated as HTML. */
export function MessageBody({ body, myUserId }: { body: string; myUserId: string }) {
  return (
    <>
      {splitMentions(body).map((part, i) =>
        "mention" in part ? (
          <span key={i} className={part.mention.userId === myUserId || part.mention.userId === "everyone" ? "rounded bg-accent px-1 font-semibold text-accent-foreground" : "rounded bg-secondary px-1 font-semibold text-secondary-foreground"}>
            @{part.mention.name}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

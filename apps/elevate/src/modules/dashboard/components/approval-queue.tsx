import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { daysSince } from "../attention";
import { getApprovalQueue } from "../feed-queries";
import { ApprovalRow } from "./approval-row";
import { guarded } from "./guard";

const SHOWN = 6;

/** Requests waiting for this person, oldest first. Each is decided with the same rules and checks as on its own page. */
export async function ApprovalQueue() {
  return guarded("Approval queue", async () => {
    const queue = await getApprovalQueue();
    if (queue.length === 0) return null;
    const now = new Date();
    const shown = queue.slice(0, SHOWN);
    const links = [...new Map(queue.map((q) => [q.kind, q.href])).values()];
    return (
      <section id="approvals" aria-label="Approval queue" className="scroll-mt-4 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CheckCheck className="size-5 text-primary" aria-hidden />
            Waiting for your decision <span className="text-sm font-normal text-muted-foreground">({queue.length})</span>
          </h2>
        </div>
        <ul className="space-y-2">
          {shown.map((item) => (
            <ApprovalRow key={item.key} item={item} waitedDays={daysSince(item.createdAt, now)} />
          ))}
        </ul>
        {queue.length > SHOWN ? (
          <p className="text-sm text-muted-foreground">
            {queue.length - SHOWN} more.{" "}
            {links.map((href, i) => (
              <span key={href}>
                {i > 0 ? " · " : ""}
                <Link href={href} className="text-primary underline-offset-4 hover:underline">
                  {href.startsWith("/time-off") ? "All time off requests" : href.startsWith("/attendance") ? "All corrections" : "All extra hours"}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </section>
    );
  });
}

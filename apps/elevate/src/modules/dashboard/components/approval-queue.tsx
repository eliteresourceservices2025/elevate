import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { daysSince } from "../attention";
import { getApprovalQueue } from "../feed-queries";
import { ApprovalRow } from "./approval-row";
import { guarded } from "./guard";
import { Panel, PanelList } from "./panel";

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
      <div id="approvals" className="scroll-mt-4">
        <Panel
          label="Approval queue"
          title={
            <>
              <CheckCheck className="size-5 text-primary" aria-hidden />
              Waiting for your decision
            </>
          }
          count={queue.length}
        >
          <PanelList>
            {shown.map((item) => (
              <ApprovalRow key={item.key} item={item} waitedDays={daysSince(item.createdAt, now)} />
            ))}
          </PanelList>
          {queue.length > SHOWN ? (
            <p className="border-t px-5 py-3 text-sm text-muted-foreground">
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
        </Panel>
      </div>
    );
  });
}

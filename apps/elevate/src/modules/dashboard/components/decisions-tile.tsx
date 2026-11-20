import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { KIND_LABEL } from "../approvals";
import { daysSince } from "../attention";
import { getApprovalQueue } from "../feed-queries";
import { orFallback } from "../or-fallback";
import { RowMeta, Tile, TileList, TileNote, TileRow } from "./bento";
import { guarded } from "./guard";

const SHOWN = 4;

/** Requests waiting for this person's decision, oldest first, with the count. Each opens the page where it is decided (same rules and checks as there). */
export async function DecisionsTile() {
  return guarded("Needs your decision", async () => {
    const queue = await orFallback(() => getApprovalQueue(), null);
    if (!queue) return null;
    const now = new Date();
    const shown = queue.slice(0, SHOWN);
    return (
      <Tile
        label="Needs your decision"
        title={
          <>
            Needs your decision
            {queue.length > 0 ? <span className="ml-1.5 rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">{queue.length}</span> : null}
          </>
        }
        icon={<CheckCheck className="size-4 text-primary" aria-hidden />}
        href="/approvals"
        hrefLabel="Approvals"
        tone="primary"
      >
        {queue.length === 0 ? (
          <TileNote>Nothing waiting for you.</TileNote>
        ) : (
          <TileList>
            {shown.map((item, i) => {
              const waited = daysSince(item.createdAt, now);
              return (
                <TileRow key={`${item.key}-${i}`}>
                  <span className="shrink-0 rounded-md bg-warning-surface px-1.5 py-0.5 text-xs text-warning">{KIND_LABEL[item.kind]}</span>
                  <Link href={item.href} className="min-w-0 flex-1 truncate rounded-sm outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                    {item.who}, {item.what}
                  </Link>
                  <RowMeta>{waited <= 0 ? "Today" : `${waited} d`}</RowMeta>
                </TileRow>
              );
            })}
          </TileList>
        )}
        {queue.length > shown.length ? <p className="mt-auto pt-1.5 text-xs text-muted-foreground">+ {queue.length - shown.length} more</p> : null}
      </Tile>
    );
  });
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { orNotFound } from "@/lib/or-not-found";
import { paginate, parsePaging } from "@/lib/pagination";
import { formatDateOnly } from "@/lib/time";
import { CycleControls } from "@/modules/reviews/components/review-forms";
import { CYCLE_LABELS, STAGE_LABELS, type CycleType } from "@/modules/reviews/constants";
import { getCycle } from "@/modules/reviews/queries";

export const metadata: Metadata = { title: "Review cycle" };

export default async function CyclePage({ params, searchParams }: PageProps<"/reviews/cycles/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const { cycle, reviews } = await orNotFound(getCycle(id));
  const paging = parsePaging({ page: one(sp.page), size: one(sp.size) });
  const { rows, info } = paginate(reviews, paging.page, paging.pageSize);

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/reviews" className="text-sm text-primary underline-offset-2 hover:underline">
          All reviews
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{cycle.name}</h1>
        <p className="text-muted-foreground">
          {CYCLE_LABELS[cycle.type as CycleType]}. Due: self {formatDateOnly(cycle.selfDueOn)}, lead {formatDateOnly(cycle.leadDueOn)}, calibration {formatDateOnly(cycle.calibrateDueOn)}. {cycle.status === "closed" ? "Closed." : ""}
        </p>
      </div>
      <CycleControls cycleId={cycle.id} open={cycle.status === "open"} />
      <div className="space-y-2">
        <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Where it stands</TableHead>
                <TableHead>Next step due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/reviews/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell>{STAGE_LABELS[r.stage]}</TableCell>
                  <TableCell>
                    {r.stage === "shared" || r.stage === "acknowledged" ? "" : formatDateOnly(r.dueOn)} {r.overdue ? <Badge variant="destructive">Late</Badge> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PagerLinks info={info} basePath={`/reviews/cycles/${cycle.id}`} label="reviews" />
      </div>
    </div>
  );
}

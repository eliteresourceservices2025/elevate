import type { Metadata } from "next";
import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { paginate, parsePaging } from "@/lib/pagination";
import { formatDateOnly } from "@/lib/time";
import { STAGE_LABELS } from "@/modules/reviews/constants";
import { getReviewSummary, listCycles, listReviews, type ReviewRow } from "@/modules/reviews/queries";

export const metadata: Metadata = { title: "Reviews" };

type Paging = { page: number; pageSize: number; pageKey: string; sizeKey: string; query: Record<string, string | undefined> };

function ReviewTable({ rows, paging, label }: { rows: ReviewRow[]; paging: Paging; label: string }) {
  const { rows: shown, info } = paginate(rows, paging.page, paging.pageSize);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Nothing here yet.</p>;
  return (
    <div className="space-y-2">
      <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Review</TableHead>
              <TableHead>Where it stands</TableHead>
              <TableHead>Next step due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link href={`/reviews/${r.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {r.mine ? "You" : r.name}
                  </Link>
                </TableCell>
                <TableCell>{r.cycleName}</TableCell>
                <TableCell>
                  {STAGE_LABELS[r.stage]} {r.toWrite ? <Badge className="ml-1">Yours to write</Badge> : null}
                </TableCell>
                <TableCell>
                  {r.stage === "shared" || r.stage === "acknowledged" ? "" : formatDateOnly(r.dueOn)} {r.overdue ? <Badge variant="destructive">Late</Badge> : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <PagerLinks info={info} basePath="/reviews" query={paging.query} pageKey={paging.pageKey} sizeKey={paging.sizeKey} label={label} />
    </div>
  );
}

export default async function ReviewsPage({ searchParams }: PageProps<"/reviews">) {
  const user = await requireUser();
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const hr = scopeFor(user, "reviews.manage_cycles") === "all";
  const summaryOnly = !hr && scopeFor(user, "reviews.view") === null && scopeFor(user, "reviews.summary") !== null;
  const rows = summaryOnly ? [] : await orNotFound(listReviews());
  const cycles = hr ? await orNotFound(listCycles()) : [];
  const summary = summaryOnly ? await orNotFound(getReviewSummary()) : [];
  const own = rows.filter((r) => r.mine);
  const others = rows.filter((r) => !r.mine);
  const q = { page: one(params.page), size: one(params.size), opage: one(params.opage), osize: one(params.osize) };
  const mineP = parsePaging({ page: q.page, size: q.size });
  const otherP = parsePaging({ page: q.opage, size: q.osize });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Reviews</h1>
          <p className="mt-1 text-muted-foreground">Self reviews, lead reviews and goals. Reviews record ratings and feedback only; ELEVATE never links them to pay.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Link href="/reviews/goals" className="text-primary underline-offset-2 hover:underline">
            Goals
          </Link>
          {hr ? (
            <>
              <Link href="/reviews/templates" className="text-primary underline-offset-2 hover:underline">
                Templates
              </Link>
              <Link href="/reviews/cycles/new" className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground">
                Launch a cycle
              </Link>
            </>
          ) : null}
        </div>
      </div>

      {summaryOnly ? (
        <section aria-label="Summary" className="space-y-2">
          <h2 className="text-lg font-semibold">Summary</h2>
          <p className="text-sm text-muted-foreground">Counts and averages only. An average is hidden for fewer than 5 reviews.</p>
          {summary.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cycles yet.</p>
          ) : (
            <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cycle</TableHead>
                    <TableHead>Reviews</TableHead>
                    <TableHead>Shared</TableHead>
                    <TableHead>Acknowledged</TableHead>
                    <TableHead>Average rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>{s.name}</TableCell>
                      <TableCell>{s.total}</TableCell>
                      <TableCell>{s.shared}</TableCell>
                      <TableCell>{s.acknowledged}</TableCell>
                      <TableCell>{s.averageRating ?? "Hidden"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      ) : (
        <>
          <section aria-label="My reviews" className="space-y-2">
            <h2 className="text-lg font-semibold">Your reviews</h2>
            <ReviewTable rows={own} paging={{ ...mineP, pageKey: "page", sizeKey: "size", query: q }} label="reviews" />
          </section>
          {others.length > 0 ? (
            <section aria-label="Team reviews" className="space-y-2">
              <h2 className="text-lg font-semibold">{hr ? "Everyone's reviews" : "Your team's reviews"}</h2>
              <ReviewTable rows={others} paging={{ ...otherP, pageKey: "opage", sizeKey: "osize", query: q }} label="reviews" />
            </section>
          ) : null}
        </>
      )}

      {hr ? (
        <section aria-label="Cycles" className="space-y-2">
          <h2 className="text-lg font-semibold">Cycles</h2>
          {cycles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No cycles yet.</p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {cycles.slice(0, 25).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <Link href={`/reviews/cycles/${c.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {c.name}
                  </Link>
                  <span className="text-sm text-muted-foreground">
                    {c.total} reviews, {c.byStage.acknowledged ?? 0} acknowledged {c.status === "closed" ? "(closed)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

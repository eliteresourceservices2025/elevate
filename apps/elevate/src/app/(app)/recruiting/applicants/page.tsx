import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { SelectField, TextField } from "@/components/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { formatInZone } from "@/lib/time";
import { APPLICANT_SORTS, APPLICANT_SORT_LABELS, filtersToQuery, parseApplicantFilters } from "@/modules/recruiting/applicant-filters";
import { CLOSE_KIND_LABELS, CLOSE_KINDS, SOURCE_LABELS, SOURCES, STAGE_LABELS, STAGES } from "@/modules/recruiting/constants";
import { BulkBar } from "@/modules/recruiting/components/bulk-bar";
import { listApplicants, type ApplicantRow } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "Applicants" };

const BASE = "/recruiting/applicants";
const BULK_FORM = "bulk-form";

function StageBadge({ row }: { row: ApplicantRow }) {
  if (row.stage === "rejected") return <Badge variant="secondary">{row.closeKind ? CLOSE_KIND_LABELS[row.closeKind] : "Closed"}</Badge>;
  return <Badge variant={row.stage === "hired" ? "default" : "outline"}>{STAGE_LABELS[row.stage]}</Badge>;
}

function SourceAndTags({ row }: { row: ApplicantRow }) {
  if (!row.source && row.tags.length === 0) return <span className="text-xs text-muted-foreground">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {row.source ? <Badge variant="secondary">{SOURCE_LABELS[row.source]}</Badge> : null}
      {row.tags.map((t) => (
        <Badge key={t.id} variant="outline">
          {t.name}
        </Badge>
      ))}
    </div>
  );
}

export default async function ApplicantsPage({ searchParams }: PageProps<"/recruiting/applicants">) {
  const sp = await searchParams;
  const filters = parseApplicantFilters(sp);
  const paging = parsePaging({ page: sp.page, size: sp.size });
  const data = await orNotFound(listApplicants(filters, paging));
  const query = filtersToQuery(filters);
  const filtering = Object.values(query).some((v) => v !== undefined);

  return (
    <PageContainer width="wide">
      <PageHeader
        title="Applicants"
        description={data.scope === "team" ? "Everyone who applied to the jobs you are on the hiring team for." : "Everyone who applied, across all jobs. Open a name for the full record."}
        actions={
          <Link href="/recruiting" className={buttonVariants({ variant: "outline" })}>
            Jobs and boards
          </Link>
        }
      />

      <form method="get" action={BASE} className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filter applicants">
        <TextField id="ap-q" name="q" label="Name or email" defaultValue={filters.q} maxLength={100} placeholder="Search" />
        <SelectField id="ap-job" name="job" label="Job" defaultValue={filters.openingId ?? ""}>
          <option value="">All jobs</option>
          {data.openings.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </SelectField>
        <SelectField id="ap-stage" name="stage" label="Stage" defaultValue={filters.stage}>
          <option value="all">Any stage</option>
          <option value="open">Still in the pipeline</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {STAGE_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <SelectField id="ap-kind" name="kind" label="How it closed" defaultValue={filters.closeKind}>
          <option value="all">Any</option>
          {CLOSE_KINDS.map((k) => (
            <option key={k} value={k}>
              {CLOSE_KIND_LABELS[k]}
            </option>
          ))}
        </SelectField>
        <SelectField id="ap-source" name="source" label="Source" defaultValue={filters.source}>
          <option value="all">Any source</option>
          <option value="none">Not said</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <SelectField id="ap-tag" name="tag" label="Tag" defaultValue={filters.tagId ?? ""}>
          <option value="">Any tag</option>
          {data.tagChoices.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <TextField id="ap-from" name="from" label="Applied from" type="date" defaultValue={filters.from ?? ""} />
        <TextField id="ap-to" name="to" label="Applied to" type="date" defaultValue={filters.to ?? ""} />
        <SelectField id="ap-sort" name="sort" label="Sort by" defaultValue={filters.sort}>
          {APPLICANT_SORTS.map((s) => (
            <option key={s} value={s}>
              {APPLICANT_SORT_LABELS[s]}
            </option>
          ))}
        </SelectField>
        <div className="flex items-end gap-2">
          <Button type="submit">Apply filters</Button>
          {filtering ? (
            <Link href={BASE} className={buttonVariants({ variant: "ghost" })}>
              Reset
            </Link>
          ) : null}
        </div>
      </form>

      {data.canBulk && data.rows.length > 0 ? (
        <>
          <form id={BULK_FORM} />
          <BulkBar formId={BULK_FORM} tags={data.tagChoices} />
        </>
      ) : null}

      {data.rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={filtering ? "No applicants match these filters" : "No applicants yet"}
          description={filtering ? "Try fewer filters or a different spelling." : "Applications from the careers page appear here."}
          action={
            filtering ? (
              <Link href={BASE} className={buttonVariants({ variant: "outline" })}>
                Reset filters
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* A table from the tablet width up; below it, one card per applicant (no sideways scrolling). */}
          <div className="hidden overflow-clip rounded-xl border bg-card shadow-sm md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {data.canBulk ? <TableHead className="w-10"><span className="sr-only">Select</span></TableHead> : null}
                  <TableHead>Applicant</TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Source and tags</TableHead>
                  <TableHead>Applied</TableHead>
                  <TableHead>Last change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.applicationId}>
                    {data.canBulk ? (
                      <TableCell>
                        <input type="checkbox" form={BULK_FORM} name="id" value={r.applicationId} aria-label={`Select ${r.name}`} className="size-4 accent-primary" />
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">
                      <Link href={`/recruiting/applications/${r.applicationId}`} className="text-primary underline-offset-4 hover:underline">
                        {r.name}
                      </Link>
                      {r.email ? <span className="block text-xs font-normal text-muted-foreground">{r.email}</span> : null}
                    </TableCell>
                    <TableCell>
                      <Link href={`/recruiting/${r.openingId}`} className="underline-offset-4 hover:underline">
                        {r.openingTitle}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StageBadge row={r} />
                    </TableCell>
                    <TableCell>
                      <SourceAndTags row={r} />
                    </TableCell>
                    <TableCell>{formatInZone(r.appliedAt, undefined, "MMM d, yyyy")}</TableCell>
                    <TableCell>{formatInZone(r.stageChangedAt, undefined, "MMM d, yyyy")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="space-y-2 md:hidden" aria-label="Applicants">
            {data.rows.map((r) => (
              <li key={r.applicationId} className="rounded-xl border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <label className="flex items-start gap-2">
                    {data.canBulk ? <input type="checkbox" form={BULK_FORM} name="id" value={r.applicationId} aria-label={`Select ${r.name}`} className="mt-1 size-4 accent-primary" /> : null}
                    <Link href={`/recruiting/applications/${r.applicationId}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {r.name}
                    </Link>
                  </label>
                  <StageBadge row={r} />
                </div>
                {r.email ? <p className="text-xs text-muted-foreground">{r.email}</p> : null}
                <p className="mt-1 text-sm">{r.openingTitle}</p>
                <div className="mt-1">
                  <SourceAndTags row={r} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Applied {formatInZone(r.appliedAt, undefined, "MMM d, yyyy")} · changed {formatInZone(r.stageChangedAt, undefined, "MMM d, yyyy")}
                </p>
              </li>
            ))}
          </ul>
          <PagerLinks info={data.info} basePath={BASE} query={query} defaultSize={25} label="applicants" />
        </>
      )}
    </PageContainer>
  );
}

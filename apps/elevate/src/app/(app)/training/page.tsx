import type { Metadata } from "next";
import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { TrainingRowActions } from "@/modules/learn/components/training-actions";
import { AutoAssignCard } from "@/modules/learn/components/auto-assign-card";
import { EvidenceCard } from "@/modules/learn/components/evidence-card";
import { LearnerInstructions } from "@/modules/learn/components/learner-instructions";
import { buildLearnerInstructions } from "@/modules/learn/instructions";
import { getAutoAssign, getInstructionFacts, listEvidenceClients, listTrainingStatus } from "@/modules/learn/queries";
import { todayInZone } from "@/modules/org/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Training status" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
const TRACK: Record<string, string> = { full: "Full", essentials: "Essentials", refresher: "Refresher" };

export default async function TrainingPage({ searchParams }: PageProps<"/training">) {
  const params = await searchParams;
  const filters = { state: one(params.state), q: one(params.q), course: one(params.course) };
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const { rows, counts, info, canSeeResults, canManage, course, courseLabel, courses, fixedTrack, published } = await orNotFound(listTrainingStatus(filters, paging));
  const auto = canManage ? await orNotFound(getAutoAssign(course)) : null;
  const facts = await orNotFound(getInstructionFacts(course));
  const evidenceClients = canManage ? await orNotFound(listEvidenceClients()) : null;
  const withCourse = (extra: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    if (course !== "hipaa") q.set("course", course);
    for (const [k, v] of Object.entries(extra)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/training?${s}` : "/training";
  };

  const chips: { label: string; state?: string; n: number }[] = [
    { label: "Everyone", n: counts.people },
    { label: "Overdue", state: "overdue", n: counts.overdue },
    { label: "Not yet", state: "open", n: counts.open + counts.overdue },
    { label: "Passed", state: "passed", n: counts.passed },
    { label: "Not assigned", state: "none", n: counts.none },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Training status"
        description={
          <>
            {courseLabel} training for each person: passed, not yet, or overdue.{" "}
            {canSeeResults ? "As HR you also see tries and the latest score." : "Scores stay with the person and HR."}
          </>
        }
        actions={<>{facts ? <LearnerInstructions courseLabel={courseLabel} text={buildLearnerInstructions(facts)} /> : null}</>}
      />

      <nav aria-label="Course" className="flex flex-wrap gap-2 text-sm">
        {courses.map((c) => (
          <Link key={c.slug} href={c.slug === "hipaa" ? "/training" : `/training?course=${c.slug}`} aria-current={c.slug === course ? "true" : undefined} className="rounded-lg border px-3 py-1.5 font-medium hover:bg-secondary/50 aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground">
            {c.label}
          </Link>
        ))}
      </nav>
      {courses.find((c) => c.slug === course)?.kind === "client_addon" ? (
        <p className="max-w-3xl text-sm text-muted-foreground">
          A client add-on: it is for the people currently assigned to that client, and the list shows only them (and anyone you added by hand). It is assigned
          when someone joins the client and closed when they leave it; the certificate stays on record.
        </p>
      ) : null}
      {!published ? (
        <Alert variant="warning" role="note" className="rounded-xl p-3 text-sm">
          This course is not published yet, so nobody is assigned and people cannot be added. Publishing needs a reviewer and the date counsel approved it.
        </Alert>
      ) : null}

      {auto ? (
        <>
          {auto.rule.mode === "paused" && published ? (
            <Alert variant="warning" role="note" className="rounded-xl p-3 text-sm">
              Automatic assignment is <strong>paused</strong> for this course: nobody is assigned until you choose a pilot or everyone in the settings under the list.
            </Alert>
          ) : null}
        </>
      ) : null}

      <ul className="flex flex-wrap gap-2 text-sm" aria-label="Filter by status">
        {chips.map((c) => (
          <li key={c.label}>
            <Link href={withCourse({ state: c.state })} aria-current={filters.state === c.state ? "true" : undefined} className="rounded-full border px-3 py-1 hover:bg-secondary/50 aria-[current=true]:bg-primary aria-[current=true]:text-primary-foreground">
              {c.label}: {c.n}
            </Link>
          </li>
        ))}
      </ul>

      <form method="get" action="/training" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3" aria-label="Search the list">
        {course !== "hipaa" ? <input type="hidden" name="course" value={course} /> : null}
        <div className="space-y-1">
          <Label htmlFor="t-q">Search</Label>
          <Input id="t-q" name="q" defaultValue={filters.q ?? ""} placeholder="Name or team" className="w-60" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="t-state">Status</Label>
          <NativeSelect id="t-state" name="state" defaultValue={filters.state ?? ""}>
            <option value="">Any</option>
            <option value="overdue">Overdue</option>
            <option value="open">Not yet</option>
            <option value="passed">Passed</option>
            <option value="none">Not assigned</option>
          </NativeSelect>
        </div>
        <button type="submit" className="h-9 rounded-lg border px-3 text-sm hover:bg-secondary/50">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">No one matches. {counts.people === 0 ? "Training is shown for people with an ELEVATE account." : ""}</p>
      ) : (
        <Table stack>
          <TableHeader>
            <TableRow>
              <TableHead>Person</TableHead>
              <TableHead>Team</TableHead>
              <TableHead>Track</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="whitespace-normal">Certificate until</TableHead>
              {canSeeResults ? <TableHead>Tries</TableHead> : null}
              {canSeeResults ? <TableHead className="whitespace-normal">Latest score</TableHead> : null}
              {canManage ? <TableHead>Actions</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.employeeId}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell label="Team">{r.team ?? "-"}</TableCell>
                <TableCell label="Track">{r.track ? TRACK[r.track] ?? r.track : "-"}</TableCell>
                <TableCell label="Status" className="whitespace-normal">
                  <span className={r.state === "overdue" ? "font-medium text-destructive" : r.state === "passed" ? "font-medium" : undefined}>{r.label}</span>
                </TableCell>
                <TableCell label="Due">
                  {r.dueText ? (
                    <>
                      {r.dueOn}
                      <span className="block text-xs text-muted-foreground">{r.dueText}</span>
                    </>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell label="Certificate until">{r.certificateEndsOn ?? "-"}</TableCell>
                {canSeeResults ? <TableCell label="Tries">{r.attempts ?? "-"}</TableCell> : null}
                {canSeeResults ? <TableCell label="Latest score">{r.lastScore === null ? "-" : `${r.lastScore}%`}</TableCell> : null}
                {canManage ? (
                  <TableCell label="Actions" className="whitespace-normal">
                    <TrainingRowActions course={course} fixedTrack={fixedTrack} userId={r.userId} employeeId={r.employeeId} queued={r.state === "queued"} assignmentId={r.state === "open" || r.state === "overdue" ? r.assignmentId : null} canAssign={canManage} canGrant={canManage} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <PagerLinks info={info} basePath="/training" query={{ state: filters.state, q: filters.q, course: course !== "hipaa" ? course : undefined }} label="people" />

      {/* Set-up and reporting are used now and then: the list people came for comes first. */}
      {auto ? (
        <details className="rounded-xl border bg-card p-4" open={auto.rule.mode === "paused" && published ? true : undefined}>
          <summary className="cursor-pointer text-sm font-medium">Automatic assignment settings</summary>
          <div className="mt-3">
            <AutoAssignCard
              key={`${course}-${auto.rule.mode}-${auto.rule.teamIds.join(",")}`}
              course={course}
              courseLabel={courseLabel}
              initial={{ mode: auto.rule.mode, teamIds: auto.rule.teamIds }}
              teams={auto.teams}
              updatedText={auto.rule.updatedAt ? `Last changed ${auto.rule.updatedAt.slice(0, 10)}.` : auto.rule.configured ? null : "Not set: everyone is assigned automatically."}
            />
          </div>
        </details>
      ) : null}
      {evidenceClients ? (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer text-sm font-medium">Client evidence report</summary>
          <div className="mt-3">
          <EvidenceCard clients={evidenceClients} today={todayInZone()} />
          </div>
        </details>
      ) : null}
    </PageContainer>
  );
}

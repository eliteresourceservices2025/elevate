import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { formatDateOnly } from "@/lib/time";
import { ExitInterviewForm, OffboardingControls } from "@/modules/onboarding/components/case-actions";
import { TaskList } from "@/modules/onboarding/components/task-list";
import { LEAVING_LABELS, type LeavingReason } from "@/modules/onboarding/constants";
import { getOffboardingCase } from "@/modules/onboarding/queries";
import { syncCase } from "@/modules/onboarding/service";

export const metadata: Metadata = { title: "Offboarding" };

export default async function OffboardingCasePage({ params }: PageProps<"/offboarding/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await orNotFound(getOffboardingCase(id));
  await syncCase("offboarding", id);
  const c = await orNotFound(getOffboardingCase(id));
  const open = c.status === "open";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/offboarding" className="text-sm text-primary underline-offset-2 hover:underline">
          All offboarding
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Offboarding: {c.name}</h1>
        <p className="text-muted-foreground">
          {c.position ? `${c.position}. ` : ""}Last working day {formatDateOnly(c.date)}
          {c.reason && c.canManage ? ` (${LEAVING_LABELS[c.reason as LeavingReason]})` : ""}. {c.progress.done} of {c.progress.total} tasks done.
          {c.status !== "open" ? ` This offboarding is ${c.status}.` : ""}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {c.accessRemovedAt ? `Access was removed on ${c.accessRemovedAt.toISOString().slice(0, 10)}.` : "Access is removed automatically when the last working day ends in their own time zone."}
        </p>
        {c.note && c.canManage ? <p className="mt-1 text-sm">Note: {c.note}</p> : null}
      </div>

      {c.canManage ? <OffboardingControls caseId={c.id} employeeId={c.employeeId} accessRemoved={Boolean(c.accessRemovedAt)} open={open} ready={c.progress.ready} /> : null}
      <TaskList tasks={c.tasks} canManage={c.canManage} open={open} />

      {c.isPerson && open && !c.accessRemovedAt && !c.exitSubmitted ? <ExitInterviewForm caseId={c.id} /> : null}
      {c.isPerson && c.exitSubmitted ? <p className="text-sm text-muted-foreground">Your exit interview was submitted. Only HR can read it.</p> : null}

      {c.exitInterview ? (
        <section aria-label="Exit interview" className="space-y-1 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Exit interview (HR only)</h2>
          <p className="text-sm"><strong>Reason:</strong> {c.exitInterview.reasonForLeaving}</p>
          {c.exitInterview.wentWell ? <p className="text-sm"><strong>Went well:</strong> {c.exitInterview.wentWell}</p> : null}
          {c.exitInterview.toImprove ? <p className="text-sm"><strong>Could be better:</strong> {c.exitInterview.toImprove}</p> : null}
          <p className="text-sm"><strong>Would work with ERS again:</strong> {c.exitInterview.wouldReturn}</p>
        </section>
      ) : null}

      {c.certificates.length > 0 ? (
        <section aria-label="Certificates" className="space-y-1 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Certificates of engagement</h2>
          <ul className="text-sm">
            {c.certificates.map((x) => (
              <li key={x.id}>
                <a href={`/api/certificates/${x.id}`} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                  {x.reference}
                </a>{" "}
                <span className="text-muted-foreground">issued {x.issuedAt.toISOString().slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

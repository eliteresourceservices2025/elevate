import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { AckedBadge, DueBadge, StatusTable } from "@/modules/announcements/components/ack-display";
import { AcknowledgeButton, StatusActions } from "@/modules/announcements/components/ack-controls";
import { DraftEditor, StartDraftButton } from "@/modules/announcements/components/policy-editor";
import { getAckStatus, getPolicy } from "@/modules/announcements/queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Policy" };

const KIND_LABEL = { general: null, privacy_notice: "Privacy notice", monitoring: "Monitoring policy" } as const;

export default async function PolicyPage({ params }: PageProps<"/announcements/policies/[id]">) {
  const { id } = await params;
  const p = await orNotFound(getPolicy(id));
  if (!p) notFound();
  const today = todayInZone();
  const status = p.canSeeStatus && p.current ? await orNotFound(getAckStatus({ kind: "policy_version", id: p.current.id })) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/announcements?tab=policies" className="text-sm text-primary underline-offset-4 hover:underline">
          All policies
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{p.title}</h1>
          {KIND_LABEL[p.kind] ? <Badge variant="outline">{KIND_LABEL[p.kind]}</Badge> : null}
        </div>
        {p.current?.publishedAt ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Version {p.current.version}, published {formatInZone(p.current.publishedAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">Not published yet. Only HR can see this.</p>
        )}
      </div>

      {p.current ? (
        <>
          {p.current.changeNote ? (
            <p className="rounded-lg border bg-muted/50 p-3 text-sm">
              <span className="font-medium">What changed: </span>
              {p.current.changeNote}
            </p>
          ) : null}
          <article className="rounded-xl border bg-card p-5">
            <Markdown source={p.current.body} />
          </article>

          {p.current.requiresAck ? (
            <section aria-label="Acknowledgment" className="space-y-3 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Acknowledgment</h2>
                {p.needsMyAck ? <DueBadge due={p.due} dueOn={p.current.dueOn} today={today} /> : null}
                {p.acknowledgedAt ? <AckedBadge at={p.acknowledgedAt} /> : null}
              </div>
              {p.needsMyAck ? (
                <>
                  <p className="text-sm text-muted-foreground">Confirming records your name, this version and the time. Nothing else.</p>
                  <AcknowledgeButton subject={{ kind: "policy_version", id: p.current.id }} />
                </>
              ) : p.acknowledgedAt ? (
                <p className="text-sm text-muted-foreground">You acknowledged version {p.current.version} on {formatInZone(p.acknowledgedAt, DEFAULT_TIMEZONE, "MMM d, yyyy 'at' h:mm a")}.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Only people with an active ELEVATE profile acknowledge policies.</p>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      {p.canManage ? (
        <section aria-label="Edit policy" className="space-y-3">
          {p.draft ? (
            <DraftEditor
              policyId={p.id}
              nextVersion={p.draft.version}
              initial={{ body: p.draft.body, changeNote: p.draft.changeNote, requiresAck: p.draft.requiresAck, dueOn: p.draft.dueOn }}
              hasPublished={p.current !== null}
              today={today}
            />
          ) : p.current ? (
            <StartDraftButton policyId={p.id} body={p.current.body} requiresAck={p.current.requiresAck} />
          ) : null}
        </section>
      ) : null}

      {status && p.current ? (
        <section aria-label="Who has acknowledged" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Who has acknowledged version {p.current.version}</h2>
            <StatusActions
              subject={{ kind: "policy_version", id: p.current.id }}
              canRemind={p.canRemind}
              canExport={p.canExport}
              pendingCount={status.rows.filter((r) => !r.acknowledgedAt && r.hasAccount).length}
            />
          </div>
          <StatusTable rows={status.rows} />
        </section>
      ) : null}

      {p.canManage && p.history.length > 0 ? (
        <section aria-label="Version history" className="space-y-2">
          <h2 className="text-lg font-semibold">Version history</h2>
          <ul className="divide-y rounded-xl border bg-card px-4">
            {p.history.map((v) => (
              <li key={v.id} className="py-3 text-sm">
                <span className="font-medium">Version {v.version}</span>
                {v.publishedAt ? <span className="text-muted-foreground"> · published {formatInZone(v.publishedAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}</span> : null}
                <span className="text-muted-foreground"> · {v.requiresAck ? `${v.acknowledgedCount ?? 0} acknowledged` : "no acknowledgment required"}</span>
                {v.changeNote ? <p className="mt-1 text-muted-foreground">{v.changeNote}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

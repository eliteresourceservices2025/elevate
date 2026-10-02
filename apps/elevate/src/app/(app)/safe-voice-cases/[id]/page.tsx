import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { CaseControls } from "@/modules/safevoice/components/case-controls";
import { CATEGORY_LABELS, OUTCOME_LABELS, STATUS_LABELS, caseReference } from "@/modules/safevoice/constants";
import { SafevoiceNotConfigured } from "@/modules/safevoice/handler-db";
import { getCase, type CaseDetail } from "@/modules/safevoice/queries";

export const metadata: Metadata = { title: "Safe Voice case" };

const extension = (type: string) => (type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : "jpg");

function Files({ files }: { files: CaseDetail["attachments"] }) {
  if (files.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-2 text-sm">
      {files.map((f) => (
        <li key={f.id}>
          <a href={`/api/safe-voice-cases/attachments/${f.id}`} className="rounded-lg border px-2 py-1 text-primary underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">
            Attachment {f.position} ({extension(f.contentType).toUpperCase()}, {Math.max(1, Math.round(f.sizeBytes / 1024))} KB)
          </a>
        </li>
      ))}
    </ul>
  );
}

export default async function SafeVoiceCasePage({ params }: PageProps<"/safe-voice-cases/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let c: CaseDetail | null;
  try {
    c = await orNotFound(getCase(id));
  } catch (error) {
    if (error instanceof SafevoiceNotConfigured) notFound();
    throw error;
  }
  if (!c) notFound();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/safe-voice-cases" className="text-sm text-primary underline-offset-2 hover:underline">
          All cases
        </Link>
        <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold">
          <span className="font-mono">{caseReference(c.id)}</span>
          <Badge variant={c.status === "closed" ? "outline" : "secondary"}>{STATUS_LABELS[c.status]}</Badge>
          {c.outcome ? <Badge variant="outline">{OUTCOME_LABELS[c.outcome]}</Badge> : null}
        </h1>
        <p className="text-muted-foreground">
          {CATEGORY_LABELS[c.category]}. Received {c.createdDay}
          {c.closedDay ? `, closed ${c.closedDay}` : ""}. Days are UTC dates: no time of day is kept.
        </p>
      </div>

      <section className="rounded-xl border bg-card p-4" aria-label="The report">
        <h2 className="text-lg font-semibold">The report</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{c.description}</p>
        <Files files={c.attachments.filter((a) => a.messageId === null)} />
      </section>

      <section className="space-y-2" aria-label="Messages">
        <h2 className="text-lg font-semibold">Messages</h2>
        {c.messages.length === 0 ? <p className="text-sm text-muted-foreground">No messages yet.</p> : null}
        {c.messages.map((m) => (
          <div key={m.id} className={`rounded-xl border bg-card p-3 ${m.author === "handler" ? "border-l-4 border-l-primary" : "border-l-4 border-l-brand-gold"}`}>
            <p className="text-xs text-muted-foreground">{m.author === "handler" ? "A handler" : "The reporter"} · {m.day}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
            <Files files={c.attachments.filter((a) => a.messageId === m.id)} />
          </div>
        ))}
      </section>

      <CaseControls caseId={c.id} status={c.status} />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { formatInZone, SECONDARY_TIMEZONE } from "@/lib/time";
import { ManageButtons } from "@/modules/signing/components/envelope-forms";
import { OpenDocumentButton, SignPanel } from "@/modules/signing/components/sign-panel";
import { SIGNER_STATUS_LABELS, STATUS_LABELS } from "@/modules/signing/constants";
import { getEnvelopeDetail } from "@/modules/signing/queries";

export const metadata: Metadata = { title: "Document" };

const STATUS_VARIANT = { draft: "outline", out: "default", completed: "secondary", declined: "destructive", voided: "outline", expired: "outline" } as const;

export default async function EnvelopePage({ params }: PageProps<"/signing/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await orNotFound(getEnvelopeDetail(id));
  const { envelope: e } = d;
  const me = d.signers.find((s) => s.isMe);
  const manager = d.viewer === "manager";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/signing" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Signing
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-bold">
          {e.title}
          <Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABELS[e.status]}</Badge>
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {e.reference} · {e.pages} {e.pages === 1 ? "page" : "pages"} · sent by {e.createdBy}
          {e.sentAt ? ` on ${formatInZone(e.sentAt, undefined, "MMM d, yyyy")}` : ""}
          {e.status === "out" && e.expiresAt ? ` · expires ${formatInZone(e.expiresAt, undefined, "MMM d, yyyy")}` : ""}
        </p>
        {e.endReason && e.status !== "completed" ? <p className="mt-1 text-sm">Reason: {e.endReason}</p> : null}
      </div>

      {e.sealing ? <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">Everyone has signed. The document is being sealed and will be ready in a moment. Refresh this page.</p> : null}

      {e.status === "completed" ? (
        <section aria-label="Signed copy" className="space-y-2 rounded-xl border border-green-600/40 bg-green-600/10 p-4">
          <h2 className="text-lg font-semibold">Everyone has signed</h2>
          <p className="text-sm">Sealed {e.sealedAt ? `${formatInZone(e.sealedAt, undefined, "MMM d, yyyy h:mm a")} (${formatInZone(e.sealedAt, SECONDARY_TIMEZONE, "h:mm a")} Manila)` : ""}. The signed copy includes a certificate of completion.</p>
          <OpenDocumentButton envelopeId={e.id} label="Download the signed copy" />
          {e.sealedSha256 ? <p className="break-all font-mono text-xs text-muted-foreground">SHA-256: {e.sealedSha256}</p> : null}
        </section>
      ) : null}

      {d.canSign && me ? (
        <section aria-label="Sign" className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="text-lg font-semibold">Your signature is needed</h2>
          <SignPanel envelopeId={e.id} viewed={d.mine?.viewed ?? false} defaultName={me.name} />
        </section>
      ) : d.mine?.status === "waiting" && e.status === "out" ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">Others sign before you. You will be notified when it is your turn.</p>
      ) : d.mine?.status === "signed" && e.status === "out" ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm">You signed this. The others still need to sign.</p>
      ) : null}

      <section aria-label="Signers" className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">Signers</h2>
        <ol className="space-y-2 text-sm">
          {d.signers.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <span className="w-6 text-muted-foreground">{e.order === "sequential" ? `${s.position}.` : ""}</span>
              <span className="font-medium">
                {s.name}
                {s.isMe ? " (you)" : ""}
              </span>
              {s.role ? <span className="text-muted-foreground">{s.role}</span> : null}
              {manager && s.email ? <span className="text-xs text-muted-foreground">{s.email}</span> : null}
              <Badge variant={s.status === "signed" ? "default" : s.status === "declined" ? "destructive" : "secondary"}>{SIGNER_STATUS_LABELS[s.status]}</Badge>
              {s.signedAt ? <span className="text-xs text-muted-foreground">{formatInZone(s.signedAt, undefined, "MMM d, yyyy h:mm a")}</span> : null}
              {manager && !s.viewedAt && s.status === "pending" ? <span className="text-xs text-muted-foreground">has not opened it</span> : null}
            </li>
          ))}
        </ol>
      </section>

      {manager ? (
        <>
          <section aria-label="Manage" className="space-y-3 rounded-xl border bg-card p-4">
            <h2 className="text-lg font-semibold">Manage</h2>
            <div className="flex flex-wrap items-center gap-2">
              <OpenDocumentButton envelopeId={e.id} label={e.status === "completed" ? "Open the signed copy" : "Open the original"} />
            </div>
            <ManageButtons envelopeId={e.id} status={e.status} sealing={e.sealing} />
            {e.originalSha256 ? <p className="break-all font-mono text-xs text-muted-foreground">Original SHA-256: {e.originalSha256}</p> : null}
          </section>

          {d.events ? (
            <section aria-label="Event log" className="space-y-2 rounded-xl border bg-card p-4">
              <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                Event log
                {d.chainOk ? <Badge variant="secondary">Chain intact</Badge> : <Badge variant="destructive">Chain broken: the log was changed</Badge>}
              </h2>
              <ol className="space-y-1 text-sm">
                {d.events.map((ev) => (
                  <li key={ev.seq}>
                    <span className="text-muted-foreground">{formatInZone(ev.at, "UTC", "yyyy-MM-dd HH:mm:ss")} UTC</span> · {ev.type}
                    {ev.actor ? ` · ${ev.actor}` : ""}
                    {ev.ip ? ` · ${ev.ip}` : ""}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

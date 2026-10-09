import type { Metadata } from "next";
import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { paginate, parsePaging } from "@/lib/pagination";
import { formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { SIGNER_STATUS_LABELS, STATUS_LABELS } from "@/modules/signing/constants";
import { ArchiveTemplateButton, NewTemplateForm } from "@/modules/signing/components/envelope-forms";
import { listEnvelopes, listMySigning, listTemplates } from "@/modules/signing/queries";

export const metadata: Metadata = { title: "Signing" };

const STATUS_VARIANT = { draft: "outline", out: "default", completed: "secondary", declined: "destructive", voided: "outline", expired: "outline" } as const;

export default async function SigningPage({ searchParams }: PageProps<"/signing">) {
  const user = await requireUser();
  const sp = await searchParams;
  const manage = scopeFor(user, "signing.manage") !== null;
  const tabs = [{ key: "mine", label: "To sign" }, ...(manage ? [{ key: "all", label: "All documents" }, { key: "templates", label: "Templates" }] : [])] as const;
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "mine";
  const paging = parsePaging({ page: sp.page, size: sp.size }, 10);

  const mine = tab === "mine" ? await orNotFound(listMySigning()) : null;
  const all = tab === "all" ? await orNotFound(listEnvelopes()) : null;
  const templates = tab === "templates" ? await orNotFound(listTemplates()) : null;
  const minePage = mine ? paginate(mine, paging.page, paging.pageSize) : null;
  const allPage = all ? paginate(all, paging.page, paging.pageSize) : null;
  const waiting = mine?.filter((m) => m.myStatus === "pending" && m.envelopeStatus === "out").length ?? 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Signing</h1>
          <p className="mt-1 text-muted-foreground">ELEVATE Sign: agreements and forms signed electronically, sealed with a certificate. Anyone can check a signed copy on the public{" "}
            <Link href="/verify" className="text-primary underline-offset-4 hover:underline">
              Verify document
            </Link>{" "}
            page.
          </p>
        </div>
        {manage ? (
          <Link href="/signing/new" className={buttonVariants()}>
            Send a document
          </Link>
        ) : null}
      </div>

      {tabs.length > 1 ? (
        <nav aria-label="Signing sections" className="flex flex-wrap gap-1 border-b">
          {tabs.map((t) => (
            <Link key={t.key} href={`/signing?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined} className={cn("-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm", t.key === tab ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {minePage && mine ? (
        <section aria-label="Documents to sign" className="space-y-2">
          {waiting > 0 ? <p role="status" className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-sm">You have {waiting} {waiting === 1 ? "document" : "documents"} waiting for your signature.</p> : null}
          {mine.length === 0 ? (
            <p className="text-muted-foreground">Nothing has been sent to you to sign.</p>
          ) : (
            <>
              <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Your part</TableHead>
                      <TableHead>Document status</TableHead>
                      <TableHead>Sent</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {minePage.rows.map((r) => (
                      <TableRow key={r.envelopeId}>
                        <TableCell className="font-medium">
                          <Link href={`/signing/${r.envelopeId}`} className="text-primary underline-offset-4 hover:underline">
                            {r.title}
                          </Link>
                          <span className="block text-xs font-normal text-muted-foreground">{r.reference}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.myStatus === "pending" && r.envelopeStatus === "out" ? "default" : "secondary"}>{SIGNER_STATUS_LABELS[r.myStatus]}</Badge>
                          {r.signedAt ? <span className="block text-xs text-muted-foreground">{formatInZone(r.signedAt, undefined, "MMM d, yyyy h:mm a")}</span> : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[r.envelopeStatus]}>{STATUS_LABELS[r.envelopeStatus]}</Badge>
                          {r.envelopeStatus === "out" && r.expiresAt ? <span className="block text-xs text-muted-foreground">Expires {formatInZone(r.expiresAt, undefined, "MMM d")}</span> : null}
                        </TableCell>
                        <TableCell>{r.sentAt ? formatInZone(r.sentAt, undefined, "MMM d, yyyy") : "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PagerLinks info={minePage.info} basePath="/signing" query={{ tab: "mine" }} defaultSize={10} label="documents" />
            </>
          )}
        </section>
      ) : null}

      {allPage && all ? (
        <section aria-label="All documents" className="space-y-2">
          {all.length === 0 ? (
            <p className="text-muted-foreground">No documents yet. Send one with &quot;Send a document&quot;.</p>
          ) : (
            <>
              <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Signed</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Expires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allPage.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">
                          <Link href={`/signing/${r.id}`} className="text-primary underline-offset-4 hover:underline">
                            {r.title}
                          </Link>
                          <span className="block text-xs font-normal text-muted-foreground">{r.reference}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {r.signed} of {r.total}
                        </TableCell>
                        <TableCell>{formatInZone(r.createdAt, undefined, "MMM d, yyyy")}</TableCell>
                        <TableCell>{r.status === "out" && r.expiresAt ? formatInZone(r.expiresAt, undefined, "MMM d") : "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <PagerLinks info={allPage.info} basePath="/signing" query={{ tab: "all" }} defaultSize={10} label="documents" />
            </>
          )}
        </section>
      ) : null}

      {templates ? (
        <section aria-label="Templates" className="space-y-4">
          {templates.length === 0 ? <p className="text-muted-foreground">No templates yet. Save an agreement you send often.</p> : null}
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
                <div>
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.pages} {t.pages === 1 ? "page" : "pages"} · signers: {t.roles.join(", ")}
                    {t.description ? ` · ${t.description}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link href={`/signing/new?template=${t.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                    Use
                  </Link>
                  <ArchiveTemplateButton templateId={t.id} />
                </div>
              </li>
            ))}
          </ul>
          <NewTemplateForm />
        </section>
      ) : null}
    </div>
  );
}

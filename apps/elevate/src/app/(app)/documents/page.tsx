import type { Metadata } from "next";
import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { paginate, parsePaging } from "@/lib/pagination";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatDateOnly, formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CompanyDocuments } from "@/modules/documents/components/company-documents";
import { DocumentBulkBar, bulkBoxProps } from "@/modules/documents/components/document-bulk-bar";
import { ExpiryBadge } from "@/modules/documents/components/document-list";
import { TypeBadge } from "@/modules/documents/components/type-badge";
import { NewTypeForm, TypeRow } from "@/modules/documents/components/type-admin";
import { BulkUpload } from "@/modules/documents/components/bulk-upload";
import { UploadForm } from "@/modules/documents/components/upload-form";
import { getDocumentOverview, getUploadOptions, listAllEmployeeDocuments, listCompanyDocuments, listDocumentTypes } from "@/modules/documents/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Documents" };

const HR_TABS = [
  { key: "attention", label: "Expiring and expired" },
  { key: "missing", label: "Missing" },
  { key: "verify", label: "To verify" },
  { key: "files", label: "All files" },
  { key: "company", label: "Company documents" },
  { key: "types", label: "Types" },
] as const;

function PersonLink({ id, name, number }: { id: string; name: string; number: string }) {
  return (
    <Link href={`/people/${id}?tab=documents`} className="font-medium text-primary underline-offset-4 hover:underline">
      {name} <span className="font-normal text-muted-foreground">{number}</span>
    </Link>
  );
}

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const user = await requireUser();
  const isHr = can(user, "documents.view_overview");
  const sp = await searchParams;
  const requested = sp.tab;
  const paging = parsePaging({ page: sp.page, size: sp.size });
  const tab = isHr ? (HR_TABS.find((t) => t.key === requested)?.key ?? "attention") : "company";
  const today = formatInZone(new Date(), DEFAULT_TIMEZONE, "yyyy-MM-dd");

  const overview = isHr && (tab === "attention" || tab === "missing" || tab === "verify") ? await orNotFound(getDocumentOverview()) : null;
  const attention = overview ? paginate(overview.attention, paging.page, paging.pageSize) : null;
  const missing = overview ? paginate(overview.missing, paging.page, paging.pageSize) : null;
  const unverified = overview ? paginate(overview.unverified, paging.page, paging.pageSize) : null;
  const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
  const filesQuery = { q: one(sp.q), type: one(sp.type), archived: one(sp.archived) === "1" };
  const files = isHr && tab === "files" ? await orNotFound(listAllEmployeeDocuments({ q: filesQuery.q, typeSlug: filesQuery.type, archived: filesQuery.archived, page: paging.page, pageSize: paging.pageSize })) : null;
  const company = tab === "company" ? await listCompanyDocuments() : null;
  const companyUpload = tab === "company" && can(user, "documents.manage_company") ? await getUploadOptions("company") : null;
  const types = isHr && tab === "types" ? await orNotFound(listDocumentTypes()) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Documents"
        description={
          <>
            {isHr
              ? "Files for every person and for the company, with expiry tracking."
              : "Company policies and forms. Your own documents are on "}
            {isHr ? null : (
              <Link href="/people/me?tab=documents" className="text-primary underline-offset-4 hover:underline">
                your profile
              </Link>
            )}
            {isHr ? null : "."}
          </>
        }
      />

      {isHr ? (
        <nav aria-label="Documents sections" className="flex flex-wrap gap-1 border-b">
          {HR_TABS.map((t) => (
            <Link
              key={t.key}
              href={`/documents?tab=${t.key}`}
              aria-current={t.key === tab ? "page" : undefined}
              className={cn("-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm", t.key === tab ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t.label}
              {overview && t.key === "attention" ? <Badge variant="secondary" className="ml-2">{overview.attention.length}</Badge> : null}
              {overview && t.key === "missing" ? <Badge variant="secondary" className="ml-2">{overview.missing.length}</Badge> : null}
              {overview && t.key === "verify" ? <Badge variant="secondary" className="ml-2">{overview.unverified.length}</Badge> : null}
            </Link>
          ))}
        </nav>
      ) : null}

      {overview && tab === "attention" ? (
        overview.attention.length === 0 ? (
          <p className="text-muted-foreground">Nothing is expiring in the next 30 days. Expired documents would appear here too.</p>
        ) : (
          <>
          <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Days left</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attention?.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><PersonLink id={r.employeeId} name={r.employeeName} number={r.employeeNumber} /></TableCell>
                    <TableCell>{r.typeName}<div className="text-xs text-muted-foreground">{r.title}</div></TableCell>
                    <TableCell><ExpiryBadge status={r.expiry} expiresOn={r.expiresOn} /></TableCell>
                    <TableCell>{r.daysLeft < 0 ? `${-r.daysLeft} overdue` : r.daysLeft}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PagerLinks info={attention!.info} basePath="/documents" query={{ tab: "attention" }} label="documents" />
          </>
        )
      ) : null}

      {overview && tab === "missing" ? (
        overview.missing.length === 0 ? (
          <p className="text-muted-foreground">Everyone has the documents marked &quot;Everyone needs one&quot;.</p>
        ) : (
          <>
          <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Missing</TableHead>
                  <TableHead>Why</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {missing?.rows.map((r, i) => (
                  <TableRow key={`${r.employeeId}-${r.typeName}-${i}`}>
                    <TableCell><PersonLink id={r.employeeId} name={r.employeeName} number={r.employeeNumber} /></TableCell>
                    <TableCell>{r.typeName}</TableCell>
                    <TableCell>{r.reason === "expired" ? <Badge variant="destructive">Expired</Badge> : <Badge variant="outline">Not uploaded</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PagerLinks info={missing!.info} basePath="/documents" query={{ tab: "missing" }} label="gaps" />
          </>
        )
      ) : null}

      {overview && tab === "verify" ? (
        overview.unverified.length === 0 ? (
          <p className="text-muted-foreground">Everything uploaded has been verified.</p>
        ) : (
          <>
          <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unverified?.rows.map((r) => (
                  <TableRow key={r.documentId}>
                    <TableCell><PersonLink id={r.employeeId} name={r.employeeName} number={r.employeeNumber} /></TableCell>
                    <TableCell>{r.typeName}<div className="text-xs text-muted-foreground">{r.title}</div></TableCell>
                    <TableCell>{formatInZone(r.uploadedAt, DEFAULT_TIMEZONE, "MMM d, yyyy")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PagerLinks info={unverified!.info} basePath="/documents" query={{ tab: "verify" }} label="documents" />
          </>
        )
      ) : null}

      {files ? (
        <div className="space-y-4">
          <form method="get" action="/documents" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="files" />
            <div className="space-y-1">
              <label htmlFor="files-q" className="block text-xs">
                Search by person, title or file name
              </label>
              <input id="files-q" name="q" defaultValue={filesQuery.q ?? ""} maxLength={80} className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm" />
            </div>
            <div className="space-y-1">
              <label htmlFor="files-type" className="block text-xs">
                Type
              </label>
              <select id="files-type" name="type" defaultValue={filesQuery.type ?? ""} className="h-8 w-56 rounded-lg border border-input bg-transparent px-2 text-sm">
                <option value="">All types</option>
                {files.types.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <label htmlFor="files-archived" className="flex h-8 items-center gap-2 text-sm">
              <input id="files-archived" type="checkbox" name="archived" value="1" defaultChecked={filesQuery.archived} className="size-4 accent-primary" />
              Show archived files only
            </label>
            <button type="submit" className="h-8 rounded-lg border bg-card px-3 text-sm shadow-sm hover:bg-secondary/60">
              Filter
            </button>
          </form>
          {files.rows.length > 0 ? <DocumentBulkBar formId="files-bulk" /> : null}
          {files.rows.length === 0 ? (
            <p className="text-muted-foreground">No document matches.</p>
          ) : (
            <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card shadow-sm">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"><span className="sr-only">Select</span></TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Document</TableHead>
                    <TableHead>Folder</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <input {...bulkBoxProps("files-bulk")} value={r.id} aria-label={`Select ${r.title}`} className="size-4 accent-primary" />
                      </TableCell>
                      <TableCell>
                        <PersonLink id={r.employeeId} name={r.employeeName} number={r.employeeNumber} />
                      </TableCell>
                      <TableCell>
                        <TypeBadge slug={r.typeSlug} name={r.typeName} />
                      </TableCell>
                      <TableCell>
                        {r.title}
                        <div className="text-xs text-muted-foreground">{r.fileName}</div>
                      </TableCell>
                      <TableCell>{r.folderName ?? <span className="text-muted-foreground">No folder</span>}</TableCell>
                      <TableCell>
                        <ExpiryBadge status={r.expiry} expiresOn={r.expiresOn} />
                      </TableCell>
                      <TableCell>{r.verified ? <Badge variant="secondary">Verified</Badge> : <Badge variant="outline">Not verified</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <PagerLinks info={files.info} basePath="/documents" query={{ tab: "files", q: filesQuery.q, type: filesQuery.type, archived: filesQuery.archived ? "1" : undefined }} label="documents" />
          <p className="text-xs text-muted-foreground">Open a person to download, rename, verify or archive their files. Deleting for good works on archived files only.</p>
        </div>
      ) : null}

      {company ? (
        <div className="space-y-6">
          <CompanyDocuments rows={company} viewerIsHr={can(user, "documents.manage_company")} showAudience={can(user, "documents.manage_company")} categorize={companyUpload ? { types: companyUpload.types, clients: [], today, withAudience: true } : undefined} />
          {companyUpload ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Add a company document</h2>
              <UploadForm target="company" types={companyUpload.types} clients={[]} today={today} />
              <BulkUpload target="company" types={companyUpload.types} />
            </section>
          ) : null}
        </div>
      ) : null}

      {types ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            &quot;Everyone needs one&quot; types appear on the Missing tab for anyone who has no valid copy. Retiring a type keeps existing documents.
          </p>
          <NewTypeForm />
          <ul className="divide-y rounded-xl border bg-card px-4">
            {types.map((t) => (
              <TypeRow key={t.id} type={t} />
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">Dates follow the {DEFAULT_TIMEZONE} calendar. Today is {formatDateOnly(today)}.</p>
    </PageContainer>
  );
}

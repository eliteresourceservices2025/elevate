import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { PagerLinks } from "@/components/pager";
import { TabNav } from "@/components/tab-nav";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { orNotFound } from "@/lib/or-not-found";
import { pageInfo } from "@/lib/pagination";
import { todayInZone } from "@/modules/org/service";
import { listDirectory } from "@/modules/people/queries";
import { getUploadOptions, listEmployeeFolders } from "@/modules/documents/queries";
import { UploadForm } from "@/modules/documents/components/upload-form";
import { BulkUpload } from "@/modules/documents/components/bulk-upload";

export const metadata: Metadata = { title: "Upload employee files" };

/** The cross-person upload entry point is for HR; individual profiles retain their own upload permission. */
export default async function UploadEmployeeFilesPage({
  searchParams,
}: PageProps<"/documents/upload">) {
  const user = await requireUser();
  await orNotFound(authorize(user, "documents.upload"));
  const sp = await searchParams;
  const person = typeof sp.person === "string" ? sp.person : null;
  if (person && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(person))
    notFound();
  const options = person ? await orNotFound(getUploadOptions("employee", person)) : null;
  const mode =
    sp.mode === "many" && options?.types.some((t) => t.slug === "unsorted_employee")
      ? "many"
      : "one";
  if (person && !options?.employee) notFound();
  const folders = person ? await orNotFound(listEmployeeFolders(person)) : [];
  const directory = !person
    ? await orNotFound(listDirectory({ q: sp.q, page: sp.page, size: sp.size }))
    : null;
  return (
    <PageContainer width="medium">
      <PageHeader
        title="Upload employee files"
        description={
          options?.employee
            ? `${options.employee.name} · ${options.employee.number}`
            : "Choose the person these files belong to. You can upload one document or many files."
        }
        breadcrumbs={[
          { label: "All files", href: "/documents?tab=files" },
          { label: "Upload employee files" },
        ]}
        actions={
          person ? (
            <Link href="/documents/upload" className={buttonVariants({ variant: "outline" })}>
              Choose another person
            </Link>
          ) : null
        }
      />
      {directory ? (
        <>
          <form action="/documents/upload" role="search" className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <label htmlFor="upload-person-search" className="text-sm font-medium">
                Find a person
              </label>
              <input
                id="upload-person-search"
                type="search"
                name="q"
                defaultValue={directory.query.q}
                placeholder="Name, email or employee number"
                className="h-(--control-h) w-full rounded-lg border bg-background px-3 text-sm"
              />
            </div>
            <button type="submit" className={buttonVariants()}>
              Search
            </button>
          </form>
          <ul className="divide-y rounded-xl border bg-card">
            {directory.rows.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/documents/upload?person=${p.id}`}
                  className="flex items-center justify-between gap-3 p-4 outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    <span className="block font-medium">
                      {p.preferredName || p.legalFirstName} {p.legalLastName}
                    </span>
                    <span className="text-sm text-muted-foreground">{p.employeeNumber}</span>
                  </span>
                  <span className="shrink-0 text-sm text-primary">Select</span>
                </Link>
              </li>
            ))}
          </ul>
          {directory.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No person matches. Try another name or employee number.
            </p>
          ) : null}
          <PagerLinks
            info={pageInfo(directory.total, directory.page, directory.pageSize)}
            basePath="/documents/upload"
            query={{ q: directory.query.q }}
            label={directory.total === 1 ? "person" : "people"}
          />
        </>
      ) : null}
      {options && person ? (
        <>
          <TabNav
            label="Upload method"
            current={mode}
            items={[
              { key: "one", label: "One document", href: `/documents/upload?person=${person}` },
              ...(options.types.some((t) => t.slug === "unsorted_employee")
                ? [
                    {
                      key: "many",
                      label: "Many files",
                      href: `/documents/upload?person=${person}&mode=many`,
                    },
                  ]
                : []),
            ]}
          />
          {mode === "many" ? (
            <BulkUpload target="employee" employeeId={person} types={options.types} />
          ) : (
            <UploadForm
              target="employee"
              employeeId={person}
              types={options.types}
              clients={options.clients}
              folders={folders}
              today={todayInZone()}
            />
          )}
          <Link
            href={`/people/${person}?tab=documents`}
            className="text-sm text-primary underline underline-offset-4"
          >
            View this person’s documents
          </Link>
        </>
      ) : null}
    </PageContainer>
  );
}

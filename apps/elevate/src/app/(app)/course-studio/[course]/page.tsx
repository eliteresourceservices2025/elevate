import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { NewDraftForm, RemoveAddonButton } from "@/modules/learn/components/studio-editors";
import { getStudioCourses } from "@/modules/learn/studio-queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Course versions" };

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");

export default async function CourseVersionsPage({ params }: PageProps<"/course-studio/[course]">) {
  const { course } = await params;
  const courses = await orNotFound(getStudioCourses());
  const c = courses.find((x) => x.slug === course);
  if (!c) notFound();
  const draft = c.versions.find((v) => v.status === "draft");
  const live = c.versions.find((v) => v.status === "published");
  const compare = c.versions.length >= 2;
  const removable = c.kind === "client_addon" && c.versions.every((v) => v.status === "draft");

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.title}{" "}
            {c.kind === "client_addon" ? (
              <Badge variant="outline">Client add-on{c.clientName ? `: ${c.clientName}` : ""}</Badge>
            ) : (
              <Badge variant="outline">Core course</Badge>
            )}
          </span>
        }
        description={
          <>
            <p className="mt-1 text-muted-foreground">
              Course code <code>{c.slug}</code>.{" "}
              {c.studioManaged
                ? "This course is edited here: the publish command no longer loads it from code."
                : "Not edited in the studio yet: starting a draft makes the studio its working copy."}
            </p>
          </>
        }
        breadcrumbs={[{ label: "The course studio", href: "/course-studio" }, { label: c.title }]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Versions" className="space-y-3">
          <h2 className="text-lg font-semibold">Versions</h2>
          <ul className="space-y-3">
            {c.versions.map((v) => (
              <li key={v.id} className="rounded-xl border bg-card p-5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/course-studio/${c.slug}/${v.version}`}
                    className="text-base font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Version {v.version}
                  </Link>
                  <Badge variant={v.status === "published" ? "default" : "outline"}>
                    {v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Retired"}
                  </Badge>
                  {v.material ? <Badge variant="outline">Material change</Badge> : null}
                </div>
                <p className="mt-2 text-muted-foreground">
                  {v.changeNote ? `${v.changeNote}. ` : ""}
                  {v.publishedAt
                    ? `Published ${day(v.publishedAt)}${v.counselApprovedOn ? `, counsel approved ${v.counselApprovedOn}` : ""}${v.reviewerEmail ? `, reviewed by ${v.reviewerEmail}` : ""}.`
                    : `Created ${day(v.createdAt)}${v.updatedByEmail ? `, last saved by ${v.updatedByEmail}` : ""}.`}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {draft ? (
            <Alert variant="warning" role="note" className="space-y-3 rounded-xl p-5 text-sm">
              <h2 className="text-base font-semibold">There is a draft</h2>
              <p>Version {draft.version} is being edited.</p>
              <Link
                href={`/course-studio/${c.slug}/${draft.version}`}
                className="inline-block rounded-md border bg-background px-3 py-1.5 font-medium hover:bg-accent"
              >
                Open the draft
              </Link>
            </Alert>
          ) : (
            <section className="space-y-3 rounded-xl border bg-card p-5">
              <h2 className="text-base font-semibold">Start a new draft</h2>
              <NewDraftForm course={c.slug} fromVersion={live?.version} />
            </section>
          )}

          {compare ? (
            <form
              method="get"
              action={`/course-studio/${c.slug}/diff`}
              className="space-y-4 rounded-xl border bg-card p-5"
              aria-label="Compare two versions"
            >
              <h2 className="text-base font-semibold">Compare two versions</h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label htmlFor="df-from" className="text-sm font-medium">
                    From
                  </label>
                  <select
                    id="df-from"
                    name="from"
                    defaultValue={c.versions.at(-1)?.version}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {c.versions.map((v) => (
                      <option key={v.id} value={v.version}>
                        Version {v.version}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label htmlFor="df-to" className="text-sm font-medium">
                    To
                  </label>
                  <select
                    id="df-to"
                    name="to"
                    defaultValue={c.versions[0]?.version}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {c.versions.map((v) => (
                      <option key={v.id} value={v.version}>
                        Version {v.version}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                type="submit"
                className="h-9 rounded-lg border px-3 text-sm hover:bg-secondary/50"
              >
                Show changes
              </button>
            </form>
          ) : null}

          {removable ? (
            <section className="space-y-3 rounded-xl border bg-card p-5 text-sm">
              <h2 className="text-base font-semibold">Remove this add-on</h2>
              <p className="text-muted-foreground">
                It was never published, so nobody was assigned it. Removing deletes the draft and
                closes the add-on. A published add-on cannot be removed.
              </p>
              <RemoveAddonButton course={c.slug} title={c.title} redirectTo="/course-studio" />
            </section>
          ) : null}
        </aside>
      </div>
    </PageContainer>
  );
}

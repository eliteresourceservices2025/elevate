import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { NewDraftForm } from "@/modules/learn/components/studio-editors";
import { getStudioCourses } from "@/modules/learn/studio-queries";

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

  return (
    <div className="w-full max-w-4xl space-y-6">
      <p className="text-sm">
        <Link href="/course-studio" className="text-primary underline-offset-4 hover:underline">
          Back to the course studio
        </Link>
      </p>
      <div>
        <h1 className="text-2xl font-bold">{c.title}</h1>
        <p className="mt-1 text-muted-foreground">
          Course code <code>{c.slug}</code>. {c.studioManaged ? "This course is edited here: the publish command no longer loads it from code." : "Not edited in the studio yet: starting a draft makes the studio its working copy."}
        </p>
      </div>

      {draft ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          There is a draft (version {draft.version}).{" "}
          <Link href={`/course-studio/${c.slug}/${draft.version}`} className="font-medium text-primary underline-offset-4 hover:underline">
            Open it
          </Link>
          .
        </p>
      ) : (
        <section className="rounded-xl border bg-card p-4">
          <NewDraftForm course={c.slug} fromVersion={live?.version} />
        </section>
      )}

      <section aria-label="Versions" className="space-y-2">
        <h2 className="text-lg font-semibold">Versions</h2>
        <ul className="space-y-2">
          {c.versions.map((v) => (
            <li key={v.id} className="rounded-lg border bg-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/course-studio/${c.slug}/${v.version}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  Version {v.version}
                </Link>
                <Badge variant={v.status === "published" ? "default" : "outline"}>{v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Retired"}</Badge>
                {v.material ? <Badge variant="outline">Material change</Badge> : null}
              </div>
              <p className="mt-1 text-muted-foreground">
                {v.changeNote ? `${v.changeNote}. ` : ""}
                {v.publishedAt ? `Published ${day(v.publishedAt)}${v.counselApprovedOn ? `, counsel approved ${v.counselApprovedOn}` : ""}${v.reviewerEmail ? `, reviewed by ${v.reviewerEmail}` : ""}.` : `Created ${day(v.createdAt)}${v.updatedByEmail ? `, last saved by ${v.updatedByEmail}` : ""}.`}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {compare ? (
        <form method="get" action={`/course-studio/${c.slug}/diff`} className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4" aria-label="Compare two versions">
          <div className="space-y-1">
            <label htmlFor="df-from" className="text-sm font-medium">
              Compare
            </label>
            <select id="df-from" name="from" defaultValue={c.versions.at(-1)?.version} className="h-9 rounded-md border bg-background px-2 text-sm">
              {c.versions.map((v) => (
                <option key={v.id} value={v.version}>
                  Version {v.version}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="df-to" className="text-sm font-medium">
              with
            </label>
            <select id="df-to" name="to" defaultValue={c.versions[0]?.version} className="h-9 rounded-md border bg-background px-2 text-sm">
              {c.versions.map((v) => (
                <option key={v.id} value={v.version}>
                  Version {v.version}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="h-9 rounded-lg border px-3 text-sm hover:bg-secondary/50">
            Show changes
          </button>
        </form>
      ) : null}
    </div>
  );
}

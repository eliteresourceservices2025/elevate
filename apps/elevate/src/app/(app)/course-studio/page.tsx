import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { NewAddonForm } from "@/modules/learn/components/studio-editors";
import { getStudioCourses, listAddonClients } from "@/modules/learn/studio-queries";

export const metadata: Metadata = { title: "Course studio" };

export default async function CourseStudioPage() {
  const courses = await orNotFound(getStudioCourses());
  const addonClients = await orNotFound(listAddonClients());
  return (
    <div className="w-full max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Course studio</h1>
        <p className="mt-1 text-muted-foreground">
          Read the training courses, see what changed between versions, and edit the wording and exam questions. A published version never changes: an edit is
          always a new version that someone other than the editor publishes.
        </p>
      </div>
      {courses.length === 0 ? <p className="rounded-xl border p-6 text-sm text-muted-foreground">No course has been loaded yet.</p> : null}
      <ul className="space-y-3">
        {courses.map((c) => {
          const live = c.versions.find((v) => v.status === "published");
          const draft = c.versions.find((v) => v.status === "draft");
          return (
            <li key={c.slug} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/course-studio/${c.slug}`} className="text-lg font-semibold text-primary underline-offset-4 hover:underline">
                  {c.title}
                </Link>
                {live ? <Badge>Live: version {live.version}</Badge> : <Badge variant="outline">Not published</Badge>}
                {draft ? <Badge variant="outline">Draft: version {draft.version}</Badge> : null}
                {c.kind === "client_addon" ? <Badge variant="outline">Client add-on{c.clientName ? `: ${c.clientName}` : ""}</Badge> : null}
                {c.studioManaged ? <Badge variant="outline">Edited in the studio</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {c.versions.length} {c.versions.length === 1 ? "version" : "versions"}
                {live?.counselApprovedOn ? `. Counsel approved the live version on ${live.counselApprovedOn}.` : "."}
              </p>
            </li>
          );
        })}
      </ul>

      <section aria-label="New client add-on" className="space-y-2 rounded-xl border bg-card p-4">
        <h2 className="text-lg font-semibold">New client add-on</h2>
        <NewAddonForm clients={addonClients} />
      </section>
    </div>
  );
}

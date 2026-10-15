import type { Metadata } from "next";
import { orNotFound } from "@/lib/or-not-found";
import { NewAddonForm } from "@/modules/learn/components/studio-editors";
import {
  StudioCourseList,
  type StudioListCourse,
} from "@/modules/learn/components/studio-course-list";
import { getStudioCourses, listAddonClients } from "@/modules/learn/studio-queries";

export const metadata: Metadata = { title: "Course studio" };

export default async function CourseStudioPage() {
  const courses = await orNotFound(getStudioCourses());
  const addonClients = await orNotFound(listAddonClients());

  const list: StudioListCourse[] = courses.map((c) => {
    const live = c.versions.find((v) => v.status === "published");
    const draft = c.versions.find((v) => v.status === "draft");
    const changed =
      c.versions
        .map((v) => v.updatedAt ?? v.publishedAt ?? v.createdAt)
        .sort()
        .at(-1) ?? null;
    return {
      slug: c.slug,
      title: c.title,
      kind: c.kind,
      clientName: c.clientName,
      studioManaged: c.studioManaged,
      versions: c.versions.length,
      liveVersion: live?.version ?? null,
      draftVersion: draft?.version ?? null,
      counselApprovedOn: live?.counselApprovedOn ?? null,
      updatedAt: changed,
      // an add-on whose versions are all drafts never went live, so nobody was assigned it and it may be removed
      removable: c.kind === "client_addon" && c.versions.every((v) => v.status === "draft"),
    };
  });

  return (
    <div className="w-full space-y-8">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold">Course studio</h1>
        <p className="mt-1 text-muted-foreground">
          Read the training courses, see what changed between versions, and edit the wording and
          exam questions. A published version never changes: an edit is always a new version that
          someone other than the editor publishes.
        </p>
      </div>

      <section aria-label="New client add-on" className="rounded-xl border bg-card p-6">
        <div className="mb-4 max-w-3xl">
          <h2 className="text-lg font-semibold">New client add-on</h2>
          <p className="text-sm text-muted-foreground">
            A short course for the people assigned to one client. Nothing is assigned until you
            publish it.
          </p>
        </div>
        <NewAddonForm clients={addonClients} />
      </section>

      {list.length === 0 ? (
        <p className="rounded-xl border p-6 text-sm text-muted-foreground">
          No course has been loaded yet.
        </p>
      ) : (
        <StudioCourseList courses={list} />
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { CourseMetaForm, DiscardDraftButton, PublishCard } from "@/modules/learn/components/studio-editors";
import { LintList } from "@/modules/learn/components/studio-view";
import { hasErrors } from "@/modules/learn/studio-lint";
import { getStudioVersion } from "@/modules/learn/studio-queries";

export const metadata: Metadata = { title: "Course version" };

export default async function StudioVersionPage({ params }: PageProps<"/course-studio/[course]/[version]">) {
  const { course, version } = await params;
  const data = await orNotFound(getStudioVersion(course, Number(version)));
  if (!data) notFound();
  const { loaded, lint, viewerId } = data;
  const v = loaded.version;
  const draft = v.status === "draft";
  const cfg = loaded.examConfig as { passPercent?: number; maxTries?: number; renewalMonths?: number; tracks?: Record<string, { questions: number }> };
  const base = `/course-studio/${course}/${v.version}`;
  const lastEditorIsViewer = Boolean(v.updatedBy && v.updatedBy === viewerId);
  const blocked = hasErrors(lint) ? "Fix the problems listed above first." : lastEditorIsViewer ? "You saved the last change, so someone else has to publish this draft." : null;

  return (
    <div className="w-full max-w-4xl space-y-6">
      <p className="text-sm">
        <Link href={`/course-studio/${course}`} className="text-primary underline-offset-4 hover:underline">
          Back to the versions of {loaded.course.title}
        </Link>
      </p>
      <div>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
          {loaded.content.title}, version {v.version}
          <Badge variant={v.status === "published" ? "default" : "outline"}>{v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Retired"}</Badge>
        </h1>
        {v.changeNote ? <p className="mt-1 text-muted-foreground">{v.changeNote}</p> : null}
        <p className="mt-1 text-sm text-muted-foreground">
          {draft ? "You can edit this draft. Other versions are frozen." : "A published or retired version is frozen. To change it, start a new draft from the versions page."}
        </p>
      </div>

      <section aria-label="Checks" className="space-y-2">
        <h2 className="text-lg font-semibold">Checks</h2>
        <LintList issues={lint} />
      </section>

      <section aria-label="Exam rules" className="rounded-xl border bg-card p-4 text-sm">
        <h2 className="text-lg font-semibold">Exam and certificate</h2>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          <li>Pass mark {cfg.passPercent}%, {cfg.maxTries} tries.</li>
          <li>Certificate valid {cfg.renewalMonths} months.</li>
          {Object.entries(cfg.tracks ?? {}).map(([t, x]) => (
            <li key={t}>
              {t} track: {x.questions} questions
            </li>
          ))}
          <li>{loaded.questions.length} questions in the bank.</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">These rules are part of the version. Changing them is done in code for now.</p>
      </section>

      <section aria-label="Modules" className="space-y-2">
        <h2 className="text-lg font-semibold">Modules</h2>
        <ol className="space-y-2">
          {loaded.content.modules.map((m, i) => (
            <li key={m.key} className="rounded-lg border bg-card p-3 text-sm">
              <Link href={`${base}/m/${m.key}`} className="font-medium text-primary underline-offset-4 hover:underline">
                {i + 1}. {m.title}
              </Link>
              <p className="text-muted-foreground">
                {m.estimatedMinutes} minutes, {m.screens.length} screens, tracks: {m.tracks.join(", ")}. {loaded.questions.filter((q) => q.moduleKey === m.key).length} exam questions.
              </p>
            </li>
          ))}
        </ol>
        <p className="text-sm">
          <Link href={`${base}/questions`} className="text-primary underline-offset-4 hover:underline">
            Open the exam question bank
          </Link>
        </p>
      </section>

      {draft ? (
        <>
          <CourseMetaForm key={v.editStamp} versionId={v.id} stamp={v.editStamp} content={loaded.content} />
          <PublishCard versionId={v.id} canPublish={!blocked} blocked={blocked} />
          <DiscardDraftButton versionId={v.id} stamp={v.editStamp} course={course} />
        </>
      ) : (
        <section aria-label="Statement" className="rounded-xl border bg-card p-4 text-sm">
          <h2 className="text-lg font-semibold">Responsibility statement</h2>
          <p className="mt-1">{loaded.content.attestation.text}</p>
          <p className="mt-1 text-xs text-muted-foreground">Version label: {loaded.content.attestation.version}</p>
        </section>
      )}
    </div>
  );
}

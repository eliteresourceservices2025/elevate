import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import {
  CourseMetaForm,
  DiscardDraftButton,
  PublishCard,
} from "@/modules/learn/components/studio-editors";
import {
  AddModuleForm,
  ExamRulesForm,
  ModuleControls,
} from "@/modules/learn/components/studio-structure";
import { LintList } from "@/modules/learn/components/studio-view";
import { StudioComments } from "@/modules/learn/components/studio-comments";
import { canPublish, publishChecklist } from "@/modules/learn/studio-checklist";
import { learnBaseUrl } from "@/modules/learn/token";
import { getStudioComments, getStudioVersion } from "@/modules/learn/studio-queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Course version" };

export default async function StudioVersionPage({
  params,
}: PageProps<"/course-studio/[course]/[version]">) {
  const { course, version } = await params;
  const data = await orNotFound(getStudioVersion(course, Number(version)));
  if (!data) notFound();
  const { loaded, lint, viewerId, unchangedVsLive } = data;
  const v = loaded.version;
  const draft = v.status === "draft";
  const cfg = loaded.examConfig as {
    passPercent?: number;
    maxTries?: number;
    renewalMonths?: number;
    tracks?: Record<string, { questions: number }>;
  };
  const base = `/course-studio/${course}/${v.version}`;
  const lastEditorIsViewer = Boolean(v.updatedBy && v.updatedBy === viewerId);
  const comments = await orNotFound(getStudioComments(course, v.version));
  const checklist = publishChecklist({
    issues: lint,
    unchangedVsLive,
    viewerIsLastEditor: lastEditorIsViewer,
    openComments: comments.filter((c) => !c.resolved).length,
  });
  const ready = canPublish(checklist);
  const learnUrl = learnBaseUrl();

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {loaded.content.title}, version {v.version}
            <Badge variant={v.status === "published" ? "default" : "outline"}>
              {v.status === "published" ? "Live" : v.status === "draft" ? "Draft" : "Retired"}
            </Badge>
          </span>
        }
        description={
          <>
            {v.changeNote ? <p className="mt-1 text-muted-foreground">{v.changeNote}</p> : null}
            <p className="mt-1 text-sm text-muted-foreground">
              {draft
                ? "You can edit this draft. Other versions are frozen."
                : "A published or retired version is frozen. To change it, start a new draft from the versions page."}
            </p>
          </>
        }
        breadcrumbs={[{ label: `The versions of ${loaded.course.title}`, href: `/course-studio/${course}` }, { label: `${loaded.content.title}, version ${v.version}` }]}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0 space-y-6">
          {learnUrl ? (
            <p className="text-sm">
              <a
                href={`${learnUrl}/preview/${course}/${v.version}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Preview the lessons in ELEVATE Learn
              </a>{" "}
              <span className="text-muted-foreground">
                (opens in a new tab; you may need to open training once to sign in there; nothing is
                recorded)
              </span>
            </p>
          ) : null}

          <section aria-label="Checks" className="space-y-2">
            <h2 className="text-lg font-semibold">Checks</h2>
            <LintList issues={lint} />
          </section>

          <section aria-label="Exam rules" className="rounded-xl border bg-card p-4 text-sm">
            <h2 className="text-lg font-semibold">Exam and certificate</h2>
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              <li>
                Pass mark {cfg.passPercent}%, {cfg.maxTries} tries.
              </li>
              <li>Certificate valid {cfg.renewalMonths} months.</li>
              {Object.entries(cfg.tracks ?? {}).map(([t, x]) => (
                <li key={t}>
                  {t} track: {x.questions} questions
                </li>
              ))}
              <li>{loaded.questions.length} questions in the bank.</li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              These rules are part of the version.{draft ? " You can change them below." : ""}
            </p>
          </section>

          <section aria-label="Modules" className="space-y-2">
            <h2 className="text-lg font-semibold">Modules</h2>
            <ol className="space-y-2">
              {loaded.content.modules.map((m, i) => (
                <li key={m.key} className="rounded-lg border bg-card p-3 text-sm">
                  <Link
                    href={`${base}/m/${m.key}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {i + 1}. {m.title}
                  </Link>
                  <p className="text-muted-foreground">
                    {m.estimatedMinutes} minutes, {m.screens.length} screens, tracks:{" "}
                    {m.tracks.join(", ")}.{" "}
                    {loaded.questions.filter((q) => q.moduleKey === m.key).length} exam questions.
                  </p>
                  {draft ? (
                    <div className="mt-2">
                      <ModuleControls
                        versionId={v.id}
                        stamp={v.editStamp}
                        moduleKey={m.key}
                        title={m.title}
                        index={i}
                        count={loaded.content.modules.length}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
            <p className="text-sm">
              <Link
                href={`${base}/questions`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Open the exam question bank
              </Link>

              {" · "}
              <Link
                href={`${base}/stats`}
                className="text-primary underline-offset-4 hover:underline"
              >
                See how learners do (statistics)
              </Link>
              {" · "}
              <Link
                href={`${base}/exam`}
                className="text-primary underline-offset-4 hover:underline"
              >
                Preview the exam
              </Link>
            </p>
          </section>

          {draft ? (
            <>
              <AddModuleForm key={`am-${v.editStamp}`} versionId={v.id} stamp={v.editStamp} />
              <ExamRulesForm
                key={`er-${v.editStamp}`}
                versionId={v.id}
                stamp={v.editStamp}
                config={cfg}
              />
              <CourseMetaForm
                key={v.editStamp}
                versionId={v.id}
                stamp={v.editStamp}
                content={loaded.content}
              />
            </>
          ) : (
            <section aria-label="Statement" className="rounded-xl border bg-card p-4 text-sm">
              <h2 className="text-lg font-semibold">Responsibility statement</h2>
              <p className="mt-1">{loaded.content.attestation.text}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Version label: {loaded.content.attestation.version}
              </p>
            </section>
          )}
        </div>

        {draft ? (
          <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
            <section
              aria-label="Publish checklist"
              className="space-y-2 rounded-xl border bg-card p-4"
            >
              <h2 className="text-lg font-semibold">Before publishing</h2>
              <ul className="space-y-1 text-sm">
                {checklist.map((c) => (
                  <li key={c.label} className="flex gap-2">
                    <span aria-hidden>{c.ok ? "\u2713" : c.required ? "\u2717" : "!"}</span>
                    <span>
                      <span className="sr-only">
                        {c.ok
                          ? "Done: "
                          : c.required
                            ? "Required, not done: "
                            : "Advised, not done: "}
                      </span>
                      {c.label}
                      {c.required ? "" : " (advised)"}
                      {c.detail && !c.ok ? (
                        <span className="block text-xs text-muted-foreground">{c.detail}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <PublishCard
              addon={loaded.course.kind === "client_addon"}
              versionId={v.id}
              canPublish={ready}
              blocked={ready ? null : "Finish the required items above first."}
            />
            <DiscardDraftButton versionId={v.id} stamp={v.editStamp} course={course} />

            <StudioComments
              versionId={v.id}
              comments={comments}
              modules={loaded.content.modules.map((m) => ({ key: m.key, title: m.title }))}
              draft={draft}
            />
          </aside>
        ) : null}
      </div>
    </PageContainer>
  );
}

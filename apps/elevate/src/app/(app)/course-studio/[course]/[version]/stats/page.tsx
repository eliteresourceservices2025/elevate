import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { getCourseStats } from "@/modules/learn/studio-queries";
import { LEARN_MIN_GROUP } from "@/modules/learn/studio-stats";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Course statistics" };

export default async function StudioStatsPage({ params }: { params: Promise<{ course: string; version: string }> }) {
  const { course, version } = await params;
  const stats = await orNotFound(getCourseStats(course, Number(version)));
  if (!stats) notFound();

  return (
    <PageContainer width="wide">
      <p className="text-sm">
        <Link href={`/course-studio/${course}/${version}`} className="text-primary underline-offset-4 hover:underline">
          Back to version {version}
        </Link>
      </p>
      <PageHeader
        title={<>How learners do: version {stats.version}</>}
        description={
          <>
            Built from {stats.attempts} submitted exam {stats.attempts === 1 ? "try" : "tries"}. Counts and percentages only: no names and no
            one&apos;s score. A figure that comes from fewer than {LEARN_MIN_GROUP} people is not shown. Use it to find lessons or questions
            that need rewording, not to judge people.
          </>
        }
      />

      <section aria-labelledby="mods-h" className="space-y-2">
        <h2 id="mods-h" className="text-lg font-semibold">
          Modules
        </h2>
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Module</th>
                <th className="p-3 font-medium">People who finished it</th>
                <th className="p-3 font-medium">Average time</th>
                <th className="p-3 font-medium">Questions missed</th>
              </tr>
            </thead>
            <tbody>
              {stats.modules.map((m) => (
                <tr key={m.key} className="border-b last:border-0">
                  <td className="p-3 font-medium">{m.title}</td>
                  <td className="p-3">{m.hidden || m.avgMinutes === null ? "Not enough people yet" : m.people}</td>
                  <td className="p-3">{m.avgMinutes === null ? "n/a" : `${m.avgMinutes} min`}</td>
                  <td className="p-3">{m.missPercent === null ? "n/a" : `${m.missPercent}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="pr-h" className="space-y-2">
        <h2 id="pr-h" className="text-lg font-semibold">
          Quarterly practice (whole course)
        </h2>
        {stats.practice.length === 0 ? <p className="text-sm text-muted-foreground">No one has answered a practice scenario yet.</p> : null}
        <ul className="space-y-1 text-sm">
          {stats.practice.map((q) => (
            <li key={q.quarter} className="rounded-xl border bg-card p-3">
              <span className="font-medium">{q.quarter}</span>: {"hidden" in q ? "Not enough people yet" : `${q.people} people answered, ${q.correctPercent}% chose the better answer`}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="qs-h" className="space-y-2">
        <h2 id="qs-h" className="text-lg font-semibold">
          Questions, most missed first
        </h2>
        {stats.questions.length === 0 ? <p className="text-sm text-muted-foreground">No exam tries on this version yet.</p> : null}
        <ul className="space-y-2">
          {stats.questions.map((q) => (
            <li key={q.id} className="rounded-xl border bg-card p-3 text-sm">
              <p className="font-medium">{q.stem}</p>
              <p className="text-muted-foreground">
                {q.topic} · {"hidden" in q ? "Not enough people yet" : `missed by ${q.missPercent}% of ${q.shown} answers`}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}

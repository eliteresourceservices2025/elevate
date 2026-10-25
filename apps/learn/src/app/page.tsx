import { Award, BookOpenCheck, ClipboardList, Hourglass, Zap } from "lucide-react";
import { CourseCard, HomeTile, homeStatus } from "@/components/course-card";
import { requireSession } from "@/lib/auth";
import { getSql, withUser } from "@/lib/db";
import { getPractice, listAssignments } from "@/lib/queries";
import type { Metadata } from "next";

// The root layout's title template does not apply to the page of its own segment, so the full title is written out here.
export const metadata: Metadata = { title: { absolute: "My training · ELEVATE Learn" } };

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requireSession();
  const sql = getSql();
  const person = await withUser(sql, session.userId, async (tx) => (await tx`select display_name from learn.v_learners`)[0] as { display_name: string } | undefined);
  const assignments = await listAssignments(sql, session.userId);
  const practice = await getPractice(sql, session.userId);
  const practiceOpen = practice.filter((x) => !x.answered).length;
  const todo = assignments.filter((a) => ["new", "progress"].includes(homeStatus(a.status))).length;
  const passed = assignments.filter((a) => homeStatus(a.status) === "done").length;

  return (
    <div className="page-wide">
      <section className="hero" aria-label="Welcome">
        <div>
          <h1>Hello{person ? `, ${person.display_name}` : ""}</h1>
          <p>Pick up where you left off, or start something new.</p>
        </div>
        {assignments.length > 0 ? (
          <ul className="hero-stats" aria-label="Where you are">
            <li>
              <Hourglass size={18} aria-hidden="true" />
              <strong>{todo}</strong> to finish
            </li>
            <li>
              <Award size={18} aria-hidden="true" />
              <strong>{passed}</strong> passed
            </li>
          </ul>
        ) : null}
      </section>
      {assignments.length === 0 ? (
        <p>You have no training assigned yet. If you expected something here, please ask HR.</p>
      ) : (
        <ul className="mod-grid" aria-label="My training">
          {assignments.map((a) => (
            <CourseCard key={a.id} slug={a.slug} title={a.title} track={a.track} status={a.status} dueOn={a.dueOn} isUpdate={a.isUpdate} reason={a.reason} href={`/course/${a.id}`} />
          ))}
        </ul>
      )}
      <h2 className="home-more">More for you</h2>
      <ul className="mod-grid" aria-label="More for you">
        {practiceOpen > 0 ? <HomeTile art="practice" title="Quarterly practice" text="A two-minute scenario is ready. It is not a test." action="Try it" href="/practice" icon={<Zap size={15} aria-hidden="true" />} /> : null}
        <HomeTile art="record" title="My training record" text="Your courses, dates and certificates in one place, with a PDF you can keep." action="Open my record" href="/record" icon={<ClipboardList size={15} aria-hidden="true" />} />
        <HomeTile art="cards" title="Quick-reference cards" text="The key points of every module on one page, for when you need a reminder." action="Open the cards" href="/cards" icon={<BookOpenCheck size={15} aria-hidden="true" />} />
      </ul>
    </div>
  );
}

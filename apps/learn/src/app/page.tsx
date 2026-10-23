import { BookOpenCheck, ClipboardList, LogOut, Zap } from "lucide-react";
import { CourseCard, HomeTile } from "@/components/course-card";
import { requireSession } from "@/lib/auth";
import { getSql, withUser } from "@/lib/db";
import { getPractice, listAssignments } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await requireSession();
  const sql = getSql();
  const person = await withUser(sql, session.userId, async (tx) => (await tx`select display_name from learn.v_learners`)[0] as { display_name: string } | undefined);
  const assignments = await listAssignments(sql, session.userId);
  const practice = await getPractice(sql, session.userId);
  const practiceOpen = practice.filter((x) => !x.answered).length;

  return (
    <>
      <h1>Hello{person ? `, ${person.display_name}` : ""}</h1>
      <p className="muted">Pick up where you left off, or start something new.</p>
      {assignments.length === 0 ? (
        <p>You have no training assigned yet. If you expected something here, please ask HR.</p>
      ) : (
        <ul className="mod-grid home-grid" aria-label="My training">
          {assignments.map((a) => (
            <CourseCard key={a.id} slug={a.slug} title={a.title} track={a.track} status={a.status} dueOn={a.dueOn} isUpdate={a.isUpdate} href={`/course/${a.id}`} />
          ))}
        </ul>
      )}
      <h2 className="home-more">More for you</h2>
      <ul className="mod-grid home-grid" aria-label="More for you">
        {practiceOpen > 0 ? <HomeTile art="practice" title="Quarterly practice" text="A two-minute scenario is ready. It is not a test." action="Try it" href="/practice" icon={<Zap size={15} aria-hidden="true" />} /> : null}
        <HomeTile art="record" title="My training record" text="Your courses, dates and certificates in one place, with a PDF you can keep." action="Open my record" href="/record" icon={<ClipboardList size={15} aria-hidden="true" />} />
        <HomeTile art="cards" title="Quick-reference cards" text="The key points of every module on one page, for when you need a reminder." action="Open the cards" href="/cards" icon={<BookOpenCheck size={15} aria-hidden="true" />} />
      </ul>
      <form method="post" action="/auth/signout" className="home-signout">
        <button type="submit" className="secondary signout-btn">
          <LogOut size={16} aria-hidden="true" /> Sign out of training
        </button>
      </form>
    </>
  );
}

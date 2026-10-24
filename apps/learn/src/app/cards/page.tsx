import { BookOpenCheck, Check } from "lucide-react";
import { HomeArt } from "@/components/home-art";
import { PageHead } from "@/components/page-head";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getCards } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Quick-reference cards: the key points of each module of the person's own courses, to look things up after the course. */
export default async function CardsPage() {
  const session = await requireSession();
  const courses = await getCards(getSql(), session.userId);

  return (
    <div className="page-wide">
      <PageHead
        icon={<BookOpenCheck size={30} />}
        title="Quick-reference cards"
        text="The key points from each module, for a quick look when you are unsure. They are a reminder, not a replacement for the lessons or for your client's own instructions."
      />
      {courses.length === 0 ? <p>There are no cards for you yet. They appear once you have training assigned.</p> : null}
      {courses.map((c) => (
        <section key={c.courseSlug} className="cards-course" aria-labelledby={`c-${c.courseSlug}`}>
          <header className="cards-course-head">
            <div className="cards-thumb">
              <HomeArt name={c.courseSlug} />
            </div>
            <div>
              <h2 id={`c-${c.courseSlug}`}>{c.courseTitle}</h2>
              <p className="muted">
                {c.modules.length} {c.modules.length === 1 ? "card" : "cards"}
              </p>
            </div>
          </header>
          <ul className="keycards">
            {c.modules.map((m, i) => (
              <li key={m.key} className="keycard">
                <span className="keycard-num">{i + 1}</span>
                <h3>{m.title}</h3>
                <ul>
                  {m.keyPoints.map((p, k) => (
                    <li key={k}>
                      <Check size={15} aria-hidden="true" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

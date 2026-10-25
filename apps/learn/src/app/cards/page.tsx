import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getCards } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reference cards" };

export const dynamic = "force-dynamic";

/** Quick-reference cards: the key points of each module of the person's own courses, to look things up after the course. */
export default async function CardsPage() {
  const session = await requireSession();
  const courses = await getCards(getSql(), session.userId);

  return (
    <>
      <p className="muted no-print">
        <Link href="/">Back to my training</Link>
      </p>
      <h1>Quick-reference cards</h1>
      <p className="muted">The key points from each module, for a quick look when you are unsure. They are a reminder, not a replacement for the lessons or for your client&apos;s own instructions.</p>
      {courses.length === 0 ? <p>There are no cards for you yet. They appear once you have training assigned.</p> : null}
      {courses.map((c) => (
        <section key={c.courseSlug} aria-labelledby={`c-${c.courseSlug}`}>
          <h2 id={`c-${c.courseSlug}`}>{c.courseTitle}</h2>
          <ul className="plain">
            {c.modules.map((m) => (
              <li key={m.key} className="card">
                <strong>{m.title}</strong>
                <ul>
                  {m.keyPoints.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

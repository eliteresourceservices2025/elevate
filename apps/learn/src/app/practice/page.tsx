import Link from "next/link";
import { DrillForm } from "@/components/forms";
import { requireSession } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { getPractice } from "@/lib/queries";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Quarterly practice" };

export const dynamic = "force-dynamic";

/** The quarter's two-minute practice scenarios, one per course. A nudge: nothing is graded and nothing blocks work. */
export default async function PracticePage() {
  const session = await requireSession();
  const items = await getPractice(getSql(), session.userId);

  return (
    <>
      <p className="muted">
        <Link href="/">Back to my training</Link>
      </p>
      <h1>Quarterly practice</h1>
      <p className="muted">A two-minute scenario each quarter. It is not a test: nothing is scored against you and nothing is held back. Pick what you would do.</p>
      {items.length === 0 ? (
        <p>There is no practice for you yet. It appears once you have training assigned.</p>
      ) : (
        items.map((it) => (
          <section key={it.courseSlug} className="card" aria-labelledby={`d-${it.courseSlug}`}>
            <p className="muted small">
              {it.courseTitle} · {it.quarter}
            </p>
            <h2 id={`d-${it.courseSlug}`}>{it.drill.title}</h2>
            <p>{it.drill.scenario}</p>
            <DrillForm
              course={it.courseSlug}
              options={it.drill.options}
              best={it.answered ? it.drill.best : null}
              explanation={it.answered ? it.drill.explanation : null}
              answered={it.answered}
            />
          </section>
        ))
      )}
    </>
  );
}

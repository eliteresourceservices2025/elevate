import { Zap } from "lucide-react";
import { DrillForm } from "@/components/forms";
import { HomeArt } from "@/components/home-art";
import { PageHead } from "@/components/page-head";
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
    <div className="page-wide">
      <PageHead
        icon={<Zap size={30} />}
        title="Quarterly practice"
        text="A two-minute scenario each quarter. It is not a test: nothing is scored against you and nothing is held back. Pick what you would do."
      />
      {items.length === 0 ? (
        <p>There is no practice for you yet. It appears once you have training assigned.</p>
      ) : (
        <ul className="drill-grid">
          {items.map((it) => (
            <li key={it.courseSlug} className="drill-card" aria-labelledby={`d-${it.courseSlug}`}>
              <div className="drill-art">
                <HomeArt name="practice" />
                <span className="mod-chip inline progress">{it.quarter}</span>
              </div>
              <div className="drill-body">
                <p className="mod-num">{it.courseTitle}</p>
                <h2 id={`d-${it.courseSlug}`}>{it.drill.title}</h2>
                <p>{it.drill.scenario}</p>
                <DrillForm
                  course={it.courseSlug}
                  options={it.drill.options}
                  best={it.answered ? it.drill.best : null}
                  explanation={it.answered ? it.drill.explanation : null}
                  answered={it.answered}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

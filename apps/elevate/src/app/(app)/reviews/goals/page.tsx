import type { Metadata } from "next";
import Link from "next/link";
import { PagerLinks } from "@/components/pager";
import { orNotFound } from "@/lib/or-not-found";
import { paginate, parsePaging } from "@/lib/pagination";
import { GoalCard, NewGoalForm } from "@/modules/reviews/components/goals-panel";
import { listGoals } from "@/modules/reviews/queries";

export const metadata: Metadata = { title: "Goals" };

export default async function GoalsPage({ searchParams }: PageProps<"/reviews/goals">) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
  const { goals, people } = await orNotFound(listGoals());
  const paging = parsePaging({ page: one(sp.page), size: one(sp.size) }, 10);
  const { rows, info } = paginate(goals, paging.page, paging.pageSize);
  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/reviews" className="text-sm text-primary underline-offset-2 hover:underline">
          All reviews
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Goals</h1>
        <p className="mt-1 text-muted-foreground">Goals you and your lead agree on. Update the status and add progress notes as you go.</p>
      </div>
      <NewGoalForm people={people} />
      {goals.length === 0 ? (
        <p className="text-sm text-muted-foreground">No goals yet.</p>
      ) : (
        <div className="space-y-2">
          <ul className="space-y-3">
            {rows.map((g) => (
              <GoalCard key={g.id} goal={g} />
            ))}
          </ul>
          <PagerLinks info={info} basePath="/reviews/goals" defaultSize={10} label="goals" />
        </div>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { OrgChart } from "@/modules/org/components/org-chart";
import { OrgList } from "@/modules/org/components/org-list";
import { getOrgChart } from "@/modules/org/queries";

export const metadata: Metadata = { title: "Org chart" };

export default async function OrgChartPage({ searchParams }: PageProps<"/org-chart">) {
  const view = (await searchParams).view === "list" ? "list" : "chart";
  const people = await getOrgChart();

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Org chart</h1>
          <p className="mt-1 text-muted-foreground">
            {people.length} {people.length === 1 ? "person" : "people"}. Click a person to open their profile when you have access.
          </p>
        </div>
        <nav aria-label="View" className="flex gap-1 rounded-lg border bg-card p-1 text-sm">
          {(["chart", "list"] as const).map((v) => (
            <Link
              key={v}
              href={`/org-chart${v === "list" ? "?view=list" : ""}`}
              aria-current={view === v ? "page" : undefined}
              className={cn("rounded-md px-3 py-1 capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {v}
            </Link>
          ))}
        </nav>
      </div>
      {view === "chart" ? <OrgChart people={people} /> : <OrgList people={people} />}
    </div>
  );
}

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { indexPeople } from "../layout";
import type { ChartNode } from "../queries";

// The same tree as the chart, as nested lists: readable with a keyboard or screen reader.
export function OrgList({ people }: { people: ChartNode[] }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  const { childIds, roots } = indexPeople(people);
  const seen = new Set<string>();

  function Person({ id }: { id: string }) {
    const p = byId.get(id);
    if (!p || seen.has(id)) return null;
    seen.add(id);
    const kids = childIds.get(id) ?? [];
    return (
      <li>
        <div className="flex flex-wrap items-baseline gap-x-2 py-1">
          {p.canOpen ? (
            <Link href={`/people/${p.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
              {p.name}
            </Link>
          ) : (
            <span className="font-medium">{p.name}</span>
          )}
          <span className="text-sm text-muted-foreground">
            {p.position ?? "No position"}
            {p.team ? ` · ${p.team}` : ""}
          </span>
          {p.status !== "active" ? <Badge variant="secondary">{p.status.replace("_", " ")}</Badge> : null}
          {kids.length > 0 ? <span className="text-xs text-muted-foreground">({kids.length} direct)</span> : null}
        </div>
        {kids.length > 0 ? (
          <ul className="ml-4 border-l pl-4">
            {kids.map((k) => (
              <Person key={k} id={k} />
            ))}
          </ul>
        ) : null}
      </li>
    );
  }

  if (people.length === 0) return <p className="text-muted-foreground">No one to show yet.</p>;
  return (
    <ul aria-label="Organization list" className="rounded-xl border bg-card p-4">
      {roots.map((r) => (
        <Person key={r} id={r} />
      ))}
    </ul>
  );
}

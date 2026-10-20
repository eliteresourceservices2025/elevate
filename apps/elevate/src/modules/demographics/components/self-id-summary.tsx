import { orNotFound } from "@/lib/or-not-found";
import { getSelfIdentificationSummary } from "../queries";
import type { Group } from "../service";

function Block({ title, groups, minGroup }: { title: string; groups: Group[]; minGroup: number }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not enough answers yet. A group is shown only when {minGroup} or more people chose it.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {groups.map((g) => (
            <li key={g.key} className="flex items-center justify-between gap-4 rounded-md border bg-card px-3 py-1.5">
              <span>{g.label}</span>
              <span className="font-medium tabular-nums">{g.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** HR only. Combined counts of voluntary answers; a group under the minimum is left out, and no names or totals are shown. */
export async function SelfIdSummary() {
  const s = await orNotFound(getSelfIdentificationSummary());
  return (
    <section aria-labelledby="self-id-summary" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <div>
        <h2 id="self-id-summary" className="text-lg font-semibold">
          Self-identification (voluntary)
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What people chose to share about themselves and applicants chose to share when applying. It is never tied to a name here, and it is not used for hiring decisions.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Block title="People: gender" groups={s.employees.gender} minGroup={s.minGroup} />
        <Block title="People: religion" groups={s.employees.religion} minGroup={s.minGroup} />
        <Block title="Applicants: gender" groups={s.applicants.gender} minGroup={s.minGroup} />
        <Block title="Applicants: religion" groups={s.applicants.religion} minGroup={s.minGroup} />
      </div>
    </section>
  );
}

import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS, type RoleSlug } from "@/lib/roles";
import { getGreeting } from "../queries";
import { LensTabs } from "./lens-tabs";
import type { Lens } from "../lens";

/** "Good morning, Maria" with today's date, the person's roles and (for people holding several) the view switcher. */
export async function GreetingHeader({ roles, lenses, lens, summary }: { roles: readonly RoleSlug[]; lenses: Lens[]; lens: Lens; summary?: string | null }) {
  const g = await getGreeting();
  // The base Employee role is on everyone, so it is only shown when it is the person's only role.
  const shown = roles.length > 1 ? roles.filter((r) => r !== "employee") : roles;
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {g.greeting}
            {g.name ? `, ${g.name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {g.dateLabel}
            {summary ? ` · ${summary}` : ""}
          </p>
        </div>
        <ul className="flex flex-wrap gap-1.5" aria-label="Your roles">
          {shown.map((r) => (
            <li key={r}>
              {/* eslint-disable-next-line security/detect-object-injection -- r is a typed RoleSlug */}
              <Badge variant="outline">{ROLE_LABELS[r]}</Badge>
            </li>
          ))}
        </ul>
      </div>
      <LensTabs lenses={lenses} current={lens} />
    </header>
  );
}

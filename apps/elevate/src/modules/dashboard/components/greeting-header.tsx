import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { ROLE_LABELS, type RoleSlug } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { getApprovalQueue } from "../feed-queries";
import { getGreeting } from "../queries";
import { LensTabs } from "./lens-tabs";
import type { Lens } from "../lens";
import { guarded } from "./guard";

/** "Good morning, Maria" with today's date, what is waiting, the quick actions, the person's roles and (for people holding several) the view switcher. */
export async function GreetingHeader({ roles, lenses, lens, actions }: { roles: readonly RoleSlug[]; lenses: Lens[]; lens: Lens; actions?: ReactNode }) {
  return guarded("Greeting", async () => {
    const [g, queue] = await Promise.all([getGreeting(), getApprovalQueue()]);
    const summary = queue.length > 0 ? `${queue.length} ${queue.length === 1 ? "request is" : "requests are"} waiting for your decision` : null;
    // The base Employee role is on everyone, so it is only shown when it is the person's only role.
    const shown = roles.length > 1 ? roles.filter((r) => r !== "employee") : roles;
    return (
      <div className="space-y-4">
        <PageHeader
          title={`${g.greeting}${g.name ? `, ${g.name}` : ""}`}
          description={
            <>
              {g.dateLabel}
              {summary ? ` · ${summary}` : ""}
            </>
          }
          actions={
            <>
              {actions}
              {queue.length > 0 ? (
                <a href="#approvals" className={cn(buttonVariants())}>
                  Review {queue.length} {queue.length === 1 ? "decision" : "decisions"}
                </a>
              ) : null}
            </>
          }
        />
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b">
          <LensTabs lenses={lenses} current={lens} />
          <ul className="flex flex-wrap gap-1.5 pb-2" aria-label="Your roles">
            {shown.map((r) => (
              <li key={r}>
                {/* eslint-disable-next-line security/detect-object-injection -- r is a typed RoleSlug */}
                <Badge variant="secondary">{ROLE_LABELS[r]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }, <PageHeader title="Dashboard" actions={actions} />);
}

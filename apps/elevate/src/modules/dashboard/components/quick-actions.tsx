import Link from "next/link";
import type { AuthzUser } from "@/lib/authz";
import type { Lens } from "../lens";
import { quickActionsFor } from "../quick-actions";

/** Buttons for the things this person does most, only the ones they are allowed to do. */
export function QuickActions({ user, lens }: { user: AuthzUser; lens: Lens }) {
  const actions = quickActionsFor(user, lens);
  if (actions.length === 0) return null;
  return (
    <section aria-label="Quick actions" className="space-y-2">
      <h2 className="text-lg font-semibold">Quick actions</h2>
      <ul className="flex flex-wrap gap-2">
        {actions.map(({ id, label, href, icon: Icon }) => (
          <li key={id}>
            <Link href={href} className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring">
              <Icon className="size-4 text-primary" aria-hidden />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

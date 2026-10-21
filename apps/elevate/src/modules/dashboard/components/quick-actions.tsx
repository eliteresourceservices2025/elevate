import Link from "next/link";
import type { AuthzUser } from "@/lib/authz";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Lens } from "../lens";
import { quickActionsFor } from "../quick-actions";
import { QuickActionsMenu } from "./quick-actions-menu";

/** The first two things this person does most as buttons, the rest in a "New" menu. Only what they are allowed to do. */
export function QuickActions({ user, lens }: { user: AuthzUser; lens: Lens }) {
  const actions = quickActionsFor(user, lens);
  if (actions.length === 0) return null;
  const shortcuts = actions.slice(0, 2);
  const more = actions.slice(2).map(({ id, label, href }) => ({ id, label, href }));
  return (
    <nav aria-label="Quick actions" className="flex flex-wrap items-center gap-2">
      {shortcuts.map(({ id, label, href, icon: Icon }) => (
        <Link key={id} href={href} className={cn(buttonVariants({ variant: "outline" }))}>
          <Icon className="text-primary" aria-hidden />
          {label}
        </Link>
      ))}
      {more.length > 0 ? <QuickActionsMenu items={more} /> : null}
    </nav>
  );
}

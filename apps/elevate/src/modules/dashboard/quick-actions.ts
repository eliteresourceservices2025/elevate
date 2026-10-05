import {
  Boxes,
  CalendarDays,
  CalendarPlus,
  Clock,
  Gift,
  Hourglass,
  ListChecks,
  LogOut,
  Megaphone,
  PenLine,
  Star,
  UserPlus,
  UserRound,
  Briefcase,
  type LucideIcon,
} from "lucide-react";
import { scopeFor, type ActionName, type AuthzUser } from "@/lib/authz";
import type { Lens } from "./lens";

export type QuickAction = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** The person must hold this permission at any scope (own, team or all) for the button to show. */
  action: ActionName;
  /** Views this button is offered in, most relevant first. */
  lenses: Lens[];
};

// Every button is a plain link to a page that checks access itself; this only keeps the list short and relevant.
export const QUICK_ACTIONS: QuickAction[] = [
  { id: "add-person", label: "Add person", href: "/people/new", icon: UserPlus, action: "people.create", lenses: ["hr", "admin"] },
  { id: "award-days", label: "Award prize days", href: "/time-off", icon: Gift, action: "timeoff.award", lenses: ["hr", "admin"] },
  { id: "post-announcement", label: "Post announcement", href: "/announcements/new", icon: Megaphone, action: "announcements.manage", lenses: ["hr", "admin"] },
  { id: "new-opening", label: "New job opening", href: "/recruiting/new", icon: Briefcase, action: "recruiting.manage_openings", lenses: ["recruiter", "hr", "admin"] },
  { id: "send-for-signature", label: "Send for signature", href: "/signing/new", icon: PenLine, action: "signing.manage", lenses: ["hr", "admin"] },
  { id: "start-offboarding", label: "Start offboarding", href: "/offboarding/new", icon: LogOut, action: "offboarding.manage", lenses: ["hr", "admin"] },
  { id: "launch-review", label: "Launch a review cycle", href: "/reviews/cycles/new", icon: Star, action: "reviews.manage_cycles", lenses: ["hr", "admin"] },
  { id: "register-asset", label: "Register equipment", href: "/assets", icon: Boxes, action: "assets.manage", lenses: ["hr", "admin"] },
  { id: "review-hours", label: "Review hours", href: "/hours-review", icon: ListChecks, action: "hours.approve", lenses: ["team_lead", "hr", "admin"] },
  { id: "request-time-off", label: "Request time off", href: "/time-off", icon: CalendarPlus, action: "timeoff.request", lenses: ["my_work", "team_lead", "executive", "recruiter"] },
  { id: "extra-hours", label: "Ask for extra hours", href: "/extra-hours", icon: Hourglass, action: "extra_hours.request", lenses: ["my_work", "team_lead"] },
  { id: "my-time", label: "My time and claims", href: "/attendance", icon: Clock, action: "attendance.view", lenses: ["my_work"] },
  { id: "my-schedule", label: "My schedule", href: "/schedules", icon: CalendarDays, action: "dashboard.view", lenses: ["my_work"] },
  { id: "my-profile", label: "My profile", href: "/people/me", icon: UserRound, action: "dashboard.view", lenses: ["my_work"] },
];

/** The buttons to show in a view: only ones the person holds the permission for, in the view's order, at most `limit`. */
export function quickActionsFor(user: AuthzUser, lens: Lens, limit = 8): QuickAction[] {
  return QUICK_ACTIONS.filter((q) => q.lenses.includes(lens) && scopeFor(user, q.action) !== null)
    .sort((a, b) => a.lenses.indexOf(lens) - b.lenses.indexOf(lens))
    .slice(0, limit);
}

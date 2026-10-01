import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Schedules" };

// Schedules live inside Attendance, next to the clock, the flags and the hours they feed. This old address sends people there:
// HR to the page where shifts are set, everyone else to their own schedule on My time.
export default async function Page() {
  const user = await requireUser();
  redirect(scopeFor(user, "schedules.manage") ? "/attendance?tab=schedules" : "/attendance");
}

import { definePermissions } from "@/lib/roles";

// Matrix row: the ELEVATE Tracker. Screenshots are never open to the Executive (aggregates only), and Recruiters have no access.
// Source of truth: docs/superpowers/specs/2026-11-19-elevate-tracker-design.md.
const EVERYONE_OWN = { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } as const;

export const activityPermissions = definePermissions({
  // Getting an enrollment code for one's own computer.
  "tracker.enroll": { roles: EVERYONE_OWN },
  // Signing a computer out: the person for their own, HR and Super Admin for anyone.
  "tracker.revoke_device": { roles: { super_admin: "all", hr_admin: "all", employee: "own", team_lead: "own", recruiter: "own", executive: "own" } },
  // Downloading the ELEVATE Tracker App: everyone signed in (a client guest never reaches it). HR and Super Admin publish releases.
  "tracker.download": { roles: EVERYONE_OWN },
  "tracker.manage_releases": { roles: { super_admin: "all", hr_admin: "all" } },
  // One's own day and own screenshots, for anyone who enrolled a computer (people can always see what is recorded about them).
  "activity.view_own": { roles: EVERYONE_OWN },
  // A day's timeline and totals: own, a lead's team (time chain), HR and Super Admin everyone.
  "activity.view": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  // Aggregates only (groups under 5 hidden), including the Executive.
  "activity.view_summary": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", executive: "all" } },
  // Blurred screenshots: same reach as the timeline, never the Executive.
  "activity.view_shots": { roles: { super_admin: "all", hr_admin: "all", team_lead: "team", employee: "own" } },
  // Categories, thresholds and every person's devices.
  "activity.manage": { roles: { super_admin: "all", hr_admin: "all" } },
});

import { definePermissions } from "@/lib/roles";

// Calls (owner decisions 2026-11-17 and 2026-11-18): anyone who may chat may start or join a call in a conversation they belong to
// (membership is checked on every call action; a permission here never opens someone else's call). A client guest has NO calls action:
// they join a call of a client group they are in through Messages access (messages.use + membership + the guest notice), and can
// never start, host or record one (tests/authz/guest-access.test.ts keeps a guest's only registry action messages.use).
export const callsPermissions = definePermissions({
  "calls.start": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  "calls.join": { roles: { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } },
  // The all-hands (about 125 watching): leadership and HR start it.
  "calls.start_townhall": { roles: { super_admin: "all", hr_admin: "all", executive: "all" } },
  // Recording: only people a Super Admin picked (core.users.can_record_calls); no role grants it. The company switch and everyone's
  // consent are checked on top, and recording is refused outright in a call with a client guest.
  "calls.record": { roles: {}, requiresFlag: "call_recorder", flagScope: "own" },
  "calls.manage_recorders": { roles: { super_admin: "all" } },
  "calls.settings": { roles: { super_admin: "all" } },
});

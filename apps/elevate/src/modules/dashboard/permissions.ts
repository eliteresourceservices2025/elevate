import { definePermissions } from "@/lib/roles";

const EVERYONE = { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } as const;

// Matrix rows: the dashboard and the global search. Both are open to everyone who signs in; what they SHOW is decided
// widget by widget and source by source with the owning module's own rules (nothing here widens anyone's access).
export const dashboardPermissions = definePermissions({
  "dashboard.view": { roles: EVERYONE },
  "search.use": { roles: EVERYONE },
});

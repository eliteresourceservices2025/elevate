import { definePermissions } from "@/lib/roles";

// Everyone may see, download and raise requests about their own data, and only their own.
const ownForAll = { super_admin: "own", hr_admin: "own", team_lead: "own", recruiter: "own", executive: "own", employee: "own" } as const;

export const privacyPermissions = definePermissions({
  "privacy.view_my_data": { roles: ownForAll },
  "privacy.export_my_data": { roles: ownForAll },
  "privacy.request_data_rights": { roles: ownForAll },
});

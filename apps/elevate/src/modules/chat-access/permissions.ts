import { definePermissions } from "@/lib/roles";

// HR access to a chat or call recording they are not part of (Phase 6; owner decision 2026-11-17). An HR Admin asks, a DIFFERENT Super
// Admin approves, access is read-only, for the requested dates only, for 72 hours, and every step is logged. Nobody else can read a chat.
// Only the person who asked can read what was granted (not the approver, not another HR Admin).
export const chatAccessPermissions = definePermissions({
  // HR Admins ask (a Super Admin may too, but never decides their own: a DIFFERENT Super Admin always does).
  "chataccess.request": { roles: { super_admin: "all", hr_admin: "all" } },
  "chataccess.decide": { roles: { super_admin: "all" } },
  // HR sees their own requests; a Super Admin sees all of them (to decide).
  "chataccess.list": { roles: { hr_admin: "own", super_admin: "all" } },
  // Reading what was granted: the resource carries the requester, and "own" means only they can.
  "chataccess.read": { roles: { super_admin: "own", hr_admin: "own" } },
});

import { z } from "zod";
import { ROLE_SLUGS } from "@/lib/roles";

// The shape of "who a restricted company document is for", shared by the forms (browser) and the server. No server-only imports here.

export const AUDIENCE_KINDS = ["team", "client", "role", "person"] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];
export type AudienceMember = { kind: AudienceKind; id: string };

export const MAX_AUDIENCE_GROUPS = 100;

/** A selected group: a team, client or person by id, a role by its slug. */
export const audienceMemberSchema = z
  .object({ kind: z.enum(AUDIENCE_KINDS), id: z.string().trim().min(1).max(64) })
  .refine((m) => (m.kind === "role" ? (ROLE_SLUGS as readonly string[]).includes(m.id) : z.uuid().safeParse(m.id).success), { message: "Choose a group from the list." });

/** "Selected groups" needs at least one group, and the other choices carry none. */
export function audienceRule(v: { audience?: "all_staff" | "hr_only" | "restricted"; audienceMembers: unknown[] }, ctx: z.RefinementCtx): void {
  if (v.audience === "restricted" && v.audienceMembers.length === 0) ctx.addIssue({ code: "custom", message: "Choose at least one group", path: ["audienceMembers"] });
  if (v.audience !== undefined && v.audience !== "restricted" && v.audienceMembers.length > 0) ctx.addIssue({ code: "custom", message: "Groups only go with \"Selected groups\"", path: ["audienceMembers"] });
}

import { z } from "zod";
import { ROLE_SLUGS } from "@/lib/roles";

const userId = z.uuid();

export const setUserRolesSchema = z.object({
  userId,
  roles: z.array(z.enum(ROLE_SLUGS)).max(ROLE_SLUGS.length),
});

export const setSafevoiceHandlerSchema = z.object({ userId, enabled: z.boolean() });

export const resetAuthenticatorSchema = z.object({ userId });

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
});

export const revokeInvitationSchema = z.object({ invitationId: z.uuid() });

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  action: z
    .string()
    .trim()
    .max(80)
    .regex(/^[a-z0-9_.]*$/, "Use letters, numbers, dots and underscores")
    .optional(),
});

export type SetUserRolesInput = z.infer<typeof setUserRolesSchema>;
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

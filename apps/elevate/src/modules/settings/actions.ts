"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRoleSlug } from "@/lib/roles";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/modules/audit/write";
import { invitations, userRoles, users } from "@/modules/core/schema";
import { planRoleChange } from "./plan";
import {
  createInvitationSchema,
  resetAuthenticatorSchema,
  revokeInvitationSchema,
  setSafevoiceHandlerSchema,
  setUserRolesSchema,
} from "./validators";

const INVITE_DAYS = 7;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Ends every session for a user, so role or authenticator changes apply immediately. */
async function revokeSessions(tx: Tx, userId: string) {
  await tx.execute(sql`delete from auth.sessions where user_id = ${userId}`);
}

async function currentRoles(tx: Tx, userId: string) {
  const rows = await tx.select({ slug: userRoles.roleSlug }).from(userRoles).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.slug).filter(isRoleSlug);
}

export async function setUserRoles(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "settings.manage_roles");

    const parsed = setUserRolesSchema.safeParse(input);
    if (!parsed.success) return fail("Check the roles and try again.");
    const { userId, roles: requestedRoles } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [target] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
      if (!target) return fail("That person was not found.");

      const before = await currentRoles(tx, userId);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(userRoles)
        .where(eq(userRoles.roleSlug, "super_admin"));

      const plan = planRoleChange({
        actorId: actor.id,
        targetId: userId,
        currentRoles: before,
        requestedRoles,
        superAdminCount: count,
      });
      if (!plan.ok) return fail(plan.error);

      for (const slug of plan.removed) {
        await tx.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleSlug, slug)));
      }
      if (plan.added.length > 0) {
        await tx.insert(userRoles).values(plan.added.map((roleSlug) => ({ userId, roleSlug, grantedBy: actor.id })));
      }

      await writeAudit(
        {
          actor,
          action: "roles.update",
          targetType: "user",
          targetId: userId,
          before: { roles: before },
          after: { roles: plan.finalRoles },
        },
        tx,
      );
      await revokeSessions(tx, userId);
      return { ok: true, data: undefined } as const;
    });

    if (result.ok) revalidatePath("/settings/roles");
    return result;
  });
}

export async function setSafevoiceHandler(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "settings.set_safevoice_handler");

    const parsed = setSafevoiceHandlerSchema.safeParse(input);
    if (!parsed.success) return fail("Check the request and try again.");
    const { userId, enabled } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ enabled: users.isSafevoiceHandler })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!target) return fail("That person was not found.");
      if (target.enabled === enabled) return fail("No change.");

      await tx.update(users).set({ isSafevoiceHandler: enabled }).where(eq(users.id, userId));
      await writeAudit(
        {
          actor,
          action: "user.safevoice_handler.update",
          targetType: "user",
          targetId: userId,
          before: { isSafevoiceHandler: target.enabled },
          after: { isSafevoiceHandler: enabled },
        },
        tx,
      );
      return { ok: true, data: undefined } as const;
    });

    if (result.ok) revalidatePath("/settings/roles");
    return result;
  });
}

export async function resetAuthenticator(input: unknown): Promise<ActionResult<{ removed: number }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "settings.reset_mfa");

    const parsed = resetAuthenticatorSchema.safeParse(input);
    if (!parsed.success) return fail("Check the request and try again.");
    const { userId } = parsed.data;
    if (userId === actor.id) return fail("You cannot reset your own authenticator.");

    const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return fail("That person was not found.");

    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
    if (error) return fail("Could not reach the sign-in service. Try again.");

    let removed = 0;
    for (const factor of data.factors) {
      const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
      if (deleteError) return fail("Could not remove the authenticator. Try again.");
      removed += 1;
    }

    await db.transaction(async (tx) => {
      await writeAudit(
        { actor, action: "user.mfa_reset", targetType: "user", targetId: userId, metadata: { factorsRemoved: removed } },
        tx,
      );
      await revokeSessions(tx, userId);
    });

    revalidatePath("/settings/roles");
    return { ok: true, data: { removed } };
  });
}

export async function createInvitation(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invitations.create");

    const parsed = createInvitationSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
    const { email } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [account] = await tx
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${email}`)
        .limit(1);
      if (account) return fail("That person already has an account.");

      const expiresAt = new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000);
      // Re-inviting refreshes the expiry. The unique index on lower(email) guards against a race.
      const [existing] = await tx
        .select({ id: invitations.id })
        .from(invitations)
        .where(sql`lower(${invitations.email}) = ${email}`)
        .limit(1);
      if (existing) {
        await tx
          .update(invitations)
          .set({ invitedBy: actor.id, expiresAt, acceptedAt: null, createdAt: new Date() })
          .where(eq(invitations.id, existing.id));
      } else {
        await tx.insert(invitations).values({ email, invitedBy: actor.id, expiresAt });
      }

      await writeAudit(
        { actor, action: "invitation.create", targetType: "invitation", targetId: email, after: { email, expiresAt } },
        tx,
      );
      return { ok: true, data: undefined } as const;
    });

    if (result.ok) revalidatePath("/settings/invitations");
    return result;
  });
}

export async function revokeInvitation(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invitations.create");

    const parsed = revokeInvitationSchema.safeParse(input);
    if (!parsed.success) return fail("Check the request and try again.");

    const result = await db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(invitations)
        .where(and(eq(invitations.id, parsed.data.invitationId), isNull(invitations.acceptedAt)))
        .returning({ email: invitations.email });
      if (!removed) return fail("That invitation was not found or was already accepted.");

      await writeAudit(
        { actor, action: "invitation.revoke", targetType: "invitation", targetId: removed.email, before: { email: removed.email } },
        tx,
      );
      return { ok: true, data: undefined } as const;
    });

    if (result.ok) revalidatePath("/settings/invitations");
    return result;
  });
}

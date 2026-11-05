"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { authorize, can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isRoleSlug } from "@/lib/roles";
import { notify } from "@/modules/notifications/service";
import { logChange } from "@/modules/payroll/changes";
import { PAYROLL_LEVEL_LABELS } from "@/modules/payroll/constants";
import { saveSignatory } from "@/modules/payroll/signatory";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/modules/audit/write";
import { invitations, userRoles, users } from "@/modules/core/schema";
import { archiveUserAccount } from "@/modules/core/users";
import { employees } from "@/modules/people/schema";
import { disableLogin, enableLogin } from "@/modules/onboarding/accounts";
import { planDeactivation, planReactivation } from "./deactivate";
import { sendInvitationEmail } from "./invitation-email";
import { ensureInvitation } from "./invite";
import { planRoleChange } from "./plan";
import {
  accountSchema,
  createInvitationSchema,
  resetAuthenticatorSchema,
  revokeInvitationSchema,
  savePayrollSignatorySchema,
  setPayrollAccessSchema,
  setSafevoiceHandlerSchema,
  setUserRolesSchema,
} from "./validators";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Ends every session for a user, so role or authenticator changes apply immediately. */
async function revokeSessions(tx: Tx, userId: string) {
  await tx.execute(sql`delete from auth.sessions where user_id = ${userId}`);
}

async function currentRolesOf(userId: string) {
  const rows = await db.select({ slug: userRoles.roleSlug }).from(userRoles).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.slug).filter(isRoleSlug);
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

/** A Super Admin chooses who has payroll access. Notices carry no amounts; the level change applies on the person's next request. */
export async function setPayrollAccess(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "settings.set_payroll_access");

    const parsed = setPayrollAccessSchema.safeParse(input);
    if (!parsed.success) return fail("Check the request and try again.");
    const { userId, level } = parsed.data;

    const result = await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ level: users.payrollAccess })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.archivedAt)))
        .limit(1)
        .for("update"); // two changes at once cannot both pass the "No change." check or log a stale "before"
      if (!target) return fail("That person was not found.");
      if ((target.level ?? null) === level) return fail("No change.");

      const [profile] = await tx
        .select({ first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName, email: users.email })
        .from(users)
        .leftJoin(employees, eq(employees.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1);
      const who = profile?.first ? `${profile.preferred?.trim() || profile.first} ${profile.last}` : (profile?.email ?? "A person");
      const what = level ? `now has payroll access as ${PAYROLL_LEVEL_LABELS[level]}.` : "no longer has payroll access.";
      const body = `${who} ${what}`;

      await tx.update(users).set({ payrollAccess: level }).where(eq(users.id, userId));
      await writeAudit(
        {
          actor,
          action: "user.payroll_access.update",
          targetType: "user",
          targetId: userId,
          before: { payrollAccess: target.level },
          after: { payrollAccess: level },
        },
        tx,
      );
      await logChange(tx, actor, { action: "access_changed", detail: { userId, from: target.level, to: level } });

      // Other Super Admins and every person who holds a level (before or after) hear about it; never the actor.
      const admins = await tx
        .selectDistinct({ id: userRoles.userId })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(and(eq(userRoles.roleSlug, "super_admin"), isNull(users.archivedAt)));
      const holders = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(isNull(users.archivedAt), sql`${users.payrollAccess} is not null`));
      const adminIds = new Set(admins.map((a) => a.id).filter((id) => id !== actor.id));
      const personIds = new Set([userId, ...holders.map((h) => h.id)].filter((id) => id !== actor.id));
      await notify(tx, [
        ...[...adminIds].map((id) => ({
          userId: id,
          kind: "payroll.access",
          title: "Payroll access was changed",
          body,
          link: "/settings/payroll-access",
        })),
        ...[...personIds]
          .filter((id) => !adminIds.has(id))
          .map((id) => ({
            userId: id,
            kind: "payroll.access",
            title: "Payroll access was changed",
            body,
            // The person whose access was just removed can no longer open /payroll.
            link: id === userId && level === null ? "/dashboard" : "/payroll",
          })),
      ]);
      return { ok: true, data: undefined } as const;
    });

    if (result.ok) {
      revalidatePath("/settings/payroll-access");
      revalidatePath("/settings");
    }
    return result;
  });
}

/**
 * A Super Admin sets who signs the payslips: the name, the title and (optionally) a signature picture. Each save is a new version; a run
 * keeps the version in force when it was paid. Not a pay figure, so it needs no payroll level.
 */
export async function savePayrollSignatory(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "settings.set_payroll_signatory");

    const parsed = savePayrollSignatorySchema.safeParse(input);
    if (!parsed.success) return fail("Check the name, the title and the picture, then try again.");
    const { name, title, signature, removeSignature } = parsed.data;

    await saveSignatory(actor, { name, title, signatureBase64: signature, removeSignature });
    revalidatePath("/settings/payroll-signatory");
    return { ok: true, data: undefined } as const;
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

/**
 * Switches an account off: the sign-in is banned at the auth service, the account is archived (a session still open is refused at its
 * next request) and open sessions are ended. Nothing is deleted. For test accounts and mistakes; a working team member is ended
 * through Offboarding.
 */
export async function deactivateAccount(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "settings.deactivate_account");
    const parsed = accountSchema.safeParse(input);
    if (!parsed.success) return fail("Check the request and try again.");
    const { userId } = parsed.data;

    const [target] = await db.select({ id: users.id, email: users.email, archivedAt: users.archivedAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return fail("That account was not found.");
    const roles = await currentRolesOf(userId);
    const [profile] = await db.select({ status: employees.status }).from(employees).where(and(eq(employees.userId, userId), isNull(employees.archivedAt))).limit(1);
    const [others] = await db
      .select({ n: sql<number>`count(distinct ${userRoles.userId})::int` })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.roleSlug, "super_admin"), isNull(users.archivedAt), sql`${userRoles.userId} <> ${userId}`));

    const plan = planDeactivation({
      actorId: actor.id,
      targetId: userId,
      alreadyDeactivated: target.archivedAt !== null,
      isSuperAdmin: roles.includes("super_admin"),
      otherActiveSuperAdmins: others?.n ?? 0,
      profileStatus: profile?.status ?? null,
    });
    if (!plan.ok) return fail(plan.error);

    try {
      await disableLogin(userId);
    } catch {
      return fail("Could not reach the sign-in service. Try again.");
    }
    await db.transaction(async (tx) => {
      await archiveUserAccount(tx, userId);
      await revokeSessions(tx, userId);
      await writeAudit({ actor, action: "user.deactivate", targetType: "user", targetId: userId, before: { email: target.email } }, tx);
      // A payroll level does not survive deactivation, so switching the account back on never quietly restores it.
      const [held] = await tx.select({ level: users.payrollAccess }).from(users).where(eq(users.id, userId)).limit(1).for("update");
      if (held?.level) {
        await tx.update(users).set({ payrollAccess: null }).where(eq(users.id, userId));
        await writeAudit(
          { actor, action: "user.payroll_access.update", targetType: "user", targetId: userId, before: { payrollAccess: held.level }, after: { payrollAccess: null }, metadata: { reason: "account_deactivated" } },
          tx,
        );
        await logChange(tx, actor, { action: "access_changed", detail: { userId, from: held.level, to: null } });
      }
    });
    revalidatePath("/settings/roles");
    return { ok: true, data: undefined };
  });
}

/** Switches a deactivated account back on. */
export async function reactivateAccount(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "settings.deactivate_account");
    const parsed = accountSchema.safeParse(input);
    if (!parsed.success) return fail("Check the request and try again.");
    const { userId } = parsed.data;

    const [target] = await db.select({ id: users.id, email: users.email, archivedAt: users.archivedAt }).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return fail("That account was not found.");
    const plan = planReactivation({ alreadyDeactivated: target.archivedAt !== null });
    if (!plan.ok) return fail(plan.error);

    try {
      await enableLogin(userId);
    } catch {
      return fail("Could not reach the sign-in service. Try again.");
    }
    await db.transaction(async (tx) => {
      await tx.update(users).set({ archivedAt: null }).where(eq(users.id, userId));
      await writeAudit({ actor, action: "user.reactivate", targetType: "user", targetId: userId, after: { email: target.email } }, tx);
    });
    revalidatePath("/settings/roles");
    return { ok: true, data: undefined };
  });
}

/** emailed = the invitation email was handed to the email service; false = no email service is set up here, or it refused. */
export async function createInvitation(input: unknown): Promise<ActionResult<{ emailed: boolean }>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "invitations.create");

    const parsed = createInvitationSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
    const { email, roles, safevoiceHandler } = parsed.data;
    // Roles and the Safe Voice handler flag are a Super Admin's call, exactly as on the Roles page: HR can still invite, but only as Employee.
    // Asking for either without that right is refused; a Super Admin always sets both (an empty choice clears an earlier one).
    if (roles.length > 0) await authorize(actor, "settings.manage_roles");
    if (safevoiceHandler) await authorize(actor, "settings.set_safevoice_handler");
    const grant = can(actor, "settings.manage_roles") ? { roles: [...new Set(roles)], safevoiceHandler } : undefined;

    const result = await db.transaction(async (tx) => {
      const saved = await ensureInvitation(tx, actor, email, grant);
      if (saved.exists) return fail("That person already has an account.");
      return { ok: true, data: { emailed: false, expiresAt: saved.expiresAt } } as const;
    });

    if (!result.ok) return result;
    revalidatePath("/settings/invitations");
    const emailed = await sendInvitationEmail(email, result.data.expiresAt);
    return { ok: true, data: { emailed } };
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

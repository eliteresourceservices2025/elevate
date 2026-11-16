import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AuthUser } from "@/lib/auth";
import { fieldCrypto } from "@/lib/crypto";
import { db } from "@/lib/db";
import { ActionFailure } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { cleanJpeg } from "@/modules/people/photo";
import { users } from "@/modules/core/schema";
import type { Tx } from "@/modules/people/service";
import { logChange } from "./changes";
import { employees } from "@/modules/people/schema";
import { payRunSignatures, paySignatory } from "./schema";

// The person who signs the payslips (the Human Resources Director). Only a Super Admin changes it (the caller has authorized). A change is
// a new version, and a run keeps the version in force when it was paid, so a payslip never changes afterwards. The signature is a small
// JPEG: the browser makes it, and the server checks and cleans it again (no camera or location data) before keeping it encrypted.

type Reader = Pick<typeof db, "select">;

const contextOf = (id: string) => `pay_signatory:${id}`;

/** What a signature picture may be. The browser sends a small JPEG; this only stops abuse. */
export const SIGNATURE_LIMITS = { maxBytes: 150 * 1024, minSide: 40, maxSide: 1600 } as const;

export type Signatory = {
  id: string;
  name: string;
  title: string;
  signatureBase64: string | null;
  signatureUnreadable: boolean;
  /** The sign-in account printed under "Prepared by" on the statements; null means the person who sent the run for review. */
  preparedByUserId: string | null;
  createdAt: Date;
};

/** The signature as base64 JPEG, or null when there is none or it can't be read (logged without any content). */
function readSignature(id: string, stored: string | null): { base64: string | null; unreadable: boolean } {
  if (!stored) return { base64: null, unreadable: false };
  try {
    return { base64: fieldCrypto().decrypt(stored, contextOf(id)), unreadable: false };
  } catch (error) {
    console.error("payroll signatory signature unreadable:", { signatoryId: id, error: error instanceof Error ? error.name : "UnknownError" });
    return { base64: null, unreadable: true };
  }
}

/** The newest version, or null when nobody has been set yet. */
export async function currentSignatory(executor: Reader): Promise<Signatory | null> {
  const [row] = await executor.select().from(paySignatory).orderBy(desc(paySignatory.createdAt), desc(paySignatory.id)).limit(1);
  if (!row) return null;
  const signature = readSignature(row.id, row.signatureEnc);
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    signatureBase64: signature.base64,
    signatureUnreadable: signature.unreadable,
    preparedByUserId: row.preparedByUserId,
    createdAt: row.createdAt,
  };
}

export type SignatoryInput = {
  name: string;
  title: string;
  /** A new picture, base64 (JPEG). Null keeps the earlier one. */
  signatureBase64: string | null;
  removeSignature: boolean;
  /** Who is printed under "Prepared by" on the statements. Must be someone with the Preparer payroll level; null means whoever sent the run for review. */
  preparedByUserId: string | null;
};

/** Saves a new version. Nothing here writes the name, title or picture to the audit log: only what changed. */
export async function saveSignatory(actor: AuthUser, v: SignatoryInput): Promise<void> {
  await db.transaction(async (tx) => {
    // One save at a time, so a save that only changes the name cannot carry forward a picture an earlier save just replaced.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"payroll.signatory"}))`);
    const previous = await currentSignatory(tx);
    if (v.preparedByUserId) {
      const [preparer] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, v.preparedByUserId), eq(users.payrollAccess, "preparer"), isNull(users.archivedAt)))
        .limit(1);
      if (!preparer) throw new ActionFailure("Choose someone who has the Preparer payroll level.");
    }
    let keep: string | null = null;
    if (v.signatureBase64) {
      const cleaned = cleanJpeg(new Uint8Array(Buffer.from(v.signatureBase64, "base64")), SIGNATURE_LIMITS);
      if (!cleaned.ok) throw new ActionFailure("That signature picture can't be used. Choose a clear picture under 150 KB.");
      keep = Buffer.from(cleaned.bytes).toString("base64");
    } else if (!v.removeSignature) {
      keep = previous?.signatureBase64 ?? null;
    }
    const id = randomUUID();
    await tx.insert(paySignatory).values({
      id,
      name: v.name,
      title: v.title,
      signatureEnc: keep ? fieldCrypto().encrypt(keep, contextOf(id)) : null,
      preparedByUserId: v.preparedByUserId,
      createdBy: actor.id,
    });
    await writeAudit(
      {
        actor,
        action: "payroll.signatory.update",
        targetType: "pay_signatory",
        targetId: id,
        metadata: {
          hasSignature: keep !== null,
          nameChanged: previous?.name !== v.name,
          titleChanged: previous?.title !== v.title,
          preparerChanged: (previous?.preparedByUserId ?? null) !== v.preparedByUserId,
          signatureChanged: Boolean(v.signatureBase64) || (v.removeSignature && previous?.signatureBase64 != null),
        },
      },
      tx,
    );
    // The payroll change history shows who changed the signatory and what (the picture itself is never copied there).
    const shape = (s: { name: string; title: string; hasSignature: boolean; preparedBy: string | null }) => ({ name: s.name, title: s.title, hasSignature: s.hasSignature, preparedBy: s.preparedBy });
    const preparerName = async (userId: string | null) => {
      if (!userId) return null;
      const [row] = await tx
        .select({ email: users.email, first: employees.legalFirstName, last: employees.legalLastName, preferred: employees.preferredName })
        .from(users)
        .leftJoin(employees, eq(employees.userId, users.id))
        .where(eq(users.id, userId))
        .limit(1);
      return row ? (row.first ? `${row.preferred?.trim() || row.first} ${row.last}` : row.email) : null;
    };
    await logChange(tx, actor, {
      action: "signatory_changed",
      detail: {
        old: previous ? shape({ name: previous.name, title: previous.title, hasSignature: previous.signatureBase64 !== null, preparedBy: await preparerName(previous.preparedByUserId) }) : null,
        new: shape({ name: v.name, title: v.title, hasSignature: keep !== null, preparedBy: await preparerName(v.preparedByUserId) }),
        signatureChanged: Boolean(v.signatureBase64) || (v.removeSignature && previous?.signatureBase64 != null),
      },
    });
  });
}

/** When a run becomes paid: keeps the signatory in force today with the run. Nobody set yet: no row, and the payslip says it is not signed. */
export async function freezeRunSignatory(tx: Tx, runId: string, signedOn: string): Promise<void> {
  const [current] = await tx.select({ id: paySignatory.id }).from(paySignatory).orderBy(desc(paySignatory.createdAt), desc(paySignatory.id)).limit(1);
  if (!current) return;
  await tx.insert(payRunSignatures).values({ runId, signatoryId: current.id, signedOn }).onConflictDoNothing();
}

export type RunSignatory = { name: string; title: string; signedOn: string; signatureBase64: string | null; preparedByUserId: string | null };

/**
 * For a run that is not paid yet (a test run, or a real run waiting for payment): the saved signatory as it stands now (name, title, picture
 * and the chosen preparer), dated `signedOn`. Nothing is frozen until the run is paid, so until then its statements follow the saved
 * signatory (and the chosen preparer) instead of falling back to the name of whichever account approved or prepared it. Null when nobody has
 * been set.
 */
export async function savedSignatoryForUnpaid(executor: Reader, signedOn: string): Promise<RunSignatory | null> {
  const current = await currentSignatory(executor);
  return current ? { name: current.name, title: current.title, signedOn, signatureBase64: current.signatureBase64, preparedByUserId: current.preparedByUserId } : null;
}

/** The signatory a run was paid under, or null when it was paid unsigned. */
export async function runSignatory(executor: Reader, runId: string): Promise<RunSignatory | null> {
  const [row] = await executor
    .select({ id: paySignatory.id, name: paySignatory.name, title: paySignatory.title, signatureEnc: paySignatory.signatureEnc, preparedByUserId: paySignatory.preparedByUserId, signedOn: payRunSignatures.signedOn })
    .from(payRunSignatures)
    .innerJoin(paySignatory, eq(paySignatory.id, payRunSignatures.signatoryId))
    .where(eq(payRunSignatures.runId, runId))
    .limit(1);
  if (!row) return null;
  return { name: row.name, title: row.title, signedOn: row.signedOn, signatureBase64: readSignature(row.id, row.signatureEnc).base64, preparedByUserId: row.preparedByUserId };
}

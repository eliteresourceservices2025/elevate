import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { docs } from "@/modules/documents/schema";

// ELEVATE Sign (C4). The original PDF is never edited; the sealed copy is a new file. The event log is append-only and chained by
// hash. Database triggers make the evidence immutable: a signed signer row, a sent envelope's original, a sealed copy and a finished
// envelope's status cannot change, even with direct database access.

export const esignTemplates = docs
  .table(
    "esign_templates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      description: text("description"),
      filePath: text("file_path").notNull(),
      sha256: text("sha256").notNull(),
      fileName: text("file_name").notNull(),
      pageCount: smallint("page_count").notNull(),
      /** The people the agreement needs, in signing order, e.g. ["Contractor", "ERS representative"]. */
      roles: text("roles").array().notNull().default(sql`'{}'::text[]`),
      createdBy: uuid("created_by").references(() => users.id),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("esign_templates_name_idx").on(sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`)],
  )
  .enableRLS();

export const esignEnvelopes = docs
  .table(
    "esign_envelopes",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      title: text("title").notNull(),
      templateId: uuid("template_id").references(() => esignTemplates.id),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      status: text("status").notNull().default("draft"),
      signingOrder: text("signing_order").notNull().default("sequential"),
      /** The PDF as uploaded. Fixed once the envelope is sent. */
      originalPath: text("original_path").notNull(),
      originalName: text("original_name").notNull(),
      originalSha256: text("original_sha256").notNull(),
      pageCount: smallint("page_count").notNull(),
      /** The sealed PDF and its fingerprint: set once when the last person has signed. */
      sealedPath: text("sealed_path"),
      sealedSha256: text("sealed_sha256"),
      sealedAt: timestamp("sealed_at", { withTimezone: true }),
      sentAt: timestamp("sent_at", { withTimezone: true }),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      /** Set when the last signature went in; the seal follows (retried by a job if it did not finish). */
      allSignedAt: timestamp("all_signed_at", { withTimezone: true }),
      endedAt: timestamp("ended_at", { withTimezone: true }),
      endReason: text("end_reason"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("esign_envelopes_status_idx").on(t.status, t.createdAt),
      uniqueIndex("esign_envelopes_sealed_sha_idx").on(t.sealedSha256).where(sql`${t.sealedSha256} is not null`),
      check("esign_envelopes_status_chk", sql`${t.status} in ('draft','out','completed','declined','voided','expired')`),
      check("esign_envelopes_order_chk", sql`${t.signingOrder} in ('sequential','parallel')`),
      check("esign_envelopes_sealed_chk", sql`(${t.sealedPath} is null) = (${t.sealedSha256} is null) and (${t.sealedPath} is null) = (${t.sealedAt} is null)`),
    ],
  )
  .enableRLS();

export const esignSigners = docs
  .table(
    "esign_signers",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      envelopeId: uuid("envelope_id")
        .notNull()
        .references(() => esignEnvelopes.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => users.id),
      /** 1, 2, 3 ... Equal numbers sign at the same time in a sequential envelope. */
      position: smallint("position").notNull(),
      role: text("role"),
      status: text("status").notNull().default("waiting"),
      /** The last time this person was told it is their turn (first notice or a reminder). */
      lastNoticeAt: timestamp("last_notice_at", { withTimezone: true }),
      viewedAt: timestamp("viewed_at", { withTimezone: true }),
      consentVersion: text("consent_version"),
      signatureKind: text("signature_kind"),
      /** The name as printed on the certificate (legal name at the time of signing). */
      signedName: text("signed_name"),
      signatureText: text("signature_text"),
      /** A drawn signature as base64 PNG (60 KB at most, checked on the server). */
      signaturePng: text("signature_png"),
      signedAt: timestamp("signed_at", { withTimezone: true }),
      ip: text("ip"),
      /** How they signed in, e.g. "password, totp". */
      mfaMethods: text("mfa_methods"),
      declineReason: text("decline_reason"),
    },
    (t) => [
      uniqueIndex("esign_signers_envelope_user_idx").on(t.envelopeId, t.userId),
      index("esign_signers_user_idx").on(t.userId, t.status),
      check("esign_signers_status_chk", sql`${t.status} in ('waiting','pending','signed','declined','cancelled')`),
      check("esign_signers_kind_chk", sql`${t.signatureKind} is null or ${t.signatureKind} in ('typed','drawn')`),
      check("esign_signers_signed_chk", sql`(${t.status} <> 'signed') or (${t.signedAt} is not null and ${t.signatureKind} is not null and ${t.consentVersion} is not null and ${t.signedName} is not null)`),
    ],
  )
  .enableRLS();

/** Append-only and chained: every event stores the hash of the one before it. */
export const esignEvents = docs
  .table(
    "esign_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      envelopeId: uuid("envelope_id")
        .notNull()
        .references(() => esignEnvelopes.id),
      seq: integer("seq").notNull(),
      type: text("type").notNull(),
      actorUserId: uuid("actor_user_id").references(() => users.id),
      signerId: uuid("signer_id").references(() => esignSigners.id),
      at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
      ip: text("ip"),
      detail: jsonb("detail").$type<Record<string, unknown>>(),
      prevHash: text("prev_hash").notNull(),
      hash: text("hash").notNull(),
    },
    (t) => [uniqueIndex("esign_events_envelope_seq_idx").on(t.envelopeId, t.seq)],
  )
  .enableRLS();

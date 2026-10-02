import { sql } from "drizzle-orm";
import { jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "@/modules/core/schema";
import { applications, talent } from "@/modules/recruiting/schema";
import { esignEnvelopes } from "@/modules/signing/schema";

// Offers and hiring (3.3). An offer is a letter made from a template, signed through ELEVATE Sign by the applicant (who has no
// account, so by an emailed link and code) and optionally countersigned by an ELEVATE user. The offer keeps a snapshot of the final
// text, so editing a template later never changes a letter that was already sent.

export const offerTemplates = talent
  .table(
    "offer_templates",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      name: text("name").notNull(),
      description: text("description"),
      /** Markdown-style text with {{merge_fields}} (see merge.ts for the allowed ones). */
      body: text("body").notNull(),
      createdBy: uuid("created_by").references(() => users.id),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("offer_templates_name_idx").on(sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`)],
  )
  .enableRLS();

export const offers = talent
  .table(
    "offers",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      applicationId: uuid("application_id")
        .notNull()
        .references(() => applications.id),
      templateId: uuid("template_id").references(() => offerTemplates.id),
      templateName: text("template_name").notNull(),
      /** The values filled in for the merge fields. */
      fields: jsonb("fields").$type<Record<string, string>>().notNull(),
      /** The final text that was turned into the PDF. */
      renderedBody: text("rendered_body").notNull(),
      /** The Sign envelope. Empty while the offer is a draft. Its status IS the offer's status (out = sent, completed = signed...). */
      envelopeId: uuid("envelope_id").references(() => esignEnvelopes.id),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("offers_envelope_idx").on(t.envelopeId).where(sql`${t.envelopeId} is not null`)],
  )
  .enableRLS();

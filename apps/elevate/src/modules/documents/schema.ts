import { sql } from "drizzle-orm";
import { bigint, check, type AnyPgColumn, date, index, integer, pgSchema, text, timestamp, uniqueIndex, uuid, boolean } from "drizzle-orm/pg-core";
import { clients, employees } from "@/modules/people/schema";

// Document vault (A3). Files live in private Supabase Storage buckets; only metadata is here.
// No table here may hold client patient data: upload screens warn, and nothing reads file contents
// except the type check at upload.

export const docs = pgSchema("docs");

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const documentTypes = docs
  .table(
    "document_types",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** Stable key used by reference data and code, e.g. "nbi_clearance". */
      slug: text("slug").notNull(),
      name: text("name").notNull(),
      scope: text("scope").notNull(), // "employee" (belongs to a person) or "company"
      requiresExpiry: boolean("requires_expiry").notNull().default(false),
      requiresClient: boolean("requires_client").notNull().default(false),
      /** Everyone active must have one; HR sees who is missing it. Employee-scope types only. */
      requiredForAll: boolean("required_for_all").notNull().default(false),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [
      uniqueIndex("document_types_slug_idx").on(t.slug),
      uniqueIndex("document_types_name_idx").on(sql`lower(${t.name})`),
      check("document_types_scope_chk", sql`${t.scope} in ('employee','company')`),
    ],
  )
  .enableRLS();

// A person's own folders for sorting their documents (for example "Contracts", "IDs", "Training"). Folders belong to one person and hold
// only that person's documents. Removing a folder archives it and its documents go back to "No folder". Names hold no private data
// (the screen says so) and are never written to the audit log.
export const documentFolders = docs
  .table(
    "document_folders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      employeeId: uuid("employee_id")
        .notNull()
        .references(() => employees.id),
      name: text("name").notNull(),
      createdBy: uuid("created_by"),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      ...stamps,
    },
    (t) => [
      uniqueIndex("document_folders_name_idx").on(t.employeeId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
      index("document_folders_employee_idx").on(t.employeeId),
      check("document_folders_name_chk", sql`char_length(${t.name}) between 1 and 60`),
    ],
  )
  .enableRLS();

export const documents = docs
  .table(
    "documents",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      typeId: uuid("type_id")
        .notNull()
        .references(() => documentTypes.id),
      /** Null for company documents. */
      employeeId: uuid("employee_id").references(() => employees.id),
      clientId: uuid("client_id").references(() => clients.id),
      /** The person's folder this file sits in; null = "No folder". Employee documents only. */
      folderId: uuid("folder_id").references((): AnyPgColumn => documentFolders.id),
      title: text("title").notNull(),
      /** Company documents only: who may read them. */
      audience: text("audience").notNull().default("all_staff"),
      /** pending = a signed upload was issued but the file is not yet checked; active = checked and stored. */
      status: text("status").notNull().default("pending"),

      storageBucket: text("storage_bucket").notNull(),
      storagePath: text("storage_path").notNull(),
      originalName: text("original_name").notNull(),
      mimeType: text("mime_type"),
      sizeBytes: bigint("size_bytes", { mode: "number" }),
      sha256: text("sha256"),

      expiresOn: date("expires_on", { mode: "string" }),
      uploadedBy: uuid("uploaded_by").notNull(),
      verifiedBy: uuid("verified_by"),
      verifiedAt: timestamp("verified_at", { withTimezone: true }),
      finalizedAt: timestamp("finalized_at", { withTimezone: true }),
      archivedAt: timestamp("archived_at", { withTimezone: true }),
      archivedBy: uuid("archived_by"),
      ...stamps,
    },
    (t) => [
      uniqueIndex("documents_storage_path_idx").on(t.storageBucket, t.storagePath),
      index("documents_employee_idx").on(t.employeeId, t.archivedAt),
      index("documents_type_idx").on(t.typeId),
      index("documents_folder_idx").on(t.folderId),
      index("documents_expiry_idx").on(t.expiresOn).where(sql`${t.status} = 'active' and ${t.archivedAt} is null`),
      index("documents_pending_idx").on(t.createdAt).where(sql`${t.status} = 'pending'`),
      check("documents_status_chk", sql`${t.status} in ('pending','active')`),
      check("documents_audience_chk", sql`${t.audience} in ('all_staff','hr_only')`),
      check("documents_size_chk", sql`${t.sizeBytes} is null or (${t.sizeBytes} > 0 and ${t.sizeBytes} <= 10485760)`),
    ],
  )
  .enableRLS();

// One row per document and threshold (30 days, 7 days, expiry day), so a reminder is never sent twice.
export const documentReminders = docs
  .table(
    "document_reminders",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      documentId: uuid("document_id")
        .notNull()
        .references(() => documents.id),
      daysBefore: integer("days_before").notNull(),
      sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("document_reminders_unique_idx").on(t.documentId, t.daysBefore),
      check("document_reminders_days_chk", sql`${t.daysBefore} in (30, 7, 0)`),
    ],
  )
  .enableRLS();

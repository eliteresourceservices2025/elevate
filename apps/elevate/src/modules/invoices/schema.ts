import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { ops } from "@/modules/audit/schema";
import { users } from "@/modules/core/schema";
import { clients, employees } from "@/modules/people/schema";

// Client invoices. Both tables are append-only (database triggers, see the invoices migration) and encrypted at rest:
// the billing rate and the invoice snapshot are `fieldCrypto()` values whose context is "<table>:<row id>", so the ids are made in the app.
// run_id has a foreign key to payroll.pay_runs added in the migration by hand: this module never imports payroll's schema.

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`);

/**
 * Append-only: a change is a new row; the newest row at or before the invoice date applies. `rate_enc` holds US dollars per hour as integer cents.
 * With no `employee_id` the row is the client's DEFAULT rate; with one it is that person's own rate at that client (VA rates vary). A line on an
 * invoice uses the person's rate in force when there is one, else the client's default.
 */
export const clientBillRates = ops
  .table(
    "client_bill_rates",
    {
      id: uuid("id").primaryKey(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id),
      employeeId: uuid("employee_id").references(() => employees.id),
      effectiveFrom: date("effective_from").notNull(),
      rateEnc: text("rate_enc").notNull(),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      createdAt: createdAt(),
    },
    (t) => [index("client_bill_rates_client_idx").on(t.clientId, t.effectiveFrom), index("client_bill_rates_person_idx").on(t.clientId, t.employeeId, t.effectiveFrom)],
  )
  .enableRLS();

/**
 * Append-only and never deleted: a snapshot (payload_enc) taken when the invoice was made, so later changes to hours or rates never touch it.
 * `number` is INV-<year>-<4 digit counter>; a second invoice for the same run and client is a revision (-R2, -R3).
 */
export const invoices = ops
  .table(
    "invoices",
    {
      id: uuid("id").primaryKey(),
      number: text("number").notNull().unique(),
      year: smallint("year").notNull(),
      seq: integer("seq").notNull(),
      revision: smallint("revision").notNull().default(1),
      runId: uuid("run_id").notNull(),
      clientId: uuid("client_id")
        .notNull()
        .references(() => clients.id),
      runStatus: text("run_status").notNull(),
      /** Made from a test run: numbered TEST-..., stamped TEST, and counted in its own series so real numbers never skip. */
      isTest: boolean("is_test").notNull().default(false),
      issuedOn: date("issued_on").notNull(),
      payloadEnc: text("payload_enc").notNull(),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      createdAt: createdAt(),
    },
    (t) => [
      unique("invoices_run_client_revision_uq").on(t.runId, t.clientId, t.revision),
      index("invoices_created_idx").on(t.createdAt),
      check("invoices_revision_chk", sql`${t.revision} >= 1`),
    ],
  )
  .enableRLS();

/**
 * Append-only: what happened to an invoice after it was made. An invoice never changes; its state is its newest event
 * (none, or a restore, means active). `archived` hides a TEST invoice, `voided` retires a real one (kept, stamped VOID), `superseded`
 * marks an invoice replaced by a corrected version (`replaced_by`), `restored` brings an archived one back. The reason is encrypted.
 */
export const invoiceEvents = ops
  .table(
    "invoice_events",
    {
      id: uuid("id").primaryKey(),
      invoiceId: uuid("invoice_id")
        .notNull()
        .references(() => invoices.id),
      kind: text("kind").notNull(),
      replacedBy: uuid("replaced_by").references(() => invoices.id),
      reasonEnc: text("reason_enc"),
      createdBy: uuid("created_by")
        .notNull()
        .references(() => users.id),
      createdAt: createdAt(),
    },
    (t) => [index("invoice_events_invoice_idx").on(t.invoiceId, t.createdAt), check("invoice_events_kind_chk", sql`${t.kind} in ('archived','restored','voided','superseded')`)],
  )
  .enableRLS();

// What a list can do to ticked rows, and what a bulk change reports back. Shared by the invoices and the pay runs lists.

export type BulkAction = "archive" | "restore" | "delete";

/** The ids a bulk change did, and the ids it left alone with the reason for each. */
export type BulkResult = { done: string[]; skipped: { id: string; why: string }[] };

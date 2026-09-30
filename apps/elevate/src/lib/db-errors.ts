// Postgres error helpers. Drizzle wraps driver errors, so the SQLSTATE can be on `cause`.

function sqlState(error: unknown): string | undefined {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  return typeof code === "string" ? code : undefined;
}

/** 23505: a unique index or constraint refused a duplicate. */
export const isUniqueViolation = (error: unknown) => sqlState(error) === "23505";

/** 23514: a CHECK constraint refused a value. */
export const isCheckViolation = (error: unknown) => sqlState(error) === "23514";

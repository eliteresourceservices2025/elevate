/**
 * What is safe to put in a server log about a failure: the error's name and, for a database error, its Postgres code and message
 * (for example `42703 column "x" does not exist`). Never the query's parameters, the stack or any request data: Drizzle's own
 * message embeds the SQL values, so only the underlying driver error (`cause`) is read.
 */
export function errorDetail(error: unknown): string {
  if (!(error instanceof Error)) return "unknown error";
  const cause = (error as { cause?: unknown }).cause;
  const pg = cause && typeof cause === "object" ? (cause as { code?: unknown; message?: unknown }) : null;
  const code = pg && typeof pg.code === "string" ? pg.code.slice(0, 10) : null;
  const message = pg && typeof pg.message === "string" ? pg.message.replace(/\s+/g, " ").slice(0, 200) : null;
  return [error.name, code, message].filter(Boolean).join(" | ");
}

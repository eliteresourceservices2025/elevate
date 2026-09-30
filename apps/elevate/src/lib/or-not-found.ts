import "server-only";
import { notFound } from "next/navigation";
import { ForbiddenError } from "@/lib/authz";

/**
 * For pages: a person without access sees "not found" instead of an error page, so the page
 * does not confirm that it exists. The query itself has already refused them.
 */
export async function orNotFound<T>(query: Promise<T>): Promise<T> {
  try {
    return await query;
  } catch (error) {
    if (error instanceof ForbiddenError) notFound();
    throw error;
  }
}

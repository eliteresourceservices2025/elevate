import { ForbiddenError } from "@/lib/authz";

/** Runs a read that may be refused for this person (it is not their widget) and gives a fallback instead of an error. */
export async function orFallback<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ForbiddenError) return fallback;
    throw error;
  }
}

import { assertPepper } from "./codes";
import { getSql } from "./db";
import type { Deps } from "./service";

/** The real database connection and pepper. Throws when either is not configured (the routes turn that into a plain "something went wrong"). */
export function appDeps(): Deps {
  return { sql: getSql(), pepper: assertPepper(process.env.SAFEVOICE_PEPPER) };
}

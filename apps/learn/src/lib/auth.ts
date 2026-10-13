import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSql } from "./db";
import { resolveSession } from "./handlers";
import { elevateUrl } from "./origin";

/**
 * The signed-in person for a page, or a redirect through ELEVATE (which signs them in and posts back). Every page that shows a
 * person's own data starts with this.
 */
export async function requireSession(): Promise<{ userId: string; authMethods: string[] }> {
  const production = process.env.NODE_ENV === "production";
  const session = await resolveSession((await headers()).get("cookie"), { sql: getSql(), production });
  if (session) return session;
  const elevate = elevateUrl();
  if (!elevate) redirect("/expired");
  redirect(`${elevate}/learn?auto=1`);
}

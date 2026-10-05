"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { cleanQuery, type SearchHit } from "./search";
import { runSearch } from "./search-service";

const inputSchema = z.object({ q: z.string().max(200) });

/** The header search box. Titles and links only, limited per person, and nothing is stored or logged. */
export async function searchEverything(input: unknown): Promise<ActionResult<SearchHit[]>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "search.use", { ownerUserId: actor.id });
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return fail("Type a name, page or tag to search.");
    if (!cleanQuery(parsed.data.q)) return { ok: true, data: [] };
    if (!(await allowRequest("search", actor.id))) return fail("Too many searches. Wait a minute and try again.");
    return { ok: true, data: await runSearch(actor, parsed.data.q) };
  });
}

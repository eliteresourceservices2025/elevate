"use server";

import { z } from "zod";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { formatInZone, DEFAULT_TIMEZONE } from "@/lib/time";
import { writeAudit } from "@/modules/audit/write";
import { renderMyDataPdf } from "./pdf";
import { collectMyData } from "./service";

const formatSchema = z.object({ format: z.enum(["json", "pdf"]) });

export type MyDataFile = { fileName: string; mimeType: string; base64: string };

/** Downloads the signed-in person's own data as JSON or PDF. Logged, and limited like other downloads. */
export async function exportMyData(input: unknown): Promise<ActionResult<MyDataFile>> {
  const actor = await requireUser();

  return runAction(async () => {
    await authorize(actor, "privacy.export_my_data", { ownerUserId: actor.id });
    const parsed = formatSchema.safeParse(input);
    if (!parsed.success) return fail("Choose JSON or PDF.");
    if (!(await allowRequest("download", actor.id))) return fail("Too many downloads. Wait a few minutes and try again.");

    const data = await collectMyData(actor.id, actor.email);
    const day = formatInZone(new Date(), DEFAULT_TIMEZONE, "yyyy-MM-dd");
    const bytes = parsed.data.format === "json" ? Buffer.from(JSON.stringify(data, null, 2), "utf8") : Buffer.from(await renderMyDataPdf(data));

    await writeAudit({ actor, action: "mydata.export", targetType: "user", targetId: actor.id, metadata: { format: parsed.data.format } });
    return {
      ok: true,
      data: {
        fileName: `my-elevate-data-${day}.${parsed.data.format}`,
        mimeType: parsed.data.format === "json" ? "application/json" : "application/pdf",
        base64: bytes.toString("base64"),
      },
    };
  });
}

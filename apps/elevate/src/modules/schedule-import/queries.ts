import "server-only";
import { desc } from "drizzle-orm";
import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { previewForBatch } from "./apply";
import { scheduleImportBatches } from "./schema";

async function gate() {
  const user = await requireUser();
  await authorize(user, "scheduleimport.manage");
  return user;
}

export async function listScheduleImports() {
  await gate();
  return db
    .select({
      id: scheduleImportBatches.id,
      fileName: scheduleImportBatches.fileName,
      layout: scheduleImportBatches.layout,
      status: scheduleImportBatches.status,
      pairCount: scheduleImportBatches.pairCount,
      createdAt: scheduleImportBatches.createdAt,
    })
    .from(scheduleImportBatches)
    .orderBy(desc(scheduleImportBatches.createdAt))
    .limit(30);
}

/** The preview for one upload: read-only, compared with what ELEVATE holds right now. Null when it was discarded or expired. */
export async function getScheduleImportPlan(id: string) {
  await gate();
  return previewForBatch(id);
}

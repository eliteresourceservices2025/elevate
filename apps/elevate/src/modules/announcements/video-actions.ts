"use server";

import { authorize } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { allowRequest } from "@/lib/rate-limit";
import { fail, runAction, type ActionResult } from "@/lib/run-action";
import { writeAudit } from "@/modules/audit/write";
import { cancelVideoUpload, finalizeVideoUpload, requestVideoUpload, type ContentFileView, type VideoTicket } from "./content-files";
import { requestVideoUploadSchema, videoIdSchema } from "./validators";

// An announcement video goes from the browser straight to storage (Vercel limits a request body to a few MB):
// request (server picks the path) -> browser uploads with the one-time token -> finalize (server checks the first bytes and the size).

const BAD = "Check the request and try again.";
const first = (e: { issues: { message: string }[] }) => e.issues[0]?.message ?? BAD;

export async function requestAnnouncementVideoUpload(input: unknown): Promise<ActionResult<VideoTicket>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = requestVideoUploadSchema.safeParse(input);
    if (!parsed.success) return fail(first(parsed.error));
    if (!(await allowRequest("upload", actor.id))) return fail("Too many uploads. Wait a few minutes and try again.");
    const result = await requestVideoUpload(actor, parsed.data);
    return result.ok ? { ok: true, data: result.ticket } : fail(result.error);
  });
}

export async function finalizeAnnouncementVideoUpload(input: unknown): Promise<ActionResult<ContentFileView>> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = videoIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    const result = await finalizeVideoUpload(actor, parsed.data.id);
    if (!result.ok) return fail(result.error);
    await writeAudit({ actor, action: "content.video_add", targetType: "content_file", targetId: result.file.id, metadata: { sizeBytes: result.file.sizeBytes } });
    return { ok: true, data: result.file };
  });
}

export async function cancelAnnouncementVideoUpload(input: unknown): Promise<ActionResult> {
  const actor = await requireUser();
  return runAction(async () => {
    await authorize(actor, "announcements.manage");
    const parsed = videoIdSchema.safeParse(input);
    if (!parsed.success) return fail(BAD);
    await cancelVideoUpload(actor, parsed.data.id);
    return { ok: true, data: undefined };
  });
}

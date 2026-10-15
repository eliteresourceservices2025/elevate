import "server-only";
import { sql } from "drizzle-orm";
import { ActionFailure } from "@/lib/run-action";

// Comments between editors on a draft (Release 3). Working notes: never shown to learners, and audit entries and notices carry ids
// only. Adding one needs the version to be a draft; resolving one needs it to be open. Not edits, so they do not touch the stamp.

type Executor = { execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown> };
const rows = async <T>(tx: Executor, q: ReturnType<typeof sql>) => (await tx.execute(q)) as unknown as T[];

export async function addComment(tx: Executor, p: { versionId: string; authorId: string; target: string; body: string }): Promise<{ id: string; draftEditorId: string | null; slug: string; version: number }> {
  const [v] = await rows<{ status: string; updated_by: string | null; created_by: string | null; slug: string; version: number; modules: string[] }>(tx, sql`
    select v.status, v.updated_by::text as updated_by, v.created_by::text as created_by, c.slug, v.version,
           coalesce((select array_agg(m.module_key) from learn.version_modules m where m.version_id = v.id), '{}') as modules
    from learn.course_versions v join learn.courses c on c.id = v.course_id where v.id = ${p.versionId}`);
  if (!v) throw new ActionFailure("That version was not found.");
  if (v.status !== "draft") throw new ActionFailure("Comments are for a draft. Make a new draft from this version.");
  if (p.target.startsWith("module:") && !v.modules.includes(p.target.slice(7))) throw new ActionFailure("That module is not in this draft.");
  const [c] = await rows<{ id: string }>(tx, sql`
    insert into learn.studio_comments (version_id, author_id, target, body) values (${p.versionId}, ${p.authorId}, ${p.target}, ${p.body}) returning id::text as id`);
  return { id: c.id, draftEditorId: v.updated_by ?? v.created_by, slug: v.slug, version: v.version };
}

export async function resolveComment(tx: Executor, p: { commentId: string; actorId: string }): Promise<{ versionId: string }> {
  const [c] = await rows<{ version_id: string; resolved_at: string | null; status: string }>(tx, sql`
    select c.version_id::text as version_id, c.resolved_at::text as resolved_at, v.status
    from learn.studio_comments c join learn.course_versions v on v.id = c.version_id where c.id = ${p.commentId} for update of c`);
  if (!c) throw new ActionFailure("That comment was not found.");
  if (c.status !== "draft") throw new ActionFailure("Comments can be resolved while the version is a draft.");
  if (c.resolved_at) throw new ActionFailure("That comment is already resolved.");
  await tx.execute(sql`update learn.studio_comments set resolved_at = now(), resolved_by = ${p.actorId} where id = ${p.commentId}`);
  return { versionId: c.version_id };
}

import type { CourseContent } from "../content/schema";
import { withUser, type Sql } from "./db";

// Previewing a course version as a learner would read it, for the people who edit courses (HR, Super Admin, the Privacy Officer).
// Nothing here writes anything: no progress, no time, no records. A draft is only visible to an editor (a row-level-security policy
// decides, not this code), and the exam answer key is never part of it.

export type PreviewVersion = { title: string; status: string; version: number; content: CourseContent };

export async function getPreview(sql: Sql, userId: string, courseSlug: string, version: number): Promise<PreviewVersion | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(courseSlug) || !Number.isInteger(version) || version < 1) return null;
  return withUser(sql, userId, async (tx) => {
    const [editor] = await tx`select learn.is_content_editor(${userId}::uuid) as ok`;
    if (!editor?.ok) return null;
    const [row] = await tx`
      select c.title, v.status, v.version, v.content
      from learn.course_versions v join learn.courses c on c.id = v.course_id
      where c.slug = ${courseSlug} and v.version = ${version}`;
    if (!row) return null;
    return { title: row.title as string, status: row.status as string, version: row.version as number, content: row.content as CourseContent };
  });
}

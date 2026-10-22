import { z } from "zod";
import { ROLE_SLUGS } from "@/lib/roles";
import { HELP_CATEGORY_SLUGS } from "./categories";

// An article is a Markdown file that starts with a small header between two "---" lines:
//   title: Invite a new person
//   summary: One sentence that says what you will be able to do.
//   category: people
//   audience: hr_admin, team_lead      (or: all)
//   order: 2
//   video: invite-a-person             (optional: a file name in content/help/videos, without .mp4)
//   updated: 2026-10-21
// Only "key: value" lines are read, so there is nothing to execute or inject.

const audienceSchema = z
  .string()
  .transform((value) => value.split(",").map((part) => part.trim()).filter(Boolean))
  .pipe(
    z.union([z.tuple([z.literal("all")]).transform(() => "all" as const), z.array(z.enum(ROLE_SLUGS)).min(1)]),
  );

export const frontmatterSchema = z.object({
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(10).max(240),
  category: z.enum(HELP_CATEGORY_SLUGS),
  audience: audienceSchema,
  order: z.coerce.number().int().min(0).max(999),
  video: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,80}$/)
    .optional(),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type HelpFrontmatter = z.infer<typeof frontmatterSchema>;

/** Splits "---\nkey: value\n---\nbody" into the raw header values and the body. Throws a plain Error when the header is missing. */
export function splitFrontmatter(source: string): { header: Record<string, string>; body: string } {
  const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error("The article must start with a header between two --- lines.");
  const header: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    if (line.trim() === "") continue;
    const pair = /^([a-z]+):\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`Cannot read this header line: "${line}"`);
    header[pair[1]] = pair[2].trim();
  }
  return { header, body: match[2].trim() };
}

export function parseArticleSource(source: string): { meta: HelpFrontmatter; body: string } {
  const { header, body } = splitFrontmatter(source);
  const meta = frontmatterSchema.parse(header);
  return { meta, body };
}

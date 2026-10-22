import "server-only";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { RoleSlug } from "@/lib/roles";
import { canSeeHelpArticle, type HelpAudience } from "./audience";
import { HELP_CATEGORIES, helpCategory, type HelpCategorySlug } from "./categories";
import { parseArticleSource } from "./frontmatter";

// The articles are files: content/help/<category>/<slug>.md, pictures in content/help/assets, videos in content/help/videos.

export const HELP_ROOT = path.join(process.cwd(), "content", "help");

export type HelpArticle = {
  slug: string;
  title: string;
  summary: string;
  category: HelpCategorySlug;
  audience: HelpAudience;
  order: number;
  video: string | null;
  updated: string;
  body: string;
};

let cache: HelpArticle[] | null = null;

/** Reads and checks every article once (a bad header fails loudly the first time it is read). */
function loadAll(): HelpArticle[] {
  // Cached in production only, so an author sees edits and new files in dev without restarting the server.
  if (cache && process.env.NODE_ENV === "production") return cache;
  const articles: HelpArticle[] = [];
  for (const category of HELP_CATEGORIES) {
    const dir = path.join(HELP_ROOT, category.slug);
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      continue; // a category with no articles yet
    }
    for (const file of files) {
      const slug = file.slice(0, -3);
      const { meta, body } = parseArticleSource(readFileSync(path.join(dir, file), "utf8"));
      if (meta.category !== category.slug) throw new Error(`${category.slug}/${file}: the header says category "${meta.category}"`);
      articles.push({ slug, ...meta, video: meta.video ?? null, body });
    }
  }
  articles.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  cache = articles;
  return articles;
}

/** All articles the person may see. Nobody gets an article outside their audience, whatever address they type. */
export function listHelpArticles(roles: readonly RoleSlug[]): HelpArticle[] {
  return loadAll().filter((a) => canSeeHelpArticle(roles, a.audience));
}

export function listHelpArticlesIn(roles: readonly RoleSlug[], category: string): HelpArticle[] {
  return listHelpArticles(roles).filter((a) => a.category === category);
}

export function getHelpArticle(roles: readonly RoleSlug[], category: string, slug: string): HelpArticle | null {
  if (!helpCategory(category)) return null;
  return listHelpArticles(roles).find((a) => a.category === category && a.slug === slug) ?? null;
}

/** The categories that hold at least one article the person may see, with their counts. */
export function visibleCategories(roles: readonly RoleSlug[]) {
  const articles = listHelpArticles(roles);
  return HELP_CATEGORIES.map((c) => ({ ...c, count: articles.filter((a) => a.category === c.slug).length })).filter((c) => c.count > 0);
}

/** Search: every word must appear in the title, summary or body. Only searches what the person may see. */
export function searchHelp(roles: readonly RoleSlug[], query: string): HelpArticle[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  if (words.length === 0) return [];
  return listHelpArticles(roles).filter((a) => {
    const hay = `${a.title} ${a.summary} ${a.body}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** A picture belongs to the article named by its first folder; a video to the article whose header names it. Only visible articles count. */
export function mayOpenHelpFile(roles: readonly RoleSlug[], folder: "assets" | "videos", relative: string): boolean {
  const articles = listHelpArticles(roles);
  if (folder === "assets") return articles.some((a) => a.slug === relative.split("/")[0]);
  return articles.some((a) => a.video !== null && `${a.video}.mp4` === relative);
}

/** The size of the file when it exists inside a help folder (the asset route uses this after its own path checks). */
export function helpFileSize(folder: "assets" | "videos", relative: string): number | null {
  try {
    const full = path.join(HELP_ROOT, folder, relative);
    if (!full.startsWith(path.join(HELP_ROOT, folder) + path.sep)) return null;
    const stat = statSync(full);
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, ChevronRight, SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { orNotFound } from "@/lib/or-not-found";
import { searchHelp, visibleCategories } from "@/modules/help/content";

export const metadata: Metadata = { title: "Help center" };

export default async function HelpPage({ searchParams }: PageProps<"/help">) {
  const user = await requireUser();
  await orNotFound(authorize(user, "help.view"));
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const results = q ? searchHelp(user.roles, q) : [];
  const categories = visibleCategories(user.roles);

  return (
    <PageContainer width="medium">
      <PageHeader title="Help center" description="Step-by-step guides with pictures and short videos. Pick a topic, or search for what you want to do." />

      <form action="/help" role="search" className="flex max-w-xl gap-2">
        <label htmlFor="help-q" className="sr-only">
          Search the Help center
        </label>
        <input
          id="help-q"
          name="q"
          defaultValue={q}
          placeholder="For example: invite a new person"
          className="h-(--control-h) w-full rounded-md border bg-background px-3 text-sm"
        />
        <button type="submit" className="h-(--control-h) rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
          Search
        </button>
      </form>

      {q ? (
        <section aria-label="Search results" className="space-y-3">
          <h2 className="text-lg font-semibold">
            {results.length} {results.length === 1 ? "guide" : "guides"} for &ldquo;{q}&rdquo;
          </h2>
          {results.length === 0 ? (
            <EmptyState icon={SearchX} title="Nothing matched" description="Try fewer or different words, or ask for help on the Contact support page." />
          ) : (
            <ul className="divide-y rounded-lg border">
              {results.map((a) => (
                <li key={`${a.category}/${a.slug}`}>
                  <Link href={`/help/${a.category}/${a.slug}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50">
                    <span>
                      <span className="block font-medium">{a.title}</span>
                      <span className="block text-sm text-muted-foreground">{a.summary}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : categories.length === 0 ? (
        <EmptyState icon={BookOpen} title="No guides for you yet" description="New guides will show up here." />
      ) : (
        <section aria-label="Topics" className="grid gap-4 sm:grid-cols-2">
          {categories.map((c) => (
            <Link key={c.slug} href={`/help/${c.slug}`} className="flex gap-3 rounded-lg border p-4 transition-colors hover:bg-muted/50">
              <BookOpen className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
              <span>
                <span className="block font-semibold">{c.title}</span>
                <span className="block text-sm text-muted-foreground">{c.description}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {c.count} {c.count === 1 ? "guide" : "guides"}
                </span>
              </span>
            </Link>
          ))}
        </section>
      )}
    </PageContainer>
  );
}

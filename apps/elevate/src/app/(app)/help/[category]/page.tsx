import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Video } from "lucide-react";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { orNotFound } from "@/lib/or-not-found";
import { helpCategory } from "@/modules/help/categories";
import { listHelpArticlesIn } from "@/modules/help/content";

export async function generateMetadata({ params }: PageProps<"/help/[category]">): Promise<Metadata> {
  const user = await requireUser();
  const { category } = await params;
  return { title: listHelpArticlesIn(user.roles, category).length > 0 ? (helpCategory(category)?.title ?? "Help center") : "Help center" };
}

export default async function HelpCategoryPage({ params }: PageProps<"/help/[category]">) {
  const user = await requireUser();
  await orNotFound(authorize(user, "help.view"));
  const { category: slug } = await params;
  const category = helpCategory(slug);
  const articles = category ? listHelpArticlesIn(user.roles, slug) : [];
  if (!category || articles.length === 0) notFound();

  return (
    <PageContainer width="form">
      <PageHeader title={category.title} description={category.description} breadcrumbs={[{ label: "Help center", href: "/help" }, { label: category.title }]} />
      <ul className="divide-y rounded-lg border">
        {articles.map((a) => (
          <li key={a.slug}>
            <Link href={`/help/${a.category}/${a.slug}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50">
              <span>
                <span className="block font-medium">{a.title}</span>
                <span className="block text-sm text-muted-foreground">{a.summary}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                {a.video ? <Video className="size-4" aria-label="Has a video" /> : null}
                <ChevronRight className="size-4" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}

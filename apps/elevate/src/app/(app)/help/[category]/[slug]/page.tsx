import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { orNotFound } from "@/lib/or-not-found";
import { helpCategory } from "@/modules/help/categories";
import { getHelpArticle } from "@/modules/help/content";
import { ArticleBody } from "@/modules/help/components/article-body";

export async function generateMetadata({ params }: PageProps<"/help/[category]/[slug]">): Promise<Metadata> {
  // Only a guide the person may read gets its own title; anything else stays generic so a hidden guide is not confirmed.
  const user = await requireUser();
  const { category, slug } = await params;
  return { title: getHelpArticle(user.roles, category, slug)?.title ?? "Help center" };
}

export default async function HelpArticlePage({ params }: PageProps<"/help/[category]/[slug]">) {
  const user = await requireUser();
  await orNotFound(authorize(user, "help.view"));
  const { category: categorySlug, slug } = await params;
  const category = helpCategory(categorySlug);
  const article = category ? getHelpArticle(user.roles, categorySlug, slug) : null;
  if (!category || !article) notFound();

  return (
    <PageContainer width="form">
      <PageHeader
        title={article.title}
        description={article.summary}
        breadcrumbs={[{ label: "Help center", href: "/help" }, { label: category.title, href: `/help/${category.slug}` }, { label: article.title }]}
      />

      {article.video ? (
        <section aria-label="Video">
          <video controls preload="metadata" className="w-full rounded-lg border bg-black" src={`/api/help/videos/${article.video}.mp4`}>
            Your browser cannot play this video. The steps below say the same thing.
          </video>
        </section>
      ) : null}

      <ArticleBody body={article.body} />

      <p className="border-t pt-4 text-xs text-muted-foreground">
        Last updated {article.updated}. Something wrong or missing?{" "}
        <Link href={`/support?from=${encodeURIComponent(`/help/${category.slug}/${article.slug}`)}`} className="text-primary underline-offset-4 hover:underline">
          Tell support
        </Link>
        .
      </p>
    </PageContainer>
  );
}

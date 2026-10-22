import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { ApplyForm } from "@/modules/recruiting/components/apply-form";
import { getPublicOpening, getPublicPrivacyNotice } from "@/modules/recruiting/queries";
import { baseUrl, jobPostingJsonLd, safeJsonLd } from "@/modules/recruiting/public-feed";
import { looksLikeId } from "@/modules/recruiting/slug";
import { sourceFromParam } from "@/modules/recruiting/constants";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/careers/[id]">): Promise<Metadata> {
  const opening = await getPublicOpening((await params).id);
  return { title: opening ? opening.title : "Careers" };
}

export default async function CareerDetailPage({ params, searchParams }: PageProps<"/careers/[id]">) {
  const { id } = await params;
  // A link such as ?src=linkedin pre-selects where the applicant heard about the job (they can change it).
  const defaultSource = sourceFromParam((await searchParams).src);
  const opening = await getPublicOpening(id);
  if (!opening) notFound();
  // An old link by id goes to the readable address.
  if (opening.slug && looksLikeId(id)) permanentRedirect(`/careers/${opening.slug}${defaultSource ? `?src=${defaultSource}` : ""}`);
  const notice = await getPublicPrivacyNotice();
  return (
    <div className="space-y-8">
      {/* Structured data for job search sites. The JSON is escaped so a description can never close the tag. */}
      {/* eslint-disable-next-line react/no-danger -- JSON-LD must be raw JSON text; safeJsonLd escapes "<" and the line separators */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jobPostingJsonLd(opening, baseUrl(process.env.NEXT_PUBLIC_APP_URL))) }} />
      <div>
        <Link href="/careers" className="text-sm text-primary underline-offset-4 hover:underline">
          ← All positions
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{opening.title}</h1>
        <p className="mt-1 text-muted-foreground">
          {opening.location}
          {opening.payNote ? ` · ${opening.payNote}` : ""}
        </p>
      </div>
      <section aria-label="About the job" className="space-y-3 rounded-xl border bg-card p-5">
        <Markdown source={opening.description} />
      </section>
      <section aria-labelledby="apply-heading" className="space-y-3 rounded-xl border bg-card p-5">
        <h2 id="apply-heading" className="text-lg font-semibold">
          Apply
        </h2>
        <ApplyForm openingId={opening.id} defaultSource={defaultSource} noticeTitle={notice?.title ?? null} noticeBody={notice?.body ?? null} />
      </section>
    </div>
  );
}

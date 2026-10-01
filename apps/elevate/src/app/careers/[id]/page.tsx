import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { ApplyForm } from "@/modules/recruiting/components/apply-form";
import { getPublicOpening, getPublicPrivacyNotice } from "@/modules/recruiting/queries";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/careers/[id]">): Promise<Metadata> {
  const opening = await getPublicOpening((await params).id);
  return { title: opening ? opening.title : "Careers" };
}

export default async function CareerDetailPage({ params }: PageProps<"/careers/[id]">) {
  const opening = await getPublicOpening((await params).id);
  if (!opening) notFound();
  const notice = await getPublicPrivacyNotice();
  return (
    <div className="space-y-8">
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
        <ApplyForm openingId={opening.id} noticeTitle={notice?.title ?? null} noticeBody={notice?.body ?? null} />
      </section>
    </div>
  );
}

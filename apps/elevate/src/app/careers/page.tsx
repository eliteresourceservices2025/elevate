import type { Metadata } from "next";
import Link from "next/link";
import { Markdown } from "@/components/markdown";
import { DEFAULT_CAREERS_INTRO, DEFAULT_CAREERS_TITLE } from "@/modules/recruiting/constants";
import { getCareersPage, listPublicOpenings } from "@/modules/recruiting/queries";
import { careerPath } from "@/modules/recruiting/slug";

export const metadata: Metadata = { title: "Careers" };
export const dynamic = "force-dynamic";

export default async function CareersPage() {
  const [openings, page] = await Promise.all([listPublicOpenings(), getCareersPage()]);
  return (
    <div className="space-y-6">
      {page.bannerVersion ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private picture served by our own route
        <img src={`/api/careers/banner?v=${page.bannerVersion}`} alt="" className="aspect-[4/1] w-full rounded-xl border object-cover" />
      ) : null}
      <div>
        <h1 className="text-2xl font-bold">{page.title ?? DEFAULT_CAREERS_TITLE}</h1>
        <div className="mt-1 text-muted-foreground">
          <Markdown source={page.intro ?? DEFAULT_CAREERS_INTRO} />
        </div>
      </div>
      {openings.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-muted-foreground">There are no open positions right now. Please check back soon.</p>
      ) : (
        <ul className="space-y-3">
          {openings.map((o) => (
            <li key={o.id}>
              <Link href={careerPath(o)} className="block rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                <h2 className="font-semibold">{o.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {o.location}
                  {o.payNote ? ` · ${o.payNote}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

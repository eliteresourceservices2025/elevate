import type { Metadata } from "next";
import { orNotFound } from "@/lib/or-not-found";
import { GoLiveList } from "@/modules/imports/components/go-live-list";
import { getGoLive } from "@/modules/imports/golive-queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Go-live checklist" };

export default async function GoLivePage() {
  const { rows, notProduction } = await orNotFound(getGoLive());
  const done = rows.filter((r) => r.done).length;
  return (
    <PageContainer>
      <PageHeader
        title="Go-live checklist"
        description={
          <>
            <p className="mt-1 text-muted-foreground">
              {done} of {rows.length} done. The first rows check themselves from this system; the rest are yours to tick off.
            </p>
            {notProduction ? (
              <p className="mt-2 rounded-lg border border-brand-gold bg-brand-gold/10 p-3 text-sm">
                This is not the production deployment, so the automatic checks describe this copy. Open the checklist on the live site before
                cutover.
              </p>
            ) : null}
          </>
        }
        breadcrumbs={[{ label: "Settings", href: "/settings" }, { label: "Go-live checklist" }]}
      />
      <GoLiveList rows={rows} />
    </PageContainer>
  );
}

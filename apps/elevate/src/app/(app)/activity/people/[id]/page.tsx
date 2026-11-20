import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DayBody } from "@/modules/activity/components/my-day";
import { DayPicker } from "@/modules/activity/components/day-picker";
import { ShotGallery } from "@/modules/activity/components/shot-gallery";
import { getPersonDay } from "@/modules/activity/queries";

export const metadata: Metadata = { title: "Activity" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A person outside the viewer's reach is a plain 404: no hint that the person exists. No loading.tsx: this route can call notFound().
export default async function PersonActivityPage({ params, searchParams }: PageProps<"/activity/people/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const date = typeof query.date === "string" ? query.date : undefined;
  const day = await orNotFound(getPersonDay({ employeeId: id, date }));

  return (
    <PageContainer>
      <PageHeader
        title={day.person.name}
        description={`${day.person.team ? `${day.person.team} · ` : ""}This day is in ${day.zone.replaceAll("_", " ")}. Times are shown in ${day.viewerZone.replaceAll("_", " ")}.`}
        breadcrumbs={[{ label: "Activity", href: "/activity" }, { label: day.person.name }]}
      />
      <DayPicker basePath={`/activity/people/${id}`} date={day.date} today={day.today} />
      <DayBody day={day} viewerZone={day.viewerZone} />
      <section aria-label="Screenshots" className="space-y-2">
        <h2 className="text-lg font-semibold">Screenshots</h2>
        {day.canShots ? (
          <>
            {!day.own ? <p className="text-sm text-muted-foreground">Opening one asks for a reason. It is recorded, and {day.person.name} can see who looked and why.</p> : null}
            <ShotGallery shots={day.shots} zone={day.viewerZone} needReason={!day.own} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">You can see the timeline but not the screenshots.</p>
        )}
      </section>
    </PageContainer>
  );
}

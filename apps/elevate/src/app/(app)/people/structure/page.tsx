import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { StructureAdmin } from "@/modules/org/components/structure-admin";
import { listStructure } from "@/modules/org/queries";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Structure" };

export default async function StructurePage() {
  const s = await orNotFound(listStructure());

  return (
    <PageContainer>
      <PageHeader
        title="Structure"
        description={
          <>
            Departments, teams and positions. Who reports to whom is set on each person&apos;s profile and shown on the{" "}
            <Link href="/org-chart" className="text-primary underline-offset-4 hover:underline">
              org chart
            </Link>
            .
          </>
        }
        breadcrumbs={[{ label: "People", href: "/people" }, { label: "Structure" }]}
      />
      <StructureAdmin
        departments={s.departments.map((d) => ({ id: d.id, name: d.name }))}
        teams={s.teams}
        positions={s.positions}
      />
    </PageContainer>
  );
}

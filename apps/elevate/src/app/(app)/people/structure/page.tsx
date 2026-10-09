import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { StructureAdmin } from "@/modules/org/components/structure-admin";
import { listStructure } from "@/modules/org/queries";

export const metadata: Metadata = { title: "Structure" };

export default async function StructurePage() {
  const s = await orNotFound(listStructure());

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/people" className="text-sm text-primary underline-offset-4 hover:underline">
          ← People
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Structure</h1>
        <p className="mt-1 text-muted-foreground">
          Departments, teams and positions. Who reports to whom is set on each person&apos;s profile and shown on the{" "}
          <Link href="/org-chart" className="text-primary underline-offset-4 hover:underline">
            org chart
          </Link>
          .
        </p>
      </div>
      <StructureAdmin
        departments={s.departments.map((d) => ({ id: d.id, name: d.name }))}
        teams={s.teams}
        positions={s.positions}
      />
    </div>
  );
}

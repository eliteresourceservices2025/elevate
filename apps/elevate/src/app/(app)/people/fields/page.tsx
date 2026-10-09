import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { ArchiveFieldButton, NewCustomFieldForm } from "@/modules/people/components/admin-forms";
import { listCustomFieldDefs } from "@/modules/people/queries";

export const metadata: Metadata = { title: "Custom fields" };

export default async function CustomFieldsPage() {
  const defs = await orNotFound(listCustomFieldDefs());

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/people" className="text-sm text-primary underline-offset-4 hover:underline">
          ← People
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Custom fields</h1>
        <p className="mt-1 text-muted-foreground">Extra details HR wants on every profile, for example shirt size or preferred shift.</p>
      </div>
      <NewCustomFieldForm />
      <ul className="divide-y rounded-xl border bg-card px-4">
        {defs.length === 0 ? <li className="py-3 text-sm text-muted-foreground">No custom fields yet.</li> : null}
        {defs.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <span className="font-medium">{d.label}</span>
              <span className="ml-2 font-mono text-xs text-muted-foreground">{d.key}</span>
              <span className="ml-2 flex-wrap text-xs">
                <Badge variant="secondary">{d.fieldType}</Badge>{" "}
                <Badge variant="outline">{d.visibility === "hr_only" ? "HR only" : "HR and the person"}</Badge>
                {d.isRequired ? <> <Badge>Required</Badge></> : null}
              </span>
            </div>
            <ArchiveFieldButton fieldDefId={d.id} label={d.label} />
          </li>
        ))}
      </ul>
    </div>
  );
}

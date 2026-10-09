import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { LabelSheet } from "@/modules/assets/components/label-sheet";
import { getLabelItems } from "@/modules/assets/queries";

export const metadata: Metadata = { title: "Print asset labels" };

export default async function LabelsPage({ searchParams }: PageProps<"/assets/labels">) {
  const params = await searchParams;
  const raw = typeof params.tags === "string" ? params.tags : "";
  const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
  const items = await orNotFound(getLabelItems(tags));
  return (
    <div className="w-full space-y-4">
      <div className="print:hidden">
        <Link href="/assets" className="text-sm text-primary underline-offset-2 hover:underline">
          Assets
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Print asset labels</h1>
        <p className="mt-1 text-muted-foreground">
          {tags.length > 0 ? "Labels for the item you chose." : "Labels for every item that is not archived."} Each QR code opens the item&apos;s page in ELEVATE (sign-in required). It holds only the address, no personal data.
        </p>
        {tags.length > 0 ? (
          <Link href="/assets/labels" className="text-sm text-primary underline-offset-2 hover:underline">
            Show all items instead
          </Link>
        ) : null}
      </div>
      <LabelSheet items={items} />
    </div>
  );
}

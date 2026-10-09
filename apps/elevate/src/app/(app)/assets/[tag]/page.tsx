import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { orNotFound } from "@/lib/or-not-found";
import { formatDateOnly } from "@/lib/time";
import { CATEGORY_LABELS, assetPath } from "@/modules/assets/constants";
import { AssignForm, EditAssetForm, ReturnForm, StatusControls } from "@/modules/assets/components/asset-forms";
import { AssetQr } from "@/modules/assets/components/qr-code";
import { HistoryTable, StatusBadge } from "@/modules/assets/components/asset-tables";
import { getAsset, listAssignablePeople } from "@/modules/assets/queries";

export const metadata: Metadata = { title: "Asset" };

/** The page a scanned QR code opens. Signed-in users only (the app layout), and the same access rules as everywhere. */
export default async function AssetPage({ params }: PageProps<"/assets/[tag]">) {
  const { tag } = await params;
  const asset = await orNotFound(getAsset(tag));
  if (!asset) notFound();
  const people = asset.canAssign && asset.assignable.ok ? await orNotFound(listAssignablePeople()) : [];
  const withPerson = asset.history.find((h) => !h.returnedAt);

  return (
    <div className="w-full space-y-6">
      <div>
        <Link href="/assets" className="text-sm text-primary underline-offset-2 hover:underline">
          Assets
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{asset.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
              <span className="font-mono text-foreground">{asset.tag}</span>
              <StatusBadge status={asset.status} />
              {asset.archived ? <span className="text-xs">archived</span> : null}
            </p>
          </div>
          <AssetQr path={assetPath(asset.tag)} size={88} label={`QR code for item ${asset.tag}`} />
        </div>
      </div>

      <dl className="grid gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Category</dt>
          <dd>{CATEGORY_LABELS[asset.category]}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Serial number</dt>
          <dd>{asset.serialNumber ?? "-"}</dd>
        </div>
        {asset.canManage ? (
          <>
            <div>
              <dt className="text-muted-foreground">Purchase date</dt>
              <dd>{asset.purchaseDate ? formatDateOnly(asset.purchaseDate) : "-"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Notes (HR only)</dt>
              <dd className="whitespace-pre-wrap">{asset.notes ?? "-"}</dd>
            </div>
          </>
        ) : null}
      </dl>

      {asset.canManage ? (
        <div className="flex flex-wrap items-start gap-3 print:hidden">
          <Link href={`/assets/labels?tags=${encodeURIComponent(asset.tag)}`} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-secondary/50">
            Print this label
          </Link>
          <EditAssetForm asset={{ id: asset.id, name: asset.name, category: asset.category, serialNumber: asset.serialNumber, notes: asset.notes, purchaseDate: asset.purchaseDate }} />
          {asset.status !== "assigned" ? <StatusControls assetId={asset.id} status={asset.status} archived={asset.archived} canArchive={asset.archivable.ok} /> : null}
        </div>
      ) : null}

      {asset.canAssign && asset.status === "assigned" && withPerson ? (
        <div className="space-y-2">
          <p className="text-sm">
            With <strong>{withPerson.person}</strong> since {formatDateOnly(withPerson.assignedAt.toISOString().slice(0, 10))}.
          </p>
          <ReturnForm assetId={asset.id} />
        </div>
      ) : null}
      {asset.canAssign && asset.assignable.ok ? <AssignForm assetId={asset.id} people={people} /> : null}
      {asset.canAssign && !asset.assignable.ok && asset.status !== "assigned" && !asset.archived ? <p className="text-sm text-muted-foreground">{asset.assignable.reason}</p> : null}

      <section aria-label="History" className="space-y-2">
        <h2 className="text-lg font-semibold">Hand-over history</h2>
        <HistoryTable rows={asset.history} showPerson={asset.canManage || asset.history.some((h) => h.employeeId !== asset.history[0]?.employeeId)} showStaff={asset.canManage} />
      </section>
    </div>
  );
}

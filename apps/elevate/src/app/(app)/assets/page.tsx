import type { Metadata } from "next";
import Link from "next/link";
import { scopeFor } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { parsePaging } from "@/lib/pagination";
import { PagerLinks } from "@/components/pager";
import { NativeSelect } from "@/components/ui/native-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ASSET_STATUSES, CATEGORIES, CATEGORY_LABELS, STATUS_LABELS } from "@/modules/assets/constants";
import { HeldTable, InventoryTable } from "@/modules/assets/components/asset-tables";
import { RegisterAssetForm } from "@/modules/assets/components/asset-forms";
import { assetStatusCounts, getMyAssets, listAssets, listTeamAssets } from "@/modules/assets/queries";

export const metadata: Metadata = { title: "Assets" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const user = await requireUser();
  const scope = scopeFor(user, "assets.view");
  const params = await searchParams;
  const hr = scope === "all";
  const lead = scope === "team";

  // Everyone with access sees their own items; a lead also sees their team's; HR sees the whole inventory.
  // Recruiters and executives: the query refuses and the page shows "not found".
  const mine = await orNotFound(getMyAssets());
  const team = lead ? await orNotFound(listTeamAssets()) : [];

  const filters = { status: one(params.status), category: one(params.category), q: one(params.q), archived: one(params.archived) === "1" ? true : undefined };
  const paging = parsePaging({ page: one(params.page), size: one(params.size) });
  const inventory = hr ? await orNotFound(listAssets(filters, paging)) : null;
  const counts = hr ? await orNotFound(assetStatusCounts()) : null;
  const canManage = scopeFor(user, "assets.manage") === "all";

  return (
    <div className="w-full space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Assets</h1>
          <p className="mt-1 text-muted-foreground">Equipment inventory and who has what. No prices or values are kept here.</p>
        </div>
        {canManage ? (
          <Link href="/assets/labels" className="rounded-lg border px-3 py-1.5 text-sm hover:bg-secondary/50">
            Print labels
          </Link>
        ) : null}
      </div>

      <section aria-label="My assets" className="space-y-2">
        <h2 className="text-lg font-semibold">My assets</h2>
        <HeldTable rows={mine} empty="Nothing is assigned to you." />
      </section>

      {lead ? (
        <section aria-label="Team assets" className="space-y-2">
          <h2 className="text-lg font-semibold">My team&apos;s assets</h2>
          <HeldTable rows={team} showPerson empty="Nothing is assigned to your team." />
        </section>
      ) : null}

      {hr && inventory && counts ? (
        <section aria-label="Inventory" className="space-y-3">
          <h2 className="text-lg font-semibold">Inventory</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {ASSET_STATUSES.map((s) => (
              <li key={s}>
                <Link href={`/assets?status=${s}`} className="rounded-full border px-3 py-1 hover:bg-secondary/50">
                  {STATUS_LABELS[s]}: {counts[s]}
                </Link>
              </li>
            ))}
          </ul>
          <form method="get" action="/assets" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3" aria-label="Filter the inventory">
            <div className="space-y-1">
              <Label htmlFor="f-q">Search</Label>
              <Input id="f-q" name="q" defaultValue={filters.q ?? ""} placeholder="Tag, name or serial number" className="w-60" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-status">Status</Label>
              <NativeSelect id="f-status" name="status" defaultValue={filters.status ?? ""}>
                <option value="">Any</option>
                {ASSET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-category">Category</Label>
              <NativeSelect id="f-category" name="category" defaultValue={filters.category ?? ""}>
                <option value="">Any</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <label className="flex items-center gap-2 pb-1.5 text-sm">
              <input type="checkbox" name="archived" value="1" defaultChecked={filters.archived === true} />
              Show archived
            </label>
            <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground">
              Filter
            </button>
            <Link href="/assets" className="pb-1.5 text-sm text-primary underline-offset-2 hover:underline">
              Clear
            </Link>
          </form>
          <InventoryTable rows={inventory.rows} />
          <PagerLinks info={inventory.info} basePath="/assets" query={{ status: filters.status, category: filters.category, q: filters.q, archived: filters.archived ? "1" : undefined }} label="items" />
        </section>
      ) : null}

      {canManage ? <RegisterAssetForm /> : null}
    </div>
  );
}

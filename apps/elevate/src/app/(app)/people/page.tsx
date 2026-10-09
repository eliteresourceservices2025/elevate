import type { Metadata } from "next";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { PagerLinks } from "@/components/pager";
import { can } from "@/lib/authz";
import { DEFAULT_PAGE_SIZE, pageInfo } from "@/lib/pagination";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { EMPLOYEE_STATUSES, statusLabel } from "@/modules/people/constants";
import { DirectoryTable } from "@/modules/people/components/directory-table";
import { listTeamFilterOptions } from "@/modules/org/queries";
import { listClientsForFilter, listDirectory } from "@/modules/people/queries";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: PageProps<"/people">) {
  const user = await requireUser();
  const raw = Object.fromEntries(Object.entries(await searchParams).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  const { rows, total, page, pageSize, query, seesClients, seesArchived, canCreate } = await listDirectory(raw);
  const teamOptions = await listTeamFilterOptions();
  const clientOptions = seesClients && can(user, "people.manage_assignments") ? await listClientsForFilter() : [];

  const info = pageInfo(total, page, pageSize);
  const filters: Record<string, string> = {
    ...(query.q ? { q: query.q } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.client ? { client: query.client } : {}),
    ...(query.team ? { team: query.team } : {}),
    ...(query.archived ? { archived: "1" } : {}),
    ...(pageSize !== DEFAULT_PAGE_SIZE ? { size: String(pageSize) } : {}),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">People</h1>
          <p className="mt-1 text-muted-foreground">{total} {total === 1 ? "person" : "people"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can(user, "people.approve_change") ? (
            <Link href="/people/requests" className={cn(buttonVariants({ variant: "outline" }))}>
              Change requests
            </Link>
          ) : null}
          {can(user, "people.manage_clients") ? (
            <Link href="/people/clients" className={cn(buttonVariants({ variant: "outline" }))}>
              Clients
            </Link>
          ) : null}
          {can(user, "people.manage_custom_fields") ? (
            <Link href="/people/fields" className={cn(buttonVariants({ variant: "outline" }))}>
              Custom fields
            </Link>
          ) : null}
          {can(user, "org.manage_structure") ? (
            <Link href="/people/structure" className={cn(buttonVariants({ variant: "outline" }))}>
              Structure
            </Link>
          ) : null}
          {canCreate ? (
            <Link href="/people/new" className={cn(buttonVariants())}>
              <UserPlus aria-hidden /> Add person
            </Link>
          ) : null}
        </div>
      </div>

      <form action="/people" className="flex flex-wrap items-end gap-3 [&>div]:w-full sm:[&>div]:w-auto">
        <div className="space-y-1.5">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={query.q ?? ""} placeholder="Name, email, number, position" className="w-full sm:w-64" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <NativeSelect id="status" name="status" defaultValue={query.status ?? ""} className="w-full sm:w-40">
            <option value="">All</option>
            {EMPLOYEE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="team">Team</Label>
          <NativeSelect id="team" name="team" defaultValue={query.team ?? ""} className="w-full sm:w-48">
            <option value="">All</option>
            {teamOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {clientOptions.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="client">Client</Label>
            <NativeSelect id="client" name="client" defaultValue={query.client ?? ""} className="w-full sm:w-56">
              <option value="">All</option>
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {seesArchived ? (
          <label className="flex items-center gap-2 pb-1.5 text-sm">
            <input type="checkbox" name="archived" value="1" defaultChecked={query.archived} className="size-4 accent-primary" />
            Include archived
          </label>
        ) : null}
        <input type="hidden" name="sort" value={query.sort} />
        <input type="hidden" name="dir" value={query.dir} />
        <Button type="submit" variant="outline">
          Filter
        </Button>
        {Object.keys(filters).length > 0 ? (
          <Link href="/people" className="pb-1.5 text-sm text-primary underline-offset-4 hover:underline">
            Clear
          </Link>
        ) : null}
      </form>

      <div className="scroll-shadow-x overflow-x-auto rounded-xl border bg-card">
        <DirectoryTable rows={rows} seesClients={seesClients} sort={query.sort} dir={query.dir} params={filters} />
      </div>

      <PagerLinks info={info} basePath="/people" query={{ ...filters, sort: query.sort, dir: query.dir }} label="people" />
    </div>
  );
}

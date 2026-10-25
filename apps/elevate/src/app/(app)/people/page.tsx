import type { Metadata } from "next";
import Link from "next/link";
import { Search, SlidersHorizontal, UserPlus } from "lucide-react";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
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
import { listAddress } from "@/lib/return-to";
import { DirectoryTable } from "@/modules/people/components/directory-table";
import { ManageMenu } from "@/modules/people/components/manage-menu";
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
  // The filters other than the search box: on a phone they sit behind a "Filters" button, open when any is set.
  const activeFilters = [query.status, query.team, query.client, query.archived].filter(Boolean).length;

  // Only the admin links this person may use; each of those pages checks access again.
  const manage = [
    can(user, "people.approve_change") ? { href: "/people/requests", label: "Change requests" } : null,
    can(user, "people.merge") ? { href: "/people/duplicates", label: "Duplicates" } : null,
    can(user, "people.manage_clients") ? { href: "/people/clients", label: "Clients" } : null,
    can(user, "people.manage_custom_fields") ? { href: "/people/fields", label: "Custom fields" } : null,
    can(user, "org.manage_structure") ? { href: "/people/structure", label: "Structure" } : null,
  ].filter((item) => item !== null);

  return (
    <PageContainer>
      <PageHeader
        title="People"
        description={`${total} ${total === 1 ? "person" : "people"}`}
        actions={
          <>
            <ManageMenu items={manage} />
            {canCreate ? (
              <Link href="/people/new" className={cn(buttonVariants())}>
                <UserPlus aria-hidden /> Add person
              </Link>
            ) : null}
          </>
        }
      />

      <div className="rounded-2xl border bg-card shadow-sm animate-in fade-in-0 duration-300 motion-reduce:animate-none">
        <form action="/people" className="relative flex flex-wrap items-center gap-2 p-4">
          <div className="relative min-w-[12rem] flex-1">
            <Label htmlFor="q" className="sr-only">
              Search
            </Label>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id="q" name="q" defaultValue={query.q ?? ""} placeholder="Search people" className="h-(--control-h-lg) pl-9" />
          </div>
          {/* A plain checkbox shows and hides the other filters below the tablet width, with no script. Not part of the search (no name). */}
          <input id="filters-toggle" type="checkbox" defaultChecked={activeFilters > 0} className="peer sr-only sm:hidden" />
          <label htmlFor="filters-toggle" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "cursor-pointer peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 sm:hidden")}>
            <SlidersHorizontal aria-hidden />
            Filters{activeFilters > 0 ? ` (${activeFilters})` : ""}
          </label>
          <div className="hidden basis-full flex-wrap items-center gap-2 peer-checked:flex sm:flex sm:basis-auto">
            <div className="w-full sm:w-auto">
              <Label htmlFor="status" className="sr-only">
                Status
              </Label>
              <NativeSelect id="status" name="status" defaultValue={query.status ?? ""} className="h-(--control-h-lg) w-full sm:w-36">
                <option value="">All statuses</option>
                {EMPLOYEE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="w-full sm:w-auto">
              <Label htmlFor="team" className="sr-only">
                Team
              </Label>
              <NativeSelect id="team" name="team" defaultValue={query.team ?? ""} className="h-(--control-h-lg) w-full sm:w-40">
                <option value="">All teams</option>
                {teamOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {clientOptions.length > 0 ? (
              <div className="w-full sm:w-auto">
                <Label htmlFor="client" className="sr-only">
                  Client
                </Label>
                <NativeSelect id="client" name="client" defaultValue={query.client ?? ""} className="h-(--control-h-lg) w-full sm:w-44">
                  <option value="">All clients</option>
                  {clientOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            ) : null}
            {seesArchived ? (
              <label className="flex items-center gap-2 px-1 text-sm">
                <input type="checkbox" name="archived" value="1" defaultChecked={query.archived} className="size-4 accent-primary" />
                Include archived
              </label>
            ) : null}
          </div>
          <input type="hidden" name="sort" value={query.sort} />
          <input type="hidden" name="dir" value={query.dir} />
          <Button type="submit" size="lg">
            Apply
          </Button>
          {Object.keys(filters).length > 0 ? (
            <Link href="/people" className="text-sm text-primary underline-offset-4 hover:underline">
              Clear
            </Link>
          ) : null}
        </form>

        <div className="border-t">
          <DirectoryTable rows={rows} seesClients={seesClients} sort={query.sort} dir={query.dir} params={filters} returnTo={listAddress("/people", { ...filters, sort: query.sort, dir: query.dir, page: info.page > 1 ? info.page : undefined, size: info.pageSize !== DEFAULT_PAGE_SIZE ? info.pageSize : undefined })} />
        </div>

        <div className="border-t px-4 py-3">
          <PagerLinks info={info} basePath="/people" query={{ ...filters, sort: query.sort, dir: query.dir }} label="people" />
        </div>
      </div>
    </PageContainer>
  );
}

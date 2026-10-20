import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

/**
 * The heading of a page: an optional breadcrumb trail, the title (the page's one h1), a short description and the page's actions.
 * The last crumb is the current page and is not a link. Actions wrap under the title on a phone.
 */
export function PageHeader({ title, description, actions, breadcrumbs, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumbs?: Crumb[]; className?: string }) {
  return (
    <header className={cn("flex flex-col gap-2", className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <Breadcrumb>
          <BreadcrumbList>
            {breadcrumbs.map((crumb, i) => (
              <Fragment key={`${crumb.label}-${i}`}>
                {i > 0 ? <BreadcrumbSeparator /> : null}
                <BreadcrumbItem>
                  {crumb.href && i < breadcrumbs.length - 1 ? <BreadcrumbLink render={<Link href={crumb.href} />}>{crumb.label}</BreadcrumbLink> : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 print:hidden">{actions}</div> : null}
      </div>
    </header>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ALL_NAV_ITEMS } from "@/lib/nav";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const modules = ALL_NAV_ITEMS.filter((i) => i.href !== "/dashboard");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome to ELEVATE</h1>
        <p className="mt-1 text-muted-foreground">Exceptional Support. Elevated Efficiency.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map(({ href, label, icon: Icon, description }) => (
          <li key={href}>
            <Link href={href} className="block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Card className="h-full transition-colors hover:bg-secondary/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4 text-primary" aria-hidden />
                    {label}
                  </CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

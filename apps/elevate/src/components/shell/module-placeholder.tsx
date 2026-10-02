import { Construction } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ALL_NAV_ITEMS } from "@/lib/nav";

export function ModulePlaceholder({ href }: { href: string }) {
  const item = ALL_NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`No nav item for ${href}`);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{item.label}</h1>
        <p className="mt-1 text-muted-foreground">{item.description}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="size-4 text-brand-gold-dark dark:text-brand-gold-light" aria-hidden />
            Coming soon
          </CardTitle>
          <CardDescription>This module is not built yet.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          It will appear here in its build phase. No data is stored for it yet.
        </CardContent>
      </Card>
    </div>
  );
}

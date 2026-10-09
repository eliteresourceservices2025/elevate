import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Image src="/elite-logo-icon.png" alt="Elite Resource Services" width={72} height={72} priority className="h-auto w-[72px]" />
          <h1 className="mt-2 font-heading text-xl font-semibold">{title}</h1>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        <Link href="/privacy" className="underline">Privacy policy</Link> · <Link href="/terms" className="underline">Terms of use</Link>
      </p>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      <Image src="/elite-logo-icon.png" alt="" width={72} height={72} style={{ width: 72, height: "auto" }} />
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="max-w-sm text-muted-foreground">
        This page does not exist, or you do not have access to it.
      </p>
      <Link href="/dashboard" className={cn(buttonVariants())}>
        Back to dashboard
      </Link>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

// Public pages (Google's sign-in consent screen and applicants link to them), so search engines may index them.
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <Image src="/elite-logo-icon.png" alt="" width={36} height={36} className="h-9 w-9 rounded-full" />
          <Link href="/login" className="font-heading text-lg font-bold">
            ELEVATE · Elite Resource Services
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl space-y-4 px-4 py-8 text-sm leading-relaxed [&_h1]:font-heading [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-6 [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
        {children}
      </main>
      <footer className="mx-auto max-w-3xl px-4 pb-8 text-xs text-muted-foreground">
        <Link href="/privacy" className="underline">Privacy policy</Link> · <Link href="/terms" className="underline">Terms of use</Link> · <Link href="/login" className="underline">Sign in</Link>
      </footer>
    </div>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

// Public pages: the one place that search engines may index.
export const metadata: Metadata = { title: "Careers", description: "Open positions at Elite Resource Services.", robots: { index: true, follow: true } };

export default function CareersLayout({ children }: LayoutProps<"/careers">) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <Image src="/elite-logo-icon.png" alt="" width={36} height={36} className="h-9 w-9 rounded-full" />
          <Link href="/careers" className="font-heading text-lg font-bold">
            Elite Resource Services
          </Link>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-8">
        {children}
      </main>
    </div>
  );
}

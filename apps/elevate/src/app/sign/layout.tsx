import type { Metadata } from "next";
import Image from "next/image";

// Public pages for people without an ELEVATE account (a candidate signing an offer). Never indexed.
export const metadata: Metadata = { title: "Sign a document", robots: { index: false, follow: false } };

export default function SignLayout({ children }: LayoutProps<"/sign">) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <Image src="/elite-logo-icon.png" alt="" width={36} height={36} className="h-9 w-9 rounded-full" />
          <span className="font-heading text-lg font-bold">Elite Resource Services</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        {children}
      </main>
    </div>
  );
}

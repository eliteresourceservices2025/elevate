import type { Metadata } from "next";
import Image from "next/image";
import { VerifyForm } from "@/modules/signing/components/verify-form";

// Public: anyone holding a signed PDF can check it, with no account.
export const metadata: Metadata = { title: "Verify a document", description: "Check that a signed PDF is a genuine, unchanged ELEVATE Sign document.", robots: { index: false, follow: false } };

export default function VerifyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4">
          <Image src="/elite-logo-icon.png" alt="" width={36} height={36} className="h-9 w-9 rounded-full" />
          <span className="font-heading text-lg font-bold">Elite Resource Services</span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold">Verify a signed document</h1>
          <p className="mt-1 text-muted-foreground">Check that a PDF signed with ELEVATE Sign is genuine and has not been changed since it was sealed.</p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <VerifyForm />
        </div>
      </main>
    </div>
  );
}

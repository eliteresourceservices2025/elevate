import type { Metadata } from "next";

export const metadata: Metadata = { title: "Careers" };

// Public page. The job board and apply form are built in Phase 3.1.
export default function CareersPage() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Careers at Elite Resource Services</h1>
      <p className="mt-2 text-muted-foreground">Open positions will be listed here.</p>
    </main>
  );
}

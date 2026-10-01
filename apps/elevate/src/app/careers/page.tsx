import type { Metadata } from "next";
import Link from "next/link";
import { listPublicOpenings } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "Careers" };
export const dynamic = "force-dynamic";

export default async function CareersPage() {
  const openings = await listPublicOpenings();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Careers at Elite Resource Services</h1>
        <p className="mt-1 text-muted-foreground">We place skilled virtual assistants with clients, many in healthcare. These roles are independent contractor engagements.</p>
      </div>
      {openings.length === 0 ? (
        <p className="rounded-xl border bg-card p-6 text-muted-foreground">There are no open positions right now. Please check back soon.</p>
      ) : (
        <ul className="space-y-3">
          {openings.map((o) => (
            <li key={o.id}>
              <Link href={`/careers/${o.id}`} className="block rounded-xl border bg-card p-4 outline-none transition-colors hover:bg-secondary/50 focus-visible:ring-2 focus-visible:ring-ring">
                <h2 className="font-semibold">{o.title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {o.location}
                  {o.payNote ? ` · ${o.payNote}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

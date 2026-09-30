import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE, formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CHANGE_CATEGORY_LABELS, CHANGE_STATUSES, type ChangeStatus } from "@/modules/people/constants";
import { RequestReview } from "@/modules/people/components/request-review";
import { listChangeRequests } from "@/modules/people/queries";

export const metadata: Metadata = { title: "Change requests" };

const FIELD_LABELS = new Map<string, string>([
  ["mobile", "Mobile"],
  ["personalEmail", "Personal email"],
  ["addressLine", "Address"],
  ["city", "City"],
  ["province", "Province"],
  ["postalCode", "Postal code"],
  ["country", "Country"],
]);

function Proposed({ category, payload }: { category: string; payload: unknown }) {
  if (category === "bank") return <p className="text-sm text-muted-foreground">Bank details are encrypted. Use the button below to view them.</p>;

  if (category === "contact") {
    const entries = Object.entries((payload ?? {}) as Record<string, string>);
    return (
      <dl className="grid gap-1 text-sm">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="inline text-muted-foreground">{FIELD_LABELS.get(k) ?? k}: </dt>
            <dd className="inline">{v}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const { contacts = [] } = (payload ?? {}) as { contacts?: { name: string; relationship: string; phone: string; isPrimary: boolean }[] };
  return (
    <ul className="space-y-1 text-sm">
      {contacts.map((c, i) => (
        <li key={i}>
          {c.name} ({c.relationship}) · {c.phone} {c.isPrimary ? <Badge variant="secondary">Primary</Badge> : null}
        </li>
      ))}
    </ul>
  );
}

export default async function RequestsPage({ searchParams }: PageProps<"/people/requests">) {
  const raw = (await searchParams).status;
  const status = (CHANGE_STATUSES as readonly string[]).includes(String(raw)) ? (raw as ChangeStatus) : "pending";
  const requests = await orNotFound(listChangeRequests(status));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/people" className="text-sm text-primary underline-offset-4 hover:underline">
          ← People
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Change requests</h1>
        <p className="mt-1 text-muted-foreground">
          People ask for changes to their contact details, emergency contacts and bank details. Approve to apply them. You cannot
          review a request on your own record.
        </p>
      </div>

      <nav aria-label="Status" className="flex gap-1 border-b">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <Link
            key={s}
            href={`/people/requests?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm capitalize", s === status ? "border-primary font-medium text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {s}
          </Link>
        ))}
      </nav>

      {requests.length === 0 ? <p className="text-muted-foreground">Nothing here.</p> : null}
      <ul className="space-y-4">
        {requests.map((r) => (
          <li key={r.id} className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">
                <Link href={`/people/${r.employeeId}`} className="text-primary underline-offset-4 hover:underline">
                  {r.employeeName}
                </Link>{" "}
                <span className="text-sm text-muted-foreground">{r.employeeNumber}</span>
              </p>
              <Badge variant="secondary">{CHANGE_CATEGORY_LABELS[r.category]}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">Requested {formatInZone(r.createdAt, DEFAULT_TIMEZONE, "MMM d, yyyy h:mm a")}</p>
            <Proposed category={r.category} payload={r.payload} />
            {r.status === "pending" ? <RequestReview requestId={r.id} isBank={r.category === "bank"} /> : r.reviewNote ? <p className="text-sm">Note: {r.reviewNote}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

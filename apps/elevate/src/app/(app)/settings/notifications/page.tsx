import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { DigestPreference } from "@/modules/notifications/components/digest-preference";
import { getMyDigestOptOut } from "@/modules/notifications/queries";

export const metadata: Metadata = { title: "Email notifications" };

/** The signed-in person's own email choices. Everyone has this page; it only ever changes their own settings. */
export default async function NotificationSettingsPage() {
  const optedOut = await orNotFound(getMyDigestOptOut());

  return (
    <div className="w-full max-w-3xl space-y-6">
      <div>
        <Link href="/settings" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Settings
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Email notifications</h1>
        <p className="mt-1 text-muted-foreground">Choose which emails ELEVATE sends you. Notifications inside ELEVATE (the bell) are not affected.</p>
      </div>
      <div className="rounded-xl border bg-card p-4">
        <DigestPreference optedOut={optedOut} />
      </div>
    </div>
  );
}

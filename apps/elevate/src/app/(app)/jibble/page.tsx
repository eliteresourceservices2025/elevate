import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { JibblePanel } from "@/modules/jibble/components/jibble-panel";
import { getJibbleOverview } from "@/modules/jibble/queries";

export const metadata: Metadata = { title: "Jibble" };

export default async function JibblePage() {
  await requireUser();
  const overview = await orNotFound(getJibbleOverview());
  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Jibble</h1>
        <p className="mt-1 text-muted-foreground">Connection status, people matching and the latest calls.</p>
      </div>
      <JibblePanel overview={overview} />
    </div>
  );
}

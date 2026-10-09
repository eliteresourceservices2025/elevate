import type { Metadata } from "next";
import Link from "next/link";
import { orNotFound } from "@/lib/or-not-found";
import { StartOffboardingForm } from "@/modules/onboarding/components/case-actions";
import { listOffboardingCandidates } from "@/modules/onboarding/queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Start an offboarding" };

export default async function NewOffboardingPage() {
  const people = await orNotFound(listOffboardingCandidates());
  return (
    <div className="w-full space-y-4">
      <div>
        <Link href="/offboarding" className="text-sm text-primary underline-offset-2 hover:underline">
          Offboarding
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Start an offboarding</h1>
        <p className="mt-1 text-muted-foreground">Someone who still has active reports cannot be offboarded: reassign their reports first.</p>
      </div>
      <StartOffboardingForm people={people} today={todayInZone()} />
    </div>
  );
}

import type { Metadata } from "next";
import { OpenLearn } from "@/modules/learn/components/open-learn";
import { learnBaseUrl } from "@/modules/learn/token";

export const metadata: Metadata = { title: "HIPAA training" };

export default async function LearnPage({ searchParams }: { searchParams: Promise<{ auto?: string }> }) {
  const { auto } = await searchParams;
  const configured = learnBaseUrl() !== null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">HIPAA training</h1>
        <p className="mt-2 text-muted-foreground">
          Your assigned HIPAA training, exam and certificate live in ELEVATE Learn. You stay signed in: opening it signs you in there
          with the same account, and your progress is saved as you go.
        </p>
      </div>
      {configured ? (
        <OpenLearn auto={auto === "1"} />
      ) : (
        <p className="rounded-md border p-4 text-sm">HIPAA training is not available yet. HR will let you know when it opens.</p>
      )}
      <p className="text-sm text-muted-foreground">
        Please never type patient information anywhere in training. If you suspect a privacy or security incident, tell HR straight away.
      </p>
    </div>
  );
}

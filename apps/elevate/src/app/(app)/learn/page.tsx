import type { Metadata } from "next";
import { OpenLearn } from "@/modules/learn/components/open-learn";
import { learnBaseUrl } from "@/modules/learn/token";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "My training" };

export default async function LearnPage({ searchParams }: { searchParams: Promise<{ auto?: string }> }) {
  const { auto } = await searchParams;
  const configured = learnBaseUrl() !== null;

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="My training"
        description="Your assigned training (HIPAA and Cybersecurity basics), exams and certificates live in ELEVATE Learn. You stay signed in: opening it signs you in there with the same account, and your progress is saved as you go."
      />
      {configured ? (
        <OpenLearn auto={auto === "1"} />
      ) : (
        <p className="rounded-md border p-4 text-sm">Training is not available yet. HR will let you know when it opens.</p>
      )}
      <p className="text-sm text-muted-foreground">
        Please never type patient information anywhere in training. If you suspect a privacy or security incident, tell HR straight away.
      </p>
    </PageContainer>
  );
}

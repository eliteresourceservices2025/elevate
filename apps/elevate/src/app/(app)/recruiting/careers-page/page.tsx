import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { CareersPageEditor } from "@/modules/recruiting/components/careers-page-editor";
import { getCareersPageForEdit } from "@/modules/recruiting/queries";

export const metadata: Metadata = { title: "Careers page" };

export default async function CareersPageSettingsPage() {
  await requireUser();
  const page = await orNotFound(getCareersPageForEdit());
  return (
    <div className="w-full max-w-4xl space-y-6">
      <div>
        <Link href="/recruiting" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Recruiting
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Careers page</h1>
        <p className="mt-1 text-muted-foreground">
          The words and picture at the top of the public job list.{" "}
          <a href="/careers" target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-4 hover:underline">
            See the live page
          </a>{" "}
          (opens in a new tab).
        </p>
      </div>
      <CareersPageEditor initial={{ title: page.title ?? "", intro: page.intro ?? "", bannerVersion: page.bannerVersion }} />
    </div>
  );
}

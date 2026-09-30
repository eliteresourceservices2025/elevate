import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMyEmployeeId } from "@/modules/people/queries";

export const metadata: Metadata = { title: "My profile" };

export default async function MyProfilePage({ searchParams }: PageProps<"/people/me">) {
  const id = await getMyEmployeeId();
  const tab = (await searchParams).tab;
  // Keep the tab, so "my documents" links land on the right tab.
  if (id) redirect(`/people/${id}${typeof tab === "string" && /^[a-z]+$/.test(tab) ? `?tab=${tab}` : ""}`);

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="text-2xl font-bold">My profile</h1>
      <p className="text-muted-foreground">
        Your people record is not set up yet. HR creates it using the email you signed in with. Ask HR to check that they have{" "}
        <strong>exactly that address</strong> on file, and then reload this page.
      </p>
    </div>
  );
}

import type { Metadata } from "next";
import { ProfileView } from "@/modules/people/components/profile-view";
import { getMyEmployeeId } from "@/modules/people/queries";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "My profile" };

// The signed-in person's own profile, shown right here (no redirect to the People list), so the menu keeps "My profile" highlighted.
export default async function MyProfilePage({ searchParams }: PageProps<"/people/me">) {
  const id = await getMyEmployeeId();
  const tab = (await searchParams).tab;
  if (id) return <ProfileView id={id} requestedTab={typeof tab === "string" ? tab : undefined} basePath="/people/me" own />;

  return (
    <PageHeader
      title="My profile"
      description={
        <>
          Your people record is not set up yet. HR creates it using the email you signed in with. Ask HR to check that they have{" "}
          <strong>exactly that address</strong> on file, and then reload this page.
        </>
      }
    />
  );
}

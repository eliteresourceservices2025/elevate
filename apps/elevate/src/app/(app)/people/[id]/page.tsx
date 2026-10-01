import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProfileView } from "@/modules/people/components/profile-view";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ params, searchParams }: PageProps<"/people/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const tab = (await searchParams).tab;
  return <ProfileView id={id} requestedTab={typeof tab === "string" ? tab : undefined} basePath={`/people/${id}`} own={false} />;
}

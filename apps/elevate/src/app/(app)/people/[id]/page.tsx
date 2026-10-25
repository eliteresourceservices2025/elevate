import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { safeReturnTo } from "@/lib/return-to";
import { ProfileView } from "@/modules/people/components/profile-view";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage({ params, searchParams }: PageProps<"/people/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  return <ProfileView id={id} requestedTab={typeof sp.tab === "string" ? sp.tab : undefined} basePath={`/people/${id}`} own={false} returnTo={safeReturnTo(sp.from)} />;
}

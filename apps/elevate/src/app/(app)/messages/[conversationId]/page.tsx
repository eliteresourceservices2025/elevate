import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MessagesPage } from "@/modules/messages/components/messages-page";

export const metadata: Metadata = { title: "Messages" };

// No loading.tsx here on purpose: this route can call notFound(), and a loading file would turn that 404 into a 200.
export default async function Page({ params }: PageProps<"/messages/[conversationId]">) {
  const { conversationId } = await params;
  if (!z.uuid().safeParse(conversationId).success) notFound();
  return <MessagesPage conversationId={conversationId} />;
}

import type { Metadata } from "next";
import { MessagesPage } from "@/modules/messages/components/messages-page";

export const metadata: Metadata = { title: "Messages" };

export default function Page() {
  return <MessagesPage />;
}

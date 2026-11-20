import type { Metadata } from "next";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { can } from "@/lib/authz";
import { requireUser } from "@/lib/auth";
import { orNotFound } from "@/lib/or-not-found";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { AccessRequests } from "@/modules/chat-access/components/access-requests";
import { listAccessRequests, listRequestable } from "@/modules/chat-access/queries";
import { todayInZone } from "@/modules/org/service";

export const metadata: Metadata = { title: "Chat access" };

// HR Admins and Super Admins only: anyone else gets a 404 (the query refuses them). No loading.tsx: this route can call notFound().
export default async function Page() {
  const user = await requireUser();
  const items = await orNotFound(listAccessRequests());
  const canRequest = can(user, "chataccess.request");
  const requestable = canRequest ? await orNotFound(listRequestable()) : null;
  return (
    <PageContainer width="wide">
      <PageHeader
        title="Chat access"
        description="Ask to read a chat or watch a recording you are not part of, and decide on requests. Two people are always needed."
        breadcrumbs={[{ label: "Messages", href: "/messages" }, { label: "Chat access" }]}
      />
      <AccessRequests items={items} requestable={requestable} canRequest={canRequest} canDecide={can(user, "chataccess.decide")} today={todayInZone()} timeZone={DEFAULT_TIMEZONE} />
    </PageContainer>
  );
}

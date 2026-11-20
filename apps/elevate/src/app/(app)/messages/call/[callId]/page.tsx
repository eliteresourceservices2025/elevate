import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/page-container";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/authz";
import { CallScreen } from "@/modules/calls/components/call-screen";
import { callsAvailable } from "@/modules/calls/sfu-port";

export const metadata: Metadata = { title: "Call" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The call itself. Whether this person may be in it is checked when they join (membership of the chat); this page only shows the lobby
// and the call. A guest reaches it too (their frame is the guest layout). No loading.tsx: this route can call notFound().
export default async function Page({ params, searchParams }: { params: Promise<{ callId: string }>; searchParams: Promise<{ join?: string }> }) {
  const user = await requireUser({ allowGuest: true });
  await authorize(user, user.isGuest ? "messages.use" : "calls.join", { ownerUserId: user.id }).catch(() => notFound());
  const { callId } = await params;
  if (!UUID.test(callId) || !callsAvailable()) notFound();
  const { join } = await searchParams;
  return (
    <PageContainer width="canvas">
      <PageHeader title="Call" description="Talk with your team. Everything here follows your chat's privacy rules." breadcrumbs={[{ label: "Messages", href: "/messages" }, { label: "Call" }]} />
      <CallScreen callId={callId.toLowerCase()} autoJoin={join === "1"} />
    </PageContainer>
  );
}

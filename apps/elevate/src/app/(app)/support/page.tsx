import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { can } from "@/lib/authz";
import { orNotFound } from "@/lib/or-not-found";
import { FormDialog } from "@/components/form-dialog";
import { SupportForm, SupportList } from "@/modules/support/components/support-panels";
import { listMySupportRequests, listSupportInbox } from "@/modules/support/queries";
import { supportEmail } from "@/modules/support/service";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/page-container";

export const metadata: Metadata = { title: "Contact support" };

export default async function SupportPage({ searchParams }: PageProps<"/support">) {
  const user = await requireUser();
  const params = await searchParams;
  const from = typeof params.from === "string" && /^\/(?!\/)[A-Za-z0-9/_\-.?=&%#]{0,199}$/.test(params.from) ? params.from : null;
  const isManager = can(user, "support.manage");
  const [mine, inbox] = await Promise.all([orNotFound(listMySupportRequests()), isManager ? orNotFound(listSupportInbox()) : Promise.resolve(null)]);
  const open = inbox?.filter((r) => r.status === "open") ?? [];
  const handled = inbox?.filter((r) => r.status === "closed") ?? [];

  return (
    <PageContainer width="form">
      <PageHeader
        title="Contact support"
        description={
          <p>
            Something not working, or you cannot sign in? Tell us here. You can also email{" "}
            <a href={`mailto:${supportEmail()}`} className="text-primary underline-offset-4 hover:underline">
              {supportEmail()}
            </a>
            .
          </p>
        }
        actions={
          <>
            {/* A link that asks for support from another page (it carries ?from=) opens the form straight away */}
            <FormDialog label="Send a request to support" title="Contact support" defaultOpen={Boolean(from)} size="lg">
              <SupportForm page={from} email={user.email} />
            </FormDialog>
          </>
        }
      />

      <section aria-label="Your requests" className="space-y-3">
        <h2 className="text-lg font-semibold">Your requests</h2>
        <SupportList rows={mine} canManage={false} empty="You have not sent any requests." />
      </section>

      {inbox ? (
        <section aria-label="Support inbox" className="space-y-3">
          <h2 className="text-lg font-semibold">Inbox ({open.length} open)</h2>
          <SupportList rows={open} canManage empty="Nothing is waiting." />
          {handled.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium">Handled ({handled.length})</summary>
              <div className="mt-3">
                <SupportList rows={handled} canManage empty="" />
              </div>
            </details>
          ) : null}
        </section>
      ) : null}
    </PageContainer>
  );
}

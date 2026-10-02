import type { Metadata } from "next";
import { cookies } from "next/headers";
import { formatInZone } from "@/lib/time";
import { ExternalFlow } from "@/modules/signing/components/external-flow";
import { SESSION_COOKIE, resolveToken, sessionValid } from "@/modules/signing/external";

export const metadata: Metadata = { title: "Sign a document" };
export const dynamic = "force-dynamic";

const maskEmail = (email: string) => {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
};

// An outside signer's page. The link alone shows only the document title and who it is for (masked); reading and signing need the
// emailed code. Nothing here reveals anything about the person beyond their own name on their own document.
export default async function SignPage({ params }: PageProps<"/sign/[token]">) {
  const { token } = await params;
  const ctx = await resolveToken(token);
  if (!ctx) {
    return (
      <div className="space-y-2 rounded-xl border bg-card p-6">
        <h1 className="text-xl font-bold">This link is not valid anymore</h1>
        <p className="text-sm text-muted-foreground">It may have been replaced by a newer email, or it is too old. If you still need to sign, ask the person who sent it for a new link.</p>
      </div>
    );
  }
  const jar = await cookies();
  const session = sessionValid(ctx, jar.get(SESSION_COOKIE)?.value);
  const { env, signer, state } = ctx;

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold">{env.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          From Elite Resource Services, for {signer.externalName}
          {state === "active" && env.expiresAt ? ` · please sign by ${formatInZone(env.expiresAt, undefined, "MMM d, yyyy")}` : ""}
        </p>
      </div>

      {state === "closed" ? (
        <p role="status" className="rounded-xl border bg-card p-5 text-sm">
          {env.status === "declined" ? "This document was declined, so it is closed." : env.status === "voided" ? "This document was withdrawn, so you no longer need to sign it." : "This document has expired. Ask the person who sent it to send it again."}
        </p>
      ) : state === "waiting" ? (
        <p role="status" className="rounded-xl border bg-card p-5 text-sm">
          Someone else signs before you. We will email you when it is your turn.
        </p>
      ) : state === "signed" ? (
        <p role="status" className="rounded-xl border border-green-600/40 bg-green-600/10 p-5 text-sm">
          Thank you, you have signed. The others still need to sign. We will email you a link to the signed copy when everyone has.
        </p>
      ) : !session ? (
        <>
          {state === "done" ? <p className="text-sm text-muted-foreground">This document has been signed by everyone. To open your signed copy, first confirm it is you.</p> : null}
          <ExternalFlow token={token} step="code" email={maskEmail(signer.externalEmail ?? "")} name={signer.externalName ?? ""} />
        </>
      ) : state === "active" ? (
        <ExternalFlow token={token} step="sign" email="" name={signer.externalName ?? ""} />
      ) : (
        <>
          <p role="status" className="rounded-xl border border-green-600/40 bg-green-600/10 p-5 text-sm">
            Thank you. Everyone has signed. Below is your signed copy, with its certificate of completion.
          </p>
          <ExternalFlow token={token} step="view" email="" name={signer.externalName ?? ""} />
        </>
      )}
    </>
  );
}

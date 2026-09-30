"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acknowledge } from "@/modules/announcements/actions";
import { signOut } from "@/modules/auth/actions";

/** Full-page screen shown until the signed-in person accepts the current privacy notice. The notice itself is passed as children. */
export function PrivacyGate({
  versionId,
  title,
  version,
  updated,
  changeNote,
  children,
}: {
  versionId: string;
  title: string;
  version: number;
  updated: boolean;
  changeNote: string | null;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 px-4 py-10">
      <div>
        <p className="text-sm font-medium text-primary">ELEVATE</p>
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {updated ? `The privacy notice was updated (version ${version}). Please read it again to continue.` : "Before you continue, please read how ELEVATE handles your personal data."}
        </p>
      </div>
      {updated && changeNote ? (
        <p className="rounded-lg border bg-muted/50 p-3 text-sm">
          <span className="font-medium">What changed: </span>
          {changeNote}
        </p>
      ) : null}
      <article aria-label="Privacy notice" className="rounded-xl border bg-card p-5">
        {children}
      </article>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await acknowledge({ kind: "policy_version", id: versionId });
              if (!result.ok) return void toast.error(result.error);
              router.refresh();
            })
          }
        >
          I have read and understand
        </Button>
        <form action={signOut}>
          <Button type="submit" variant="ghost">
            <LogOut aria-hidden /> Sign out
          </Button>
        </form>
      </div>
      <p className="text-xs text-muted-foreground">This records your name, the version and the time. Nothing else.</p>
    </main>
  );
}

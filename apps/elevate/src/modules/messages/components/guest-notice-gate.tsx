"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition, type ReactNode } from "react";
import { toast } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";
import { signOut } from "@/modules/auth/actions";
import { acceptChatGuestNotice } from "../actions";

/** What a client guest sees first: the short guest notice. Nothing else opens until they accept it. The notice text is passed as children. */
export function GuestNoticeGate({ title, clientName, children }: { title: string; clientName: string | null; children: ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 px-4 py-10">
      <div>
        <p className="text-sm font-medium text-primary">ELEVATE Messages{clientName ? ` · ${clientName}` : ""}</p>
        <h1 className="text-2xl font-bold">{title}</h1>
      </div>
      <article aria-label="Guest notice" className="rounded-xl border bg-card p-5">
        {children}
      </article>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await acceptChatGuestNotice();
              if (!result.ok) return void toast.error(result.error);
              router.refresh();
            })
          }
        >
          I have read and agree
        </Button>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            <LogOut aria-hidden /> Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}

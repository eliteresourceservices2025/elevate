"use client";

import { Copy } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "@/components/feedback-dialog";
import { FormDialog } from "@/components/form-dialog";
import { Button } from "@/components/ui/button";
import { createEnrollmentCode } from "../actions";

function Inner() {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const left = expiresAt ? Math.max(0, Math.floor((expiresAt - now) / 1000)) : 0;
  const get = () =>
    startTransition(async () => {
      const result = await createEnrollmentCode();
      if (!result.ok) return void toast.error(result.error);
      setCode(result.data.code);
      setExpiresAt(Date.parse(result.data.expiresAt));
      setNow(Date.now());
    });

  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>Open the ELEVATE Tracker App on the computer you work on.</li>
        <li>Choose &ldquo;Sign in with a code&rdquo; and type the code below.</li>
        <li>Clock in here as usual. The app records only while you are clocked in.</li>
      </ol>
      {code && left > 0 ? (
        <div className="space-y-2 rounded-xl border bg-muted/40 p-4 text-center">
          <p aria-label="Your code" className="font-mono text-3xl font-bold tracking-widest">{code}</p>
          <p role="status" className="text-sm text-muted-foreground">
            Works once. Valid for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} more.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                toast.success("Code copied.");
              } catch {
                toast.error("Could not copy. Type the code instead.");
              }
            }}
          >
            <Copy aria-hidden className="size-4" /> Copy code
          </Button>
        </div>
      ) : null}
      {code && left === 0 ? <p role="status" className="text-sm">That code has expired.</p> : null}
      <Button onClick={get} disabled={pending}>
        {pending ? "Getting a code…" : code ? "Get a new code" : "Get a code"}
      </Button>
    </div>
  );
}

/** "Add this computer": a one-time code to type into the ELEVATE Tracker App. */
export function EnrollDialog({ variant = "default" }: { variant?: "default" | "outline" }) {
  return (
    <FormDialog label="Add this computer" title="Add this computer" description="A one-time code connects the ELEVATE Tracker App on your computer to your account." variant={variant}>
      <Inner />
    </FormDialog>
  );
}

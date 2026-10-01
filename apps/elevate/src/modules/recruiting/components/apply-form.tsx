"use client";

import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { TextField } from "@/components/form-fields";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RESUME_MAX_BYTES } from "../constants";

/** The public application form. The hidden "website" field is a honeypot: people never see or fill it. */
export function ApplyForm({ openingId, noticeTitle, noticeBody }: { openingId: string; noticeTitle: string | null; noticeBody: string | null }) {
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const file = form.get("resume");
    if (!(file instanceof File) || file.size === 0) return setError({ message: "Please attach your resume (PDF or DOCX).", field: "resume" });
    if (file.size > RESUME_MAX_BYTES) return setError({ message: "Your resume is too large. The limit is 4 MB.", field: "resume" });
    form.set("openingId", openingId);
    setState("sending");
    try {
      const response = await fetch("/api/careers/apply", { method: "POST", body: form });
      const body = (await response.json().catch(() => null)) as { ok: boolean; error?: string; field?: string } | null;
      if (body?.ok) return setState("done");
      setState("idle");
      setError({ message: body?.error ?? "Something went wrong. Please try again.", field: body?.field });
    } catch {
      setState("idle");
      setError({ message: "No connection. Please try again." });
    }
  }

  if (state === "done") {
    return (
      <div role="status" className="rounded-lg border border-green-600/40 bg-green-600/10 p-4 text-sm">
        <p className="font-semibold">Thank you, we received your application.</p>
        <p className="mt-1">If it looks like a fit, someone from our team will be in touch. You do not need to do anything else.</p>
      </div>
    );
  }

  const fieldError = (name: string) => (error?.field === name ? error.message : undefined);

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField id="ap-name" name="fullName" label="Full name" autoComplete="name" required maxLength={120} error={fieldError("fullName")} />
        <TextField id="ap-email" name="email" type="email" label="Email" autoComplete="email" required maxLength={200} error={fieldError("email")} />
        <TextField id="ap-phone" name="phone" label="Phone (optional)" autoComplete="tel" maxLength={40} />
        <TextField id="ap-country" name="country" label="Country (optional)" autoComplete="country-name" maxLength={80} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ap-resume">Resume (PDF or DOCX, up to 4 MB)</Label>
        <input id="ap-resume" name="resume" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-secondary file:px-3 file:py-1.5" />
        {fieldError("resume") ? <p className="text-sm text-destructive">{fieldError("resume")}</p> : null}
        <p className="text-xs text-muted-foreground">Please do not include any client or patient information in your resume.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ap-note">Anything you would like us to know (optional)</Label>
        <textarea id="ap-note" name="note" rows={4} maxLength={2000} className="w-full rounded-lg border bg-background px-3 py-2 text-sm" />
      </div>

      {/* Honeypot: hidden from people and from assistive technology. Bots that fill every field are quietly ignored. */}
      <div aria-hidden="true" className="absolute left-[-10000px] h-0 w-0 overflow-hidden">
        <label htmlFor="ap-website">Leave this field empty</label>
        <input id="ap-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
        {noticeBody ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">{noticeTitle ?? "Privacy notice"}: read how we use your information</summary>
            <div className="mt-3 max-h-72 overflow-y-auto rounded-md bg-card p-3">
              <Markdown source={noticeBody} />
            </div>
          </details>
        ) : null}
        <label htmlFor="ap-consent" className="flex items-start gap-2 text-sm">
          <input id="ap-consent" name="consent" type="checkbox" required className="mt-1 size-4 accent-primary" />
          <span>I have read the privacy notice and agree that Elite Resource Services may keep and use my application to consider me for this and other roles.</span>
        </label>
        {fieldError("consent") ? <p className="text-sm text-destructive">{fieldError("consent")}</p> : null}
      </div>

      {error && !error.field ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
      <Button type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending..." : "Send application"}
      </Button>
    </form>
  );
}

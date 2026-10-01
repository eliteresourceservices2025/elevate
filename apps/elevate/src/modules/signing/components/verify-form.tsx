"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";

type Result = { state: "idle" } | { state: "checking" } | { state: "match"; reference: string; sealedAt: string } | { state: "nomatch" } | { state: "error"; message: string };

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Hashes the chosen PDF in the browser and asks the server only about the fingerprint: the file never leaves this computer. */
export function VerifyForm() {
  const [result, setResult] = useState<Result>({ state: "idle" });

  async function check(file: File | undefined) {
    if (!file) return;
    setResult({ state: "checking" });
    try {
      const sha256 = hex(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
      const response = await fetch("/api/signing/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha256 }) });
      const body = (await response.json().catch(() => null)) as { ok: boolean; match?: boolean; reference?: string; sealedAt?: string; error?: string } | null;
      if (!body?.ok) return setResult({ state: "error", message: body?.error ?? "Something went wrong. Please try again." });
      setResult(body.match && body.reference && body.sealedAt ? { state: "match", reference: body.reference, sealedAt: body.sealedAt } : { state: "nomatch" });
    } catch {
      setResult({ state: "error", message: "Could not check the file. Try again." });
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="verify-file">Choose the signed PDF</Label>
        <input id="verify-file" type="file" accept="application/pdf,.pdf" onChange={(e) => void check(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:bg-secondary file:px-3 file:py-1.5" />
        <p className="text-xs text-muted-foreground">Your file is checked on your own computer. Only its fingerprint (SHA-256) is sent to ELEVATE.</p>
      </div>
      <div role="status" aria-live="polite">
        {result.state === "checking" ? <p className="text-sm text-muted-foreground">Checking...</p> : null}
        {result.state === "match" ? (
          <div className="rounded-lg border border-green-600/40 bg-green-600/10 p-4 text-sm">
            <p className="font-semibold">This is a genuine, unchanged ELEVATE Sign document.</p>
            <p className="mt-1">
              Reference {result.reference}, sealed on {new Date(result.sealedAt).toUTCString()}.
            </p>
          </div>
        ) : null}
        {result.state === "nomatch" ? (
          <div className="rounded-lg border border-red-600/40 bg-red-600/10 p-4 text-sm">
            <p className="font-semibold">This file does not match any sealed ELEVATE document.</p>
            <p className="mt-1">It may have been changed after signing, or it did not come from ELEVATE Sign. Ask for the original sealed copy.</p>
          </div>
        ) : null}
        {result.state === "error" ? <p className="text-sm text-destructive">{result.message}</p> : null}
      </div>
    </div>
  );
}

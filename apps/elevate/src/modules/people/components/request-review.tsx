"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { reviewChangeRequest, viewBankRequest } from "../actions";

type BankValues = { bankName: string; bankAccountName: string; bankAccountNumber: string };

export function RequestReview({ requestId, isBank }: { requestId: string; isBank: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [bank, setBank] = useState<BankValues | null>(null);

  function decide(decision: "approve" | "reject") {
    startTransition(async () => {
      const result = await reviewChangeRequest({ requestId, decision, note });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(decision === "approve" ? "Approved and applied." : "Rejected.");
      router.refresh();
    });
  }

  function showBank() {
    startTransition(async () => {
      const result = await viewBankRequest({ requestId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setBank(result.data);
    });
  }

  return (
    <div className="space-y-3">
      {isBank ? (
        bank ? (
          <dl className="grid gap-1 rounded-lg bg-muted p-3 text-sm" aria-label="Requested bank details">
            <div><dt className="inline text-muted-foreground">Bank: </dt><dd className="inline">{bank.bankName}</dd></div>
            <div><dt className="inline text-muted-foreground">Account name: </dt><dd className="inline">{bank.bankAccountName}</dd></div>
            <div><dt className="inline text-muted-foreground">Account number: </dt><dd className="inline font-mono">{bank.bankAccountNumber}</dd></div>
          </dl>
        ) : (
          <Button variant="outline" size="sm" onClick={showBank} disabled={pending}>
            View requested bank details (logged)
          </Button>
        )
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor={`note-${requestId}`}>Note to the person (optional)</Label>
        <Input id={`note-${requestId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => decide("approve")} disabled={pending}>
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide("reject")} disabled={pending}>
          Reject
        </Button>
      </div>
    </div>
  );
}
